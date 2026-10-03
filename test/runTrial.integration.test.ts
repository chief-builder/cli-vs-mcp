import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execa } from 'execa';
import { runTrial } from '../harness/src/runner.js';
import { generateReport } from '../harness/src/report.js';
import { playwrightExperiment } from '../harness/src/experiments/playwright.js';
import { tasks } from '../experiments/playwright/tasks/index.js';
import type { ExperimentSpec } from '../harness/src/experiment.js';
import type { Task } from '../harness/src/tasks.js';

const REPO = resolve(import.meta.dirname, '..');
const FAKE_CLAUDE = join(REPO, 'test', 'fixtures', 'fake-claude.mjs');
const scrape = tasks.find(t => t.id === 'tier1_scrape')!;

let rootDir: string;

beforeAll(async () => {
  // A throwaway repo root with the real Playwright fixtures and skills.
  rootDir = await mkdtemp(join(tmpdir(), 'clivsmcp-it-'));
  await mkdir(join(rootDir, 'experiments', 'playwright'), { recursive: true });
  await cp(
    join(REPO, 'experiments', 'playwright', 'fixtures'),
    join(rootDir, 'experiments', 'playwright', 'fixtures'),
    {
      recursive: true,
    },
  );
  await cp(join(REPO, '.claude', 'skills'), join(rootDir, '.claude', 'skills'), { recursive: true });
  process.env.GITHUB_CONTROLLER_TOKEN = 'controller-secret-for-test';
});

afterAll(async () => {
  delete process.env.GITHUB_CONTROLLER_TOKEN;
  delete process.env.FAKE_CLAUDE_MODE;
  await rm(rootDir, { recursive: true, force: true });
});

describe('runTrial end to end (fake claude)', () => {
  it('runs tier1_scrape through the fixture server and scores it', async () => {
    process.env.FAKE_CLAUDE_MODE = 'scrape';
    const result = await runTrial({
      experiment: playwrightExperiment,
      runName: 'it',
      arm: 'baseline',
      task: scrape,
      trialN: 1,
      rootDir,
      claudeCommand: FAKE_CLAUDE,
    });

    expect(result.error).toBeUndefined();
    expect(result.success.pass).toBe(true);
    expect(result.metrics).toMatchObject({
      incomplete: false,
      wallClockMs: 1234,
      inputTokens: 10,
      cachedInputTokens: 2000,
      toolCallCount: 2,
      validToolSurface: true,
    });

    const runDir = join(rootDir, 'experiments', 'playwright', 'runs', 'it');
    const stored = JSON.parse(await readFile(join(runDir, 'results', 'baseline', 'tier1_scrape', '1.json'), 'utf-8'));
    expect(stored.success.pass).toBe(true);
    const storedRaw = await readFile(join(runDir, 'results', 'baseline', 'tier1_scrape', '1.json'), 'utf-8');
    expect(storedRaw).not.toContain(homedir() + '/');

    // The transcript on disk is redacted: no home path, no out-of-trial file content.
    const transcript = await readFile(join(runDir, 'transcripts', 'baseline', 'tier1_scrape', '1.jsonl'), 'utf-8');
    expect(transcript).not.toContain('private@example.invalid');
    expect(transcript).not.toContain(homedir() + '/');
    expect(transcript).toContain('~/.gitconfig');

    // The child saw no inherited GitHub credentials and an empty gh config dir.
    const childEnv = JSON.parse(
      await readFile(join(runDir, 'results', 'baseline', 'tier1_scrape', '1', 'child-env.json'), 'utf-8'),
    ) as { ghVars: string[]; ghConfigDir: string; args: string[]; cwd: string };
    expect(childEnv.ghVars).not.toContain('GITHUB_CONTROLLER_TOKEN');
    expect(childEnv.ghConfigDir).toMatch(/clivsmcp-ghconfig-/);
    expect(childEnv.args).toContain('--tools');

    // This trial's directories are cleaned up. (Checked by path: other harness runs may share tmpdir.)
    expect(existsSync(childEnv.ghConfigDir)).toBe(false);
    expect(existsSync(childEnv.cwd)).toBe(false);

    const report = await generateReport({
      rootDir,
      experiment: 'playwright',
      runName: 'it',
      allTiers: true,
      crossover: true,
    });
    expect(report).toContain('| tier1_scrape | 1 | baseline | 1 | 0 | 100% | 100% |');
  });

  it('flags the same transcript as out of surface in the mcp arm', async () => {
    process.env.FAKE_CLAUDE_MODE = 'scrape';
    const result = await runTrial({
      experiment: playwrightExperiment,
      runName: 'it',
      arm: 'mcp',
      task: scrape,
      trialN: 1,
      rootDir,
      claudeCommand: FAKE_CLAUDE,
    });
    expect(result.success.pass).toBe(true);
    expect(result.metrics.validToolSurface).toBe(false);
    expect(result.metrics.escapeToolCalls[0]?.reason).toMatch(/Read is not allowed in the mcp arm/);
  });

  it('records a timeout with estimated tokens and still runs cleanup', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang';
    let cleaned = false;
    const task: Task = { ...scrape, id: 'tier1_hang', cleanup: () => void (cleaned = true) };
    const result = await runTrial({
      experiment: playwrightExperiment,
      runName: 'it',
      arm: 'baseline',
      task,
      trialN: 1,
      rootDir,
      claudeCommand: FAKE_CLAUDE,
      timeoutMs: 1500,
    });
    expect(result.error).toMatch(/timed out after 1500ms/);
    expect(result.success.pass).toBe(false);
    expect(result.metrics).toMatchObject({ incomplete: true, tokensEstimated: true, cachedInputTokens: 100 });
    expect(result.metrics.wallClockMs).toBeGreaterThanOrEqual(1500);
    expect(cleaned).toBe(true);
  });

  it('runs cleanup and propagates the error when the trial fails after setup', async () => {
    let cleaned = false;
    const broken: ExperimentSpec = {
      ...playwrightExperiment,
      buildAgentEnv: () => {
        throw new Error('env builder failed');
      },
    };
    const task: Task = { ...scrape, id: 'tier1_broken', cleanup: () => void (cleaned = true) };
    await expect(
      runTrial({
        experiment: broken,
        runName: 'it',
        arm: 'baseline',
        task,
        trialN: 1,
        rootDir,
        claudeCommand: FAKE_CLAUDE,
      }),
    ).rejects.toThrow(/env builder failed/);
    expect(cleaned).toBe(true);
  });
});

