import { execa } from 'execa';
import { mkdir, mkdtemp, cp, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { Arm, ArmConfig, ExperimentSpec } from './experiment.js';
import type { Task, SuccessResult, TaskContext } from './tasks.js';
import { parseTranscript } from './metrics.js';
import type { Metrics } from './metrics.js';
import { startFixtureServer, type FixtureServer } from './fixtureServer.js';
import { mkPairedSeed } from './trialState.js';
import { ALWAYS_BLOCKED_TOOLS, COMMON_CLAUDE_FLAGS, DEFAULT_MODEL, TRIAL_TIMEOUT_MS } from './config.js';
import { redactTranscript, redactHomePaths } from './redact.js';

export interface TrialResult {
  experiment: string;
  runName?: string;
  arm: Arm;
  taskId: string;
  tier: number;
  trialN: number;
  timestamp: string;
  seed: string;
  metrics: Metrics;
  success: SuccessResult;
  error?: string;
}

export interface RunTrialOptions {
  experiment: ExperimentSpec;
  runName: string;
  arm: Arm;
  task: Task;
  trialN: number;
  rootDir: string;
  model?: string;
  requireSingleCliCommand?: boolean;
  /** Executable to run instead of `claude`. Tests point this at a fake. */
  claudeCommand?: string;
  timeoutMs?: number;
}

export function artifactRoot(rootDir: string, experiment: string, runName: string): string {
  return join(rootDir, 'experiments', experiment, 'runs', runName);
}

/**
 * Settings passed with `--settings`. File tools may not read or edit anything
 * under the home directory or the repo, so an agent can't pull answers or
 * personal files from outside its trial directory. Arms with `sandboxNetwork`
 * also run Bash in Claude Code's OS sandbox, with no unsandboxed fallback.
 */
export function buildTrialSettings(armConfig: ArmConfig, rootDir: string): Record<string, unknown> {
  const repo = `//${resolve(rootDir).replace(/^\/+/, '')}/**`;
  const settings: Record<string, unknown> = {
    permissions: {
      deny: ['Read(~/**)', 'Edit(~/**)', `Read(${repo})`, `Edit(${repo})`],
    },
  };
  if (armConfig.sandboxNetwork) {
    settings.sandbox = {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      autoAllowBashIfSandboxed: true,
      filesystem: { denyRead: ['~/'] },
      network: { allowedDomains: [...armConfig.sandboxNetwork] },
    };
  }
  return settings;
}

export function buildClaudeArgs(
  armConfig: ArmConfig,
  prompt: string,
  model: string,
  rootDir: string,
  outputFormat: 'text' | 'stream-json' = 'stream-json',
): string[] {
  const mcpConfig = armConfig.mcpConfig.startsWith('{') ? armConfig.mcpConfig : resolve(rootDir, armConfig.mcpConfig);

  const args = [
    '-p',
    prompt,
    '--output-format',
    outputFormat,
    '--model',
    model,
    '--strict-mcp-config',
    '--mcp-config',
    mcpConfig,
    '--tools',
    armConfig.tools.join(','),
    '--disallowed-tools',
    ALWAYS_BLOCKED_TOOLS.join(' '),
    '--settings',
    JSON.stringify(buildTrialSettings(armConfig, rootDir)),
    ...COMMON_CLAUDE_FLAGS,
  ];
  if (outputFormat === 'stream-json') args.push('--verbose');
  return args;
}

/**
 * Builds the child env. Every inherited GH_* / GITHUB_* variable is removed
 * (the developer's PATs, the harness's own controller token, host overrides),
 * then gh is pointed at an empty per-trial config dir so it can't fall back to
 * the developer's saved login. The arm's own vars and the agent token go back
 * in last.
 */
export function buildChildEnv(
  armEnv: Record<string, string> | undefined,
  agentEnv: Record<string, string>,
  ghConfigDir: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(baseEnv)) {
    if (/^(GH|GITHUB)_/.test(k)) continue;
    env[k] = v;
  }
  env.GH_CONFIG_DIR = ghConfigDir;
  env.GH_NO_UPDATE_NOTIFIER = '1';
  env.GH_PROMPT_DISABLED = '1';
  env.GH_PAGER = 'cat';
  for (const [k, v] of Object.entries(armEnv ?? {})) env[k] = v;
  for (const [k, v] of Object.entries(agentEnv)) env[k] = v;
  return env;
}

