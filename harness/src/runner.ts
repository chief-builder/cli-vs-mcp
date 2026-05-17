import { execa } from 'execa';
import { mkdir, mkdtemp, cp, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { Arm, ArmConfig, ExperimentSpec } from './experiment.js';
import type { Task, SuccessResult, TaskContext } from './tasks.js';
import { parseTranscript } from './metrics.js';
import type { Metrics } from './metrics.js';
import { startFixtureServer } from './fixtureServer.js';
import { mkPairedSeed } from './trialState.js';

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
  agentEnv?: Record<string, string>;
}

function artifactRoot(rootDir: string, experiment: string, runName: string): string {
  return join(rootDir, 'experiments', experiment, 'runs', runName);
}

export function buildClaudeArgs(
  armConfig: ArmConfig,
  prompt: string,
  model: string,
  rootDir: string,
  outputFormat: 'text' | 'stream-json' = 'stream-json',
): string[] {
  const mcpConfig = armConfig.mcpConfig.startsWith('{')
    ? armConfig.mcpConfig
    : resolve(rootDir, armConfig.mcpConfig);

  const args = [
    '-p', prompt,
    '--output-format', outputFormat,
    '--model', model,
    '--strict-mcp-config',
    '--mcp-config', mcpConfig,
  ];

  if (outputFormat === 'stream-json') {
    args.push('--verbose');
  }

  if (armConfig.allowedTools && armConfig.allowedTools.length > 0) {
    args.push('--allowed-tools', armConfig.allowedTools.join(' '));
  }

  if (armConfig.disallowedTools.length > 0) {
    args.push('--disallowed-tools', armConfig.disallowedTools.join(' '));
  }

  args.push(...armConfig.extraFlags);

  return args;
}

/**
 * Scrubs inherited GitHub credentials so the child process can't pick up the
 * developer's personal `gh` login or PATs. Kept in the harness because every
 * experiment runs under the same cleanroom assumption.
 */
const GITHUB_ENV_TO_SCRUB = [
  // Harness-internal names — must not survive into the agent child.
  // GITHUB_CONTROLLER_TOKEN is the elevated credential used to provision
  // sandbox state; its presence in the child env would give the agent a
  // path to escalation via `GH_TOKEN=$GITHUB_CONTROLLER_TOKEN gh api ...`.
  // GITHUB_AGENT_TOKEN is the raw form; buildGithubAgentEnv injects the
  // value under GH_TOKEN / GITHUB_TOKEN per arm, so the raw name has no
  // legitimate use inside the child.
  'GITHUB_CONTROLLER_TOKEN',
  'GITHUB_AGENT_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GITHUB_PERSONAL_ACCESS_TOKEN',
  'GH_HOST',
  'GITHUB_HOST',
  'GH_REPO',
  'GH_PAGER',
  'GH_EDITOR',
  'GH_BROWSER',
  'GH_FORCE_TTY',
  'GH_PROMPT_DISABLED',
  'GH_CONFIG_DIR',
  'GITHUB_TOOLSETS',
];

function buildChildEnv(armEnv: Record<string, string> | undefined, agentEnv: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of GITHUB_ENV_TO_SCRUB) {
    delete env[key];
  }
  // Disable update notifiers/pagers so they don't stall the child.
  env.GH_NO_UPDATE_NOTIFIER = '1';
  env.GH_PROMPT_DISABLED = '1';
  env.GH_PAGER = 'cat';
  if (armEnv) {
    for (const [k, v] of Object.entries(armEnv)) env[k] = v;
  }
  for (const [k, v] of Object.entries(agentEnv)) env[k] = v;
  return env;
}

async function copySkill(skillName: string, rootDir: string, trialWorkDir: string): Promise<void> {
  const skillDir = join(trialWorkDir, '.claude', 'skills', skillName);
  await mkdir(skillDir, { recursive: true });
  const sourceDir = join(rootDir, '.claude', 'skills', skillName);
  await cp(sourceDir, skillDir, { recursive: true });
}

