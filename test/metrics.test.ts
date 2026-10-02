import { describe, expect, it } from 'vitest';
import { classifyToolUse, parseTranscript } from '../harness/src/metrics.js';
import { playwrightExperiment } from '../harness/src/experiments/playwright.js';
import { githubExperiment } from '../harness/src/experiments/github.js';
import type { Arm } from '../harness/src/experiment.js';

const pw = playwrightExperiment;
const lines = (...events: object[]) => events.map(e => JSON.stringify(e));
const toolUse = (id: string, name: string, input: object, usage?: object) => ({
  type: 'assistant',
  message: { id, content: [{ type: 'tool_use', id: `t-${id}`, name, input }], ...(usage ? { usage } : {}) },
});
const parse = (arm: Arm, raw: string[], extra: { fallbackWallClockMs?: number } = {}) =>
  parseTranscript(raw, arm, pw.classifier, { armTools: pw.arms[arm].tools, ...extra });

describe('parseTranscript totals', () => {
  it('takes totals from the result event, summed across models', () => {
    const m = parse(
      'mcp',
      lines(
        { type: 'system', subtype: 'init' },
        toolUse('a', 'mcp__playwright__browser_navigate', { url: 'x' }, { input_tokens: 1 }),
        {
          type: 'result',
          duration_ms: 5000,
          total_cost_usd: 0.5,
          modelUsage: {
            big: { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 300, cacheCreationInputTokens: 40 },
            small: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 },
          },
        },
      ),
    );
    expect(m).toMatchObject({
      inputTokens: 11,
      outputTokens: 22,
      cachedInputTokens: 303,
      cacheCreationInputTokens: 44,
      wallClockMs: 5000,
      totalCostUsd: 0.5,
      incomplete: false,
      tokensEstimated: false,
      modelsUsed: ['big', 'small'],
      usedIntendedTool: true,
    });
  });

  it('estimates tokens from per-message usage when there is no result event (timeout)', () => {
    const u1 = { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 100, cache_creation_input_tokens: 10 };
    const u2 = { input_tokens: 1, output_tokens: 7, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 };
    const m = parse(
      'mcp',
      lines(
        // Two content blocks of the same message repeat its usage; count it once.
        { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hi' }], usage: u1 } },
        toolUse('m1', 'mcp__playwright__browser_snapshot', {}, u1),
        toolUse('m2', 'mcp__playwright__browser_click', { ref: 'e1' }, u2),
      ),
      { fallbackWallClockMs: 240_000 },
    );
    expect(m).toMatchObject({
      inputTokens: 3,
      outputTokens: 10,
      cachedInputTokens: 300,
      cacheCreationInputTokens: 10,
      incomplete: true,
      tokensEstimated: true,
      wallClockMs: 240_000,
      contextWindowPeak: 201,
      turns: 3,
      toolCallCount: 2,
    });
  });

  it('skips blank and malformed lines', () => {
    const m = parse('baseline', ['', 'not json', '{broken', ...lines({ type: 'result', duration_ms: 1 })]);
    expect(m.incomplete).toBe(false);
    expect(m.toolCallCount).toBe(0);
  });
});

describe('classifyToolUse (allow-list)', () => {
  const v = (arm: Arm, name: string, input: object = {}) =>
    classifyToolUse(arm, pw.classifier, pw.arms[arm].tools, name, input).surfaceReason;

  it('allows each arm its configured tools', () => {
    expect(v('baseline', 'Read')).toBeNull();
    expect(v('baseline', 'Write')).toBeNull();
    expect(v('skill', 'Skill', { skill: 'playwright-cli' })).toBeNull();
    expect(v('skill', 'Bash', { command: 'playwright-cli snapshot' })).toBeNull();
    expect(v('mcp', 'mcp__playwright__browser_click')).toBeNull();
    expect(v('mcp', 'ReadMcpResourceTool')).toBeNull();
  });

  it('allows planning tools everywhere', () => {
    for (const arm of ['baseline', 'skill', 'mcp'] as const) {
      expect(v(arm, 'TodoWrite')).toBeNull();
      expect(v(arm, 'TaskCreate')).toBeNull();
    }
  });

  it('rejects tools the arm was not given', () => {
    expect(v('baseline', 'Bash', { command: 'ls' })).toMatch(/not allowed in the baseline arm/);
    expect(v('baseline', 'mcp__playwright__browser_click')).toMatch(/not allowed/);
    expect(v('skill', 'Read')).toMatch(/not allowed in the skill arm/);
    expect(v('skill', 'mcp__playwright__browser_click')).toMatch(/not allowed/);
    expect(v('mcp', 'Read')).toMatch(/not allowed in the mcp arm/);
    expect(v('mcp', 'Glob')).toMatch(/not allowed/);
    expect(v('mcp', 'Edit')).toMatch(/not allowed/);
    expect(v('mcp', 'Bash', { command: 'playwright-cli open x' })).toMatch(/not allowed/);
    expect(v('mcp', 'Workflow')).toMatch(/not allowed/);
    expect(v('mcp', 'mcp__github__get_me')).toMatch(/not allowed/);
  });

  it('rejects always-blocked tools even if configured', () => {
    expect(
      classifyToolUse('mcp', pw.classifier, ['WebFetch'], 'WebFetch', { url: 'https://example.com' }).surfaceReason,
    ).toMatch(/out-of-band/);
  });

  it('checks the skill name and the Bash command in the skill arm', () => {
    expect(v('skill', 'Skill', { skill: 'other' })).toMatch(/unexpected skill other/);
    expect(v('skill', 'Bash', {})).toMatch(/missing command/);
    expect(v('skill', 'Bash', { command: 'cat /etc/hosts' })).toMatch(/non-playwright-cli/);
  });

  it('records escape calls and flips validity', () => {
    const m = parse('skill', lines(toolUse('a', 'Bash', { command: 'curl http://x' })));
    expect(m.validToolSurface).toBe(false);
    expect(m.escapeToolUsed).toBe(true);
    expect(m.escapeToolCalls[0]).toMatchObject({ name: 'Bash', command: 'curl http://x' });
    expect(m.singleCliCommandPerToolCall).toBe(false);
  });

  it('uses each experiment classifier for its own MCP prefix', () => {
    const gh = githubExperiment;
    expect(
      classifyToolUse('mcp', gh.classifier, gh.arms.mcp.tools, 'mcp__github__list_issues', {}).surfaceReason,
    ).toBeNull();
  });
});
