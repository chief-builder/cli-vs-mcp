import { Command, InvalidArgumentError } from 'commander';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execa } from 'execa';
import { ArmSchema, ARMS } from './experiment.js';
import type { Arm, ExperimentSpec } from './experiment.js';
import { artifactRoot, buildClaudeArgs, buildChildEnv, copySkill, runTrial } from './runner.js';
import type { Task } from './tasks.js';
import { generateReport } from './report.js';
import { parseTranscript } from './metrics.js';
import { getExperiment, experiments } from './experiments/index.js';
import { DEFAULT_MODEL, RUN_NAME_PATTERN } from './config.js';
import { redactHomePaths, redactTranscript } from './redact.js';
import { log } from './log.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

// ---------------------------------------------------------------------------
// argument parsing
// ---------------------------------------------------------------------------

function positiveInt(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError('must be a positive integer');
  return n;
}

function tierNumber(value: string): number {
  const n = Number(value);
  if (![1, 2, 3].includes(n)) throw new InvalidArgumentError('must be 1, 2, or 3');
  return n;
}

function armName(value: string): Arm {
  const parsed = ArmSchema.safeParse(value);
  if (!parsed.success) throw new InvalidArgumentError(`must be one of: ${ARMS.join(', ')}`);
  return parsed.data;
}

function runName(value: string): string {
  if (!RUN_NAME_PATTERN.test(value)) {
    throw new InvalidArgumentError('use letters, digits, ".", "_" or "-" (max 64 chars, no path separators)');
  }
  return value;
}

function experimentName(value: string): ExperimentSpec {
  try {
    return getExperiment(value);
  } catch (err) {
    throw new InvalidArgumentError(err instanceof Error ? err.message : String(err));
  }
}

async function loadTasks(rootDir: string, tasksPath: string): Promise<Task[]> {
  const mod = (await import(pathToFileURL(join(rootDir, tasksPath)).href)) as { tasks: Task[] };
  return mod.tasks;
}

async function collectFiles(dir: string, keep: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectFiles(path, keep)));
    else if (keep(entry.name)) out.push(path);
  }
  return out;
}

function fail(msg: string): never {
  log.error(msg);
  process.exit(1);
}

