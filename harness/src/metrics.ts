import type { Arm, ExperimentClassifier } from './experiment.js';
import { ALWAYS_BLOCKED_TOOLS, PLANNING_TOOLS } from './config.js';

export interface ToolCallRecord {
  name: string;
  turnIndex: number;
  command?: string;
}

export interface EscapeToolCallRecord extends ToolCallRecord {
  reason: string;
}

export interface Metrics {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  toolCalls: ToolCallRecord[];
  toolCallCount: number;
  turns: number;
  wallClockMs: number;
  contextWindowPeak: number;
  totalCostUsd: number;
  modelsUsed: string[];
  /**
   * True iff the agent invoked an intended tool at least once: a Skill call
   * matching the experiment's intendedSkillName OR a tool whose name starts
   * with the experiment's intendedMcpPrefix.
   */
  usedIntendedTool: boolean;
  validToolSurface: boolean;
  escapeToolUsed: boolean;
  escapeToolCalls: EscapeToolCallRecord[];
  /**
   * Research-mode flag: true when every Bash call contained exactly one
   * intended-CLI command (no `&&`, `;`, `|`, redirections, or substitutions).
   */
  singleCliCommandPerToolCall: boolean;
  cliCommandGranularityViolations: EscapeToolCallRecord[];
  /**
   * True when the transcript has no final `result` event (the trial was killed
   * on timeout or crashed). Token counts are then summed from per-message usage
   * and are a lower bound; see `tokensEstimated`.
   */
  incomplete: boolean;
  tokensEstimated: boolean;
}

export interface ParseOptions {
  /** Built-in tools the arm was given (`ArmConfig.tools`). Anything else is out of surface. */
  armTools: readonly string[];
  /** Used for wallClockMs when the transcript has no `result` event. */
  fallbackWallClockMs?: number;
}

interface AssistantEvent {
  type: 'assistant';
  message: {
    id?: string;
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'thinking'; thinking: string }
      | { type: 'tool_use'; id: string; name: string; input: unknown }
    >;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

interface ResultEvent {
  type: 'result';
  subtype?: 'success' | 'error';
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, ModelUsage>;
}

type StreamEvent = AssistantEvent | ResultEvent | { type: string };

/**
 * Claude Code sometimes records a tool call's input as
 * `{ "__unparsedToolInput": { "raw": "<json>" } }` (seen with 2.1.288). Recover the real
 * input so the classifier sees the actual command instead of an empty one.
 */
export function normalizeToolInput(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const raw = (input as { __unparsedToolInput?: { raw?: unknown } }).__unparsedToolInput?.raw;
  if (typeof raw !== 'string') return input;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Truncated JSON: pull out the string fields the classifier needs.
    const out: Record<string, string> = {};
    for (const key of ['command', 'skill']) {
      const m = new RegExp(`"${key}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`).exec(raw);
      if (m) out[key] = JSON.parse(m[1]!) as string;
    }
    return out;
  }
}

function getSkillName(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const skill = (input as { skill?: unknown }).skill;
  return typeof skill === 'string' ? skill : null;
}