describe('CLI argument validation', () => {
  const cli = (...args: string[]) =>
    execa('node', ['--import', 'tsx', join(REPO, 'harness', 'src', 'cli.ts'), ...args], { cwd: REPO, reject: false });

  it('rejects a non-numeric trial count', async () => {
    const r = await cli('run', '--experiment', 'playwright', '--run', 'x', '--arm', 'skill', '--trials', 'abc');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/--trials.*positive integer/);
  });

  it('rejects run names that could escape the runs directory', async () => {
    const r = await cli('run', '--experiment', 'playwright', '--run', '../../x', '--arm', 'skill', '--trials', '1');
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/--run/);
  });

  it('rejects unknown experiments and arms without a stack trace', async () => {
    const r1 = await cli('report', '--experiment', 'nope', '--run', 'x');
    expect(r1.exitCode).not.toBe(0);
    expect(r1.stderr).toMatch(/Unknown experiment "nope"/);
    expect(r1.stderr).not.toMatch(/at .*\.ts:\d+/);
    const r2 = await cli('verify-arms', '--experiment', 'playwright', '--arm', 'everything');
    expect(r2.stderr).toMatch(/must be one of: baseline, skill, mcp/);
  });

  it('fails GitHub preflight cleanly when configuration is missing', async () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GH|GITHUB)_/.test(k)));
    const r = await execa(
      'node',
      [
        '--import',
        'tsx',
        join(REPO, 'harness', 'src', 'cli.ts'),
        'run',
        '--experiment',
        'github',
        '--run',
        'x',
        '--arm',
        'skill',
        '--trials',
        '1',
      ],
      { cwd: REPO, reject: false, env, extendEnv: false },
    );
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/GITHUB_AGENT_TOKEN is required/);
  });
});