export async function runTrial(opts: RunTrialOptions): Promise<TrialResult> {
  const {
    experiment,
    runName,
    arm,
    task,
    trialN,
    rootDir,
    model = 'claude-sonnet-4-6',
    requireSingleCliCommand = false,
    agentEnv = {},
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

  if (arm === 'skill') {
    await copySkill(experiment.classifier.intendedSkillName, rootDir, trialWorkDir);
  }

  const runtimeAgentEnv = experiment.buildAgentEnv ? experiment.buildAgentEnv(arm) : {};
  const seed = mkPairedSeed(experiment.name, runName, task.id, trialN);
  const state = task.setup ? await task.setup(seed) : null;

  const fixtureServer = await startFixtureServer(
    fixturesPath,
    task.renderResponse
      ? (req, res, body) => task.renderResponse!(state, req, res, body)
      : undefined,
  );
  const ctx: TaskContext = {
    rootDir,
    fixturesPath,
    fixturesUrl: fixtureServer.url,
    outputDir: trialWorkDir,
    state,
  };
  const timestamp = new Date().toISOString();
  let prompt = task.prompt(ctx);
  if (arm === 'skill' && requireSingleCliCommand) {
    prompt += `\n\nStrict research accounting requirement: use exactly one ${experiment.classifier.intendedShellCommand} command per Bash tool call. Do not chain commands with &&, ;, pipes, redirects, or shell substitutions.`;
  }
  const args = buildClaudeArgs(armConfig, prompt, model, rootDir, 'stream-json');
  const childEnv = buildChildEnv(armConfig.extraEnv, { ...runtimeAgentEnv, ...agentEnv });

  let transcriptLines: string[] = [];
  let stderrText = '';
  let cliError: string | undefined;

  const TRIAL_TIMEOUT_MS = 240_000;

  try {
    const result = await execa('claude', args, {
      cwd: trialWorkDir,
      reject: false,
      stdin: 'ignore',
      timeout: TRIAL_TIMEOUT_MS,
      env: childEnv,
    });

    transcriptLines = (result.stdout ?? '').split('\n');
    stderrText = result.stderr ?? '';

    if (result.timedOut) {
      cliError = `claude timed out after ${TRIAL_TIMEOUT_MS}ms`;
    } else if (result.exitCode !== 0) {
      cliError = stderrText || `claude exited with code ${result.exitCode}`;
    }
  } catch (err) {
    cliError = err instanceof Error ? err.message : String(err);
  } finally {
    await fixtureServer.close().catch(() => undefined);
  }

  await writeFile(
    join(transcriptsDir, `${trialN}.jsonl`),
    transcriptLines.join('\n'),
    'utf-8',
  );

  if (stderrText.trim()) {
    await writeFile(join(transcriptsDir, `${trialN}.stderr.log`), stderrText, 'utf-8');
  }

  await rm(persistentOutputDir, { recursive: true, force: true });
  await cp(trialWorkDir, persistentOutputDir, {
    recursive: true,
    filter: (src) => !src.includes(`${sep}.claude`),
  });
  await rm(trialWorkDir, { recursive: true, force: true });

  const persistentCtx: TaskContext = { ...ctx, outputDir: persistentOutputDir };

  const metrics = parseTranscript(transcriptLines, arm, experiment.classifier);

  let success: SuccessResult;
  try {
    success = await task.successCheck(persistentCtx);
  } catch (err) {
    success = {
      pass: false,
      score: 0,
      notes: `successCheck threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (task.cleanup) {
    try {
      await task.cleanup(state);
    } catch (err) {
      const note = `cleanup threw: ${err instanceof Error ? err.message : String(err)}`;
      success.notes = success.notes ? `${success.notes}\n${note}` : note;
    }
  }

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

  await writeFile(
    join(resultsDir, `${trialN}.json`),
    JSON.stringify(trialResult, null, 2),
    'utf-8',
  );

  return trialResult;
}
