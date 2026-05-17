import { Command } from 'commander';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { execa } from 'execa';
import { ArmSchema } from './experiment.js';
import type { Arm } from './experiment.js';
import { runTrial, buildClaudeArgs } from './runner.js';
import type { Task } from './tasks.js';
import { generateReport } from './report.js';
import { parseTranscript } from './metrics.js';
import { getExperiment, experiments } from './experiments/index.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const program = new Command();

program
  .name('harness')
  .description('CLI vs MCP experiment harness — Playwright and GitHub')
  .version(pkg.version);

async function loadTasks(rootDir: string, tasksPath: string): Promise<Task[]> {
  const indexPath = join(rootDir, tasksPath);
  const mod = await import(indexPath) as { tasks: Task[] };
  return mod.tasks;
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
program
  .command('run')
  .description('Run experiment trials')
  .requiredOption('--experiment <name>', `Experiment: ${Object.keys(experiments).join(' | ')}`)
  .requiredOption('--run <name>', 'Named run namespace (results stored under experiments/<exp>/runs/<run>)')
  .requiredOption('--arm <arm>', 'Arm: baseline | skill | mcp')
  .option('--task <id>', 'Run a specific task by ID')
  .option('--tier <n>', 'Run all tasks in this tier', v => parseInt(v, 10))
  .requiredOption('--trials <n>', 'Number of trials per task', v => parseInt(v, 10))
  .option('--model <model>', 'Claude model ID', 'claude-sonnet-4-6')
  .option('--single-cli-command', 'Research mode: require one intended-CLI command per Bash tool call', false)
  .action(async (opts: {
    experiment: string;
    run: string;
    arm: string;
    task?: string;
    tier?: number;
    trials: number;
    model: string;
    singleCliCommand: boolean;
  }) => {
    const armParse = ArmSchema.safeParse(opts.arm);
    if (!armParse.success) {
      console.error(`Invalid arm "${opts.arm}". Must be one of: baseline, skill, mcp`);
      process.exit(1);
    }
    const arm = armParse.data;
    const rootDir = resolve(process.cwd());

    let experiment;
    try {
      experiment = getExperiment(opts.experiment);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    if (experiment.preflight) {
      try {
        await experiment.preflight();
      } catch (err) {
        console.error('Preflight failed:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }

    let tasks: Task[];
    try {
      tasks = await loadTasks(rootDir, experiment.tasksPath);
    } catch (err) {
      console.error(`Cannot load tasks for "${experiment.name}":`, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    let filtered = tasks;
    if (opts.task) {
      filtered = tasks.filter(t => t.id === opts.task);
      if (filtered.length === 0) {
        console.error(`Task "${opts.task}" not found.`);
        process.exit(1);
      }
    } else if (opts.tier !== undefined) {
      const tier = opts.tier;
      filtered = tasks.filter(t => t.tier === tier);
    }

    for (const task of filtered) {
      for (let n = 1; n <= opts.trials; n++) {
        console.log(`→ ${experiment.name}/${opts.run}  ${task.id}  arm=${arm}  trial=${n}/${opts.trials}`);
        try {
          const result = await runTrial({
            experiment,
            runName: opts.run,
            arm,
            task,
            trialN: n,
            rootDir,
            model: opts.model,
            requireSingleCliCommand: opts.singleCliCommand,
          });
          const icon = result.success.pass ? '✓' : '✗';
          const validSurface = result.metrics.validToolSurface
            && (!opts.singleCliCommand || result.metrics.singleCliCommandPerToolCall);
          const valid = validSurface ? 'valid' : 'INVALID';
          console.log(`  ${icon} score=${result.success.score.toFixed(2)}  ${valid}  tokens_in=${result.metrics.inputTokens}  turns=${result.metrics.turns}  time=${(result.metrics.wallClockMs / 1000).toFixed(1)}s`);
          if (result.error) console.error(`  error: ${result.error}`);
        } catch (err) {
          console.error(`  trial ${n} threw:`, err);
        }
      }
    }
  });

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
program
  .command('report')
  .description('Generate a markdown report from stored results')
  .requiredOption('--experiment <name>', 'Experiment name')
  .requiredOption('--run <name>', 'Named run namespace')
  .option('--tier <n>', 'Report on a specific tier', v => parseInt(v, 10))
  .option('--all-tiers', 'Include all tiers', false)
  .option('--crossover-analysis', 'Include crossover analysis section', false)
  .option('--single-cli-command', 'Research mode: chained CLI Bash calls count as invalid surface', false)
  .option('--include-cost', 'Append a USD cost appendix', false)
  .option('--output <path>', 'Write report to file instead of stdout')
  .action(async (opts: {
    experiment: string;
    run: string;
    tier?: number;
    allTiers: boolean;
    crossoverAnalysis: boolean;
    singleCliCommand: boolean;
    includeCost: boolean;
    output?: string;
  }) => {
    const rootDir = resolve(process.cwd());
    // Experiments may register multiple specs sharing one storage name
    // (e.g. github + github-rw both write under experiments/github/runs/).
    // Resolve the spec so the report reads the right directory.
    const reportExperiment = getExperiment(opts.experiment).name;
    const report = await generateReport({
      rootDir,
      experiment: reportExperiment,
      runName: opts.run,
      ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
      allTiers: opts.allTiers,
      crossover: opts.crossoverAnalysis,
      requireSingleCliCommand: opts.singleCliCommand,
      includeCost: opts.includeCost,
    });

    if (opts.output) {
      await writeFile(opts.output, report, 'utf-8');
      console.log(`Report written to ${opts.output}`);
    } else {
      process.stdout.write(report + '\n');
    }
  });

// ---------------------------------------------------------------------------
// recompute-metrics
// ---------------------------------------------------------------------------
async function collectFiles(dir: string, suffix: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collectFiles(path, suffix));
    else if (entry.name.endsWith(suffix)) out.push(path);
  }
  return out;
}

program
  .command('recompute-metrics')
  .description('Re-parse transcripts and update stored result metrics in place')
  .requiredOption('--experiment <name>', 'Experiment name')
  .requiredOption('--run <name>', 'Named run namespace')
  .option('--arm <arm>', 'Arm; defaults to all arms')
  .action(async (opts: { experiment: string; run: string; arm?: string }) => {
    const rootDir = resolve(process.cwd());
    const experiment = getExperiment(opts.experiment);
    const arms: Arm[] = [];
    if (opts.arm) {
      const armParse = ArmSchema.safeParse(opts.arm);
      if (!armParse.success) {
        console.error(`Invalid arm "${opts.arm}".`);
        process.exit(1);
      }
      arms.push(armParse.data);
    } else {
      arms.push('baseline', 'skill', 'mcp');
    }

    const artifactRoot = join(rootDir, 'experiments', experiment.name, 'runs', opts.run);

    let updated = 0;
    let missing = 0;
    for (const arm of arms) {
      const transcriptRoot = join(artifactRoot, 'transcripts', arm);
      const files = await collectFiles(transcriptRoot, '.jsonl');
      for (const transcriptPath of files) {
        const rel = transcriptPath.slice(transcriptRoot.length + 1);
        const resultPath = join(artifactRoot, 'results', arm, rel.replace(/\.jsonl$/, '.json'));
        let resultRaw: string;
        try {
          resultRaw = await readFile(resultPath, 'utf-8');
        } catch {
          missing++;
          continue;
        }
        const transcriptRaw = await readFile(transcriptPath, 'utf-8');
        const result = JSON.parse(resultRaw) as { metrics?: unknown };
        result.metrics = parseTranscript(transcriptRaw.split('\n'), arm, experiment.classifier);
        await writeFile(resultPath, JSON.stringify(result, null, 2), 'utf-8');
        updated++;
      }
    }

    console.log(`Recomputed metrics for ${updated} result file(s).`);
    if (missing > 0) console.log(`Skipped ${missing} transcript(s) with no matching result JSON.`);
  });

// ---------------------------------------------------------------------------
// verify-arms
// ---------------------------------------------------------------------------
program
  .command('verify-arms')
  .description('Probe each arm and ask it what tools it sees — confirm isolation before running trials')
  .requiredOption('--experiment <name>', 'Experiment name')
  .option('--model <model>', 'Claude model ID', 'claude-sonnet-4-6')
  .action(async (opts: { experiment: string; model: string }) => {
    const rootDir = resolve(process.cwd());
    const experiment = getExperiment(opts.experiment);
    const arms: Arm[] = ['baseline', 'skill', 'mcp'];
    const probe = experiment.name === 'github'
      ? 'What GitHub tools do you have access to right now? List them specifically. If you have none, say so.'
      : 'What Playwright tools do you have access to right now? List them specifically. If you have none, say so.';

    for (const arm of arms) {
      const cfg = experiment.arms[arm];
      console.log(`\n${'='.repeat(60)}`);
      console.log(`ARM: ${arm}`);
      console.log(`Description: ${cfg.description}`);
      console.log('='.repeat(60));

      const args = buildClaudeArgs(cfg, probe, opts.model, rootDir, 'text');

      try {
        const result = await execa('claude', args, { cwd: rootDir, reject: false });
        console.log(result.stdout || result.stderr || '(no output)');
      } catch (err) {
        console.error('Error running claude:', err);
      }
    }
  });

program.parse();