function getBashCommand(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const command = (input as { command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
}

const ALWAYS_BLOCKED = new Set<string>(ALWAYS_BLOCKED_TOOLS);
const PLANNING = new Set<string>(PLANNING_TOOLS);
/** MCP's own resource tools read from the configured MCP server, so they count as MCP surface. */
const MCP_RESOURCE_TOOLS = new Set(['ListMcpResourcesTool', 'ReadMcpResourceTool']);

type Verdict = { surfaceReason: string | null; granularityReason: string | null };
const OK: Verdict = { surfaceReason: null, granularityReason: null };
const violation = (reason: string): Verdict => ({ surfaceReason: reason, granularityReason: reason });

/**
 * Allow-list classification: a call is in surface only if the arm was given the
 * tool (or it is a planning tool), with extra checks for Skill and Bash in the
 * skill arm and for the MCP prefix in the mcp arm.
 */
export function classifyToolUse(
  arm: Arm,
  classifier: ExperimentClassifier,
  armTools: readonly string[],
  name: string,
  input: unknown,
): Verdict {
  if (ALWAYS_BLOCKED.has(name)) return violation(`${name} is an out-of-band execution or fetch path`);
  if (PLANNING.has(name)) return OK;

  if (name.startsWith('mcp__') || MCP_RESOURCE_TOOLS.has(name)) {
    const intended = arm === 'mcp' && (name.startsWith(classifier.intendedMcpPrefix) || MCP_RESOURCE_TOOLS.has(name));
    return intended ? OK : violation(`${name} is not allowed in the ${arm} arm`);
  }

  if (!armTools.includes(name)) return violation(`${name} is not allowed in the ${arm} arm`);

  if (name === 'Skill') {
    const skill = getSkillName(input);
    return skill === classifier.intendedSkillName ? OK : violation(`unexpected skill ${skill ?? '(unknown)'}`);
  }
  if (name === 'Bash') {
    const command = getBashCommand(input);
    if (!command) return violation('Bash command missing command text');
    return classifier.classifyShellCommand(command);
  }
  return OK;
}

export function parseTranscript(
  rawLines: string[],
  arm: Arm,
  classifier: ExperimentClassifier,
  opts: ParseOptions,
): Metrics {
  const events: StreamEvent[] = [];
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      events.push(JSON.parse(trimmed) as StreamEvent);
    } catch {
      // skip malformed
    }
  }

  const metrics: Metrics = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    toolCalls: [],
    toolCallCount: 0,
    turns: 0,
    wallClockMs: 0,
    contextWindowPeak: 0,
    totalCostUsd: 0,
    modelsUsed: [],
    usedIntendedTool: false,
    validToolSurface: true,
    escapeToolUsed: false,
    escapeToolCalls: [],
    singleCliCommandPerToolCall: true,
    cliCommandGranularityViolations: [],
    incomplete: true,
    tokensEstimated: false,
  };

  let turnIndex = 0;
  // Last usage seen per API message. Claude Code emits one assistant event per
  // content block, each repeating its message's usage.
  const usageByMessage = new Map<string, NonNullable<AssistantEvent['message']['usage']>>();

  for (const event of events) {
    if (event.type === 'assistant') {
      const e = event as AssistantEvent;
      turnIndex++;
      metrics.turns++;

      const usage = e.message.usage;
      if (usage) {
        usageByMessage.set(e.message.id ?? `turn-${turnIndex}`, usage);
        const tokensInContext =
          (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
        if (tokensInContext > metrics.contextWindowPeak) {
          metrics.contextWindowPeak = tokensInContext;
        }
      }

      for (const raw of e.message.content) {
        const block = raw.type === 'tool_use' ? { ...raw, input: normalizeToolInput(raw.input) } : raw;
        if (block.type === 'tool_use') {
          const command = block.name === 'Bash' ? getBashCommand(block.input) : undefined;
          const record: ToolCallRecord = {
            name: block.name,
            turnIndex,
            ...(command ? { command } : {}),
          };
          metrics.toolCalls.push(record);
          metrics.toolCallCount++;
          if (block.name.startsWith(classifier.intendedMcpPrefix)) {
            metrics.usedIntendedTool = true;
          } else if (block.name === 'Skill') {
            if (getSkillName(block.input) === classifier.intendedSkillName) {
              metrics.usedIntendedTool = true;
            }
          }

          const { surfaceReason, granularityReason } = classifyToolUse(
            arm,
            classifier,
            opts.armTools,
            block.name,
            block.input,
          );
          if (surfaceReason) {
            metrics.validToolSurface = false;
            metrics.escapeToolUsed = true;
            metrics.escapeToolCalls.push({ ...record, reason: surfaceReason });
          }
          if (granularityReason) {
            metrics.singleCliCommandPerToolCall = false;
            metrics.cliCommandGranularityViolations.push({ ...record, reason: granularityReason });
          }
        }
      }
    }

    if (event.type === 'result') {
      const e = event as ResultEvent;
      metrics.incomplete = false;
      metrics.wallClockMs = e.duration_ms ?? 0;
      metrics.totalCostUsd = e.total_cost_usd ?? 0;

      if (e.modelUsage && typeof e.modelUsage === 'object') {
        for (const [model, u] of Object.entries(e.modelUsage)) {
          metrics.modelsUsed.push(model);
          metrics.inputTokens += u.inputTokens ?? 0;
          metrics.outputTokens += u.outputTokens ?? 0;
          metrics.cachedInputTokens += u.cacheReadInputTokens ?? 0;
          metrics.cacheCreationInputTokens += u.cacheCreationInputTokens ?? 0;
        }
      } else if (e.usage) {
        metrics.inputTokens = e.usage.input_tokens ?? 0;
        metrics.outputTokens = e.usage.output_tokens ?? 0;
        metrics.cachedInputTokens = e.usage.cache_read_input_tokens ?? 0;
        metrics.cacheCreationInputTokens = e.usage.cache_creation_input_tokens ?? 0;
      }
    }
  }

  if (metrics.incomplete) {
    // No final totals. Sum what each API message reported. Output tokens in
    // streamed usage are partial and side-model calls are missing, so this is
    // a lower bound rather than the true cost.
    for (const u of usageByMessage.values()) {
      metrics.inputTokens += u.input_tokens ?? 0;
      metrics.outputTokens += u.output_tokens ?? 0;
      metrics.cachedInputTokens += u.cache_read_input_tokens ?? 0;
      metrics.cacheCreationInputTokens += u.cache_creation_input_tokens ?? 0;
    }
    metrics.tokensEstimated = usageByMessage.size > 0;
    metrics.wallClockMs = opts.fallbackWallClockMs ?? 0;
  }

  return metrics;
}