const program = new Command();
program.name('harness').description('CLI vs MCP experiment harness — Playwright and GitHub').version(pkg.version);

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
program
  .command('run')
  .description('Run experiment trials')
  .requiredOption('--experiment <name>', `experiment: ${Object.keys(experiments).join(' | ')}`, experimentName)
  .requiredOption('--run <name>', 'run namespace (results go under experiments/<exp>/runs/<run>)', runName)
  .requiredOption('--arm <arm>', `arm: ${ARMS.join(' | ')}`, armName)
  .requiredOption('--trials <n>', 'trials per task', positiveInt)
  .option('--task <id>', 'run one task by ID')
  .option('--tier <n>', 'run every task in this tier', tierNumber)
  .option('--model <model>', 'Claude model ID', DEFAULT_MODEL)
  .option('--single-cli-command', 'research mode: require one intended-CLI command per Bash call', false)
  .action(
    async (opts: {
      experiment: ExperimentSpec;
      run: string;
      arm: Arm;
      trials: number;
      task?: string;
      tier?: number;
      model: string;
      singleCliCommand: boolean;
    }) => {
      const experiment = opts.experiment;
      const rootDir = resolve(process.cwd());
      if (opts.task && opts.tier !== undefined) fail('Use either --task or --tier, not both.');

      if (experiment.preflight) {
        try {
          await experiment.preflight();
        } catch (err) {
          fail(`Preflight failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      let tasks: Task[];
      try {
        tasks = await loadTasks(rootDir, experiment.tasksPath);
      } catch (err) {
        fail(`Cannot load tasks for "${experiment.name}": ${err instanceof Error ? err.message : String(err)}`);
      }

      let selected = tasks;
      if (opts.task) {
        selected = tasks.filter(t => t.id === opts.task);
        if (selected.length === 0) fail(`Task "${opts.task}" not found. Known: ${tasks.map(t => t.id).join(', ')}`);
      } else if (opts.tier !== undefined) {
        selected = tasks.filter(t => t.tier === opts.tier);
        if (selected.length === 0) fail(`No tasks in tier ${opts.tier}.`);
      }

      let failures = 0;
      for (const task of selected) {
        for (let n = 1; n <= opts.trials; n++) {
          log.info(`→ ${experiment.name}/${opts.run}  ${task.id}  arm=${opts.arm}  trial=${n}/${opts.trials}`);
          try {
            const result = await runTrial({
              experiment,
              runName: opts.run,
              arm: opts.arm,
              task,
              trialN: n,
              rootDir,
              model: opts.model,
              requireSingleCliCommand: opts.singleCliCommand,
            });
            const m = result.metrics;
            const valid = m.validToolSurface && (!opts.singleCliCommand || m.singleCliCommandPerToolCall);
            log.info(
              `  ${result.success.pass ? '✓' : '✗'} score=${result.success.score.toFixed(2)}  ${valid ? 'valid' : 'INVALID'}`,
              {
                tokens_in: m.inputTokens,
                turns: m.turns,
                time: `${(m.wallClockMs / 1000).toFixed(1)}s`,
              },
            );
            if (result.error) log.warn('  trial error', { error: result.error });
          } catch (err) {
            failures++;
            log.error(`  trial ${n} threw`, { error: err });
          }
        }
      }
      if (failures > 0) process.exitCode = 1;
    },
  );

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
program
  .command('report')
  .description('Generate a markdown report from stored results')
  .requiredOption('--experiment <name>', 'experiment name', experimentName)
  .requiredOption('--run <name>', 'run namespace', runName)
  .option('--tier <n>', 'report on one tier', tierNumber)
  .option('--all-tiers', 'include all tiers', false)
  .option('--crossover-analysis', 'include the skill-vs-mcp crossover section', false)
  .option('--single-cli-command', 'research mode: chained CLI Bash calls count as invalid surface', false)
  .option('--include-cost', 'append a USD cost appendix', false)
  .option('--output <path>', 'write the report to a file instead of stdout')
  .action(
    async (opts: {
      experiment: ExperimentSpec;
      run: string;
      tier?: number;
      allTiers: boolean;
      crossoverAnalysis: boolean;
      singleCliCommand: boolean;
      includeCost: boolean;
      output?: string;
    }) => {
      const report = await generateReport({
        rootDir: resolve(process.cwd()),
        // github and github-rw share one storage name; the spec resolves it.
        experiment: opts.experiment.name,
        runName: opts.run,
        ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
        allTiers: opts.allTiers,
        crossover: opts.crossoverAnalysis,
        requireSingleCliCommand: opts.singleCliCommand,
        includeCost: opts.includeCost,
      });
      if (opts.output) {
        await writeFile(opts.output, report, 'utf-8');
        log.info(`Report written to ${opts.output}`);
      } else {
        process.stdout.write(report + '\n');
      }
    },
  );

// ---------------------------------------------------------------------------
// recompute-metrics
// ---------------------------------------------------------------------------
program
  .command('recompute-metrics')
  .description('Re-parse stored transcripts and update result metrics in place (does not re-run claude)')
  .requiredOption('--experiment <name>', 'experiment name', experimentName)
  .requiredOption('--run <name>', 'run namespace', runName)
  .option('--arm <arm>', 'one arm (default: all)', armName)
  .action(async (opts: { experiment: ExperimentSpec; run: string; arm?: Arm }) => {
    const experiment = opts.experiment;
    const root = artifactRoot(resolve(process.cwd()), experiment.name, opts.run);
    let updated = 0;
    let missing = 0;
    for (const arm of opts.arm ? [opts.arm] : ARMS) {
      const transcriptRoot = join(root, 'transcripts', arm);
      for (const transcriptPath of await collectFiles(transcriptRoot, n => n.endsWith('.jsonl'))) {
        const rel = transcriptPath.slice(transcriptRoot.length + 1);
        const resultPath = join(root, 'results', arm, rel.replace(/\.jsonl$/, '.json'));
        let result: { metrics?: unknown; error?: string };
        try {
          result = JSON.parse(await readFile(resultPath, 'utf-8')) as typeof result;
        } catch {
          missing++;
          continue;
        }
        // Killed trials have no `result` event; their wall clock is the timeout that killed them.
        const timeout = /timed out after (\d+)ms/.exec(result.error ?? '');
        const transcript = await readFile(transcriptPath, 'utf-8');
        result.metrics = parseTranscript(transcript.split('\n'), arm, experiment.classifier, {
          armTools: experiment.arms[arm].tools,
          ...(timeout ? { fallbackWallClockMs: Number(timeout[1]) } : {}),
        });
        await writeFile(resultPath, JSON.stringify(result, null, 2), 'utf-8');
        updated++;
      }
    }
    log.info(`Recomputed metrics for ${updated} result file(s).`);
    if (missing > 0) log.warn(`Skipped ${missing} transcript(s) with no matching result JSON.`);
  });

// ---------------------------------------------------------------------------
// redact-artifacts
// ---------------------------------------------------------------------------
program
  .command('redact-artifacts')
  .description('Apply transcript redaction (home paths, out-of-trial file reads) to stored run artifacts')
  .option('--experiment <name>', 'limit to one experiment', experimentName)
  .action(async (opts: { experiment?: ExperimentSpec }) => {
    const rootDir = resolve(process.cwd());
    const home = homedir();
    const names = opts.experiment ? [opts.experiment.name] : [...new Set(Object.values(experiments).map(e => e.name))];
    const textFile = /\.(jsonl|json|md|log|txt|yml|yaml|html|stderr\.log)$/;
    let changed = 0;
    for (const name of names) {
      for (const path of await collectFiles(join(rootDir, 'experiments', name, 'runs'), n => textFile.test(n))) {
        const before = await readFile(path, 'utf-8');
        const after = path.endsWith('.jsonl') ? redactTranscript(before, home) : redactHomePaths(before, home);
        if (after !== before) {
          await writeFile(path, after, 'utf-8');
          changed++;
        }
      }
    }
    log.info(`Redacted ${changed} file(s).`);
  });

// ---------------------------------------------------------------------------
// verify-arms
// ---------------------------------------------------------------------------
interface InitEvent {
  type: 'system';
  subtype: 'init';
  tools: string[];
  mcp_servers?: Array<{ name: string; status: string }>;
  skills?: string[];
  claude_code_version?: string;
}

program
  .command('verify-arms')
  .description('Start each arm exactly as a trial would and print the tools Claude Code actually exposes')
  .requiredOption('--experiment <name>', 'experiment name', experimentName)
  .option('--arm <arm>', 'one arm (default: all)', armName)
  .option('--model <model>', 'Claude model ID', DEFAULT_MODEL)
  .action(async (opts: { experiment: ExperimentSpec; arm?: Arm; model: string }) => {
    const experiment = opts.experiment;
    const rootDir = resolve(process.cwd());
    for (const arm of opts.arm ? [opts.arm] : ARMS) {
      const cfg = experiment.arms[arm];
      const workDir = await mkdtemp(join(tmpdir(), `clivsmcp-verify-${arm}-`));
      const ghConfigDir = await mkdtemp(join(tmpdir(), 'clivsmcp-ghconfig-'));
      try {
        if (arm === 'skill') await copySkill(experiment.classifier.intendedSkillName, rootDir, workDir);
        const args = buildClaudeArgs(cfg, 'Reply with the single word OK.', opts.model, rootDir, 'stream-json');
        const agentEnv = experiment.buildAgentEnv ? experiment.buildAgentEnv(arm) : {};
        const env = buildChildEnv(cfg.extraEnv, agentEnv, ghConfigDir);
        const result = await execa('claude', args, {
          cwd: workDir,
          reject: false,
          stdin: 'ignore',
          env,
          extendEnv: false,
        });
        const init = result.stdout
          .split('\n')
          .filter(l => l.startsWith('{'))
          .map(l => JSON.parse(l) as { type?: string; subtype?: string })
          .find((e): e is InitEvent => e.type === 'system' && e.subtype === 'init');

        log.info(`\n${'='.repeat(60)}\nARM: ${arm} — ${cfg.description}\n${'='.repeat(60)}`);
        if (!init) {
          log.error('No init event; claude output follows.', {
            stderr: redactHomePaths(result.stderr, homedir()).slice(0, 2000),
          });
          process.exitCode = 1;
          continue;
        }
        const builtIn = init.tools.filter(t => !t.startsWith('mcp__'));
        const mcp = init.tools.filter(t => t.startsWith('mcp__'));
        log.info(`claude ${init.claude_code_version ?? '?'}`);
        log.info(`built-in tools (${builtIn.length}): ${builtIn.join(' ')}`);
        log.info(`MCP tools (${mcp.length}): ${mcp.join(' ') || '(none)'}`);
        log.info(`MCP servers: ${(init.mcp_servers ?? []).map(s => `${s.name}:${s.status}`).join(' ') || '(none)'}`);
        log.info(`skills: ${(init.skills ?? []).join(' ') || '(none)'}`);
        const unexpected = builtIn.filter(t => !cfg.tools.includes(t));
        if (unexpected.length > 0) {
          log.warn(`tools outside the arm's configured list: ${unexpected.join(' ')}`);
          process.exitCode = 1;
        }
      } finally {
        await rm(workDir, { recursive: true, force: true });
        await rm(ghConfigDir, { recursive: true, force: true });
      }
    }
  });

await program.parseAsync();