export async function copySkill(skillName: string, rootDir: string, workDir: string): Promise<void> {
  const target = join(workDir, '.claude', 'skills', skillName);
  await mkdir(target, { recursive: true });
  await cp(join(rootDir, '.claude', 'skills', skillName), target, { recursive: true });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runTrial(opts: RunTrialOptions): Promise<TrialResult> {
  const {
    experiment,
    runName,
    arm,
    task,
    trialN,
    rootDir,
    model = DEFAULT_MODEL,
    requireSingleCliCommand = false,
    claudeCommand = 'claude',
    timeoutMs = TRIAL_TIMEOUT_MS,
  } = opts;
  const armConfig = experiment.arms[arm];

  const artifactsRoot = artifactRoot(rootDir, experiment.name, runName);
  const resultsDir = join(artifactsRoot, 'results', arm, task.id);
  const transcriptsDir = join(artifactsRoot, 'transcripts', arm, task.id);
  const persistentOutputDir = join(resultsDir, String(trialN));
  const fixturesPath = join(rootDir, 'experiments', experiment.name, 'fixtures');
  await mkdir(resultsDir, { recursive: true });
  await mkdir(transcriptsDir, { recursive: true });

  const trialWorkDir = await mkdtemp(join(tmpdir(), `clivsmcp-${experiment.name}-${arm}-${task.id}-`));
  const ghConfigDir = await mkdtemp(join(tmpdir(), 'clivsmcp-ghconfig-'));
  const seed = mkPairedSeed(experiment.name, runName, task.id, trialN);
  const timestamp = new Date().toISOString();

  let state: unknown = null;
  let setupDone = false;
  let fixtureServer: FixtureServer | undefined;
  let cliError: string | undefined;
  let cleanupNote: string | undefined;
  let metrics: Metrics;
  let success: SuccessResult;

  try {
    if (arm === 'skill') await copySkill(experiment.classifier.intendedSkillName, rootDir, trialWorkDir);

    state = task.setup ? await task.setup(seed) : null;
    setupDone = true;

    fixtureServer = await startFixtureServer(
      fixturesPath,
      task.renderResponse ? (req, res, body) => task.renderResponse!(state, req, res, body) : undefined,
    );
    const ctx: TaskContext = { rootDir, fixturesPath, fixturesUrl: fixtureServer.url, outputDir: trialWorkDir, state };

    let prompt = task.prompt(ctx);
    if (arm === 'skill' && requireSingleCliCommand) {
      prompt += `\n\nStrict research accounting requirement: use exactly one ${experiment.classifier.intendedShellCommand} command per Bash tool call. Do not chain commands with &&, ;, pipes, redirects, or shell substitutions.`;
    }
    const args = buildClaudeArgs(armConfig, prompt, model, rootDir, 'stream-json');
    const agentEnv = experiment.buildAgentEnv ? experiment.buildAgentEnv(arm) : {};
    const childEnv = buildChildEnv(armConfig.extraEnv, agentEnv, ghConfigDir);

    let stdout = '';
    let stderr = '';
    let durationMs = 0;
    try {
      const result = await execa(claudeCommand, args, {
        cwd: trialWorkDir,
        reject: false,
        stdin: 'ignore',
        timeout: timeoutMs,
        env: childEnv,
        extendEnv: false,
      });
      stdout = result.stdout ?? '';
      stderr = result.stderr ?? '';
      durationMs = result.durationMs;
      if (result.timedOut) cliError = `claude timed out after ${timeoutMs}ms`;
      else if (result.exitCode !== 0) cliError = stderr || `claude exited with code ${result.exitCode}`;
    } catch (err) {
      cliError = errorMessage(err);
    }

    const home = homedir();
    const transcript = redactTranscript(stdout, home, trialWorkDir);
    await writeFile(join(transcriptsDir, `${trialN}.jsonl`), transcript, 'utf-8');
    if (stderr.trim()) {
      await writeFile(join(transcriptsDir, `${trialN}.stderr.log`), redactHomePaths(stderr, home), 'utf-8');
    }
    if (cliError) cliError = redactHomePaths(cliError, home);

    metrics = parseTranscript(transcript.split('\n'), arm, experiment.classifier, {
      armTools: armConfig.tools,
      fallbackWallClockMs: durationMs,
    });

    await rm(persistentOutputDir, { recursive: true, force: true });
    await cp(trialWorkDir, persistentOutputDir, {
      recursive: true,
      filter: src => !src.slice(trialWorkDir.length).split(sep).includes('.claude'),
    });

    try {
      success = await task.successCheck({ ...ctx, outputDir: persistentOutputDir });
    } catch (err) {
      success = { pass: false, score: 0, notes: `successCheck threw: ${errorMessage(err)}` };
    }
  } finally {
    await fixtureServer?.close().catch(() => undefined);
    if (setupDone && task.cleanup) {
      try {
        await task.cleanup(state);
      } catch (err) {
        cleanupNote = `cleanup threw: ${errorMessage(err)}`;
      }
    }
    await rm(trialWorkDir, { recursive: true, force: true });
    await rm(ghConfigDir, { recursive: true, force: true });
  }

  if (cleanupNote) success.notes = success.notes ? `${success.notes}\n${cleanupNote}` : cleanupNote;

  const trialResult: TrialResult = {
    experiment: experiment.name,
    runName,
    arm,
    taskId: task.id,
    tier: task.tier,
    trialN,
    timestamp,
    seed,
    metrics,
    success,
    ...(cliError ? { error: cliError } : {}),
  };
  // Success notes often quote output paths, which sit under the repo (and so the home dir).
  await writeFile(
    join(resultsDir, `${trialN}.json`),
    redactHomePaths(JSON.stringify(trialResult, null, 2), homedir()),
    'utf-8',
  );
  return trialResult;
}
