import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TrialResult } from './runner.js';
import type { Arm } from './experiment.js';

const ARMS: Arm[] = ['baseline', 'skill', 'mcp'];

async function loadResults(
  rootDir: string,
  experiment: string,
  runName: string,
  arm: Arm,
  tier?: number,
): Promise<TrialResult[]> {
  const base = join(rootDir, 'experiments', experiment, 'runs', runName, 'results', arm);
  let taskDirs: string[];
  try {
    taskDirs = await readdir(base);
  } catch {
    return [];
  }

  const results: TrialResult[] = [];
  for (const taskDir of taskDirs) {
    let files: string[];
    try {
      files = await readdir(join(base, taskDir));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(base, taskDir, file), 'utf-8');
        const r = JSON.parse(raw) as TrialResult;
        if (tier !== undefined && r.tier !== tier) continue;
        results.push(r);
      } catch {
        // skip malformed
      }
    }
  }
  return results;
}

interface TaskSummary {
  taskId: string;
  tier: number;
  arm: Arm;
  trials: number;
  successRate: number;
  validToolSurfaceRate: number;
  singleCliCommandRate: number;
  effectiveValidSurfaceRate: number;
  avgScore: number;
  avgInputTokens: number;
  avgCachedTokens: number;
  avgCacheCreationTokens: number;
  avgOutputTokens: number;
  avgTotalTokens: number;
  avgToolCalls: number;
  avgTurns: number;
  avgWallClockMs: number;
  avgCostUsd: number;
}

function avg(items: TrialResult[], fn: (r: TrialResult) => number): number {
  if (items.length === 0) return 0;
  return items.reduce((sum, r) => sum + fn(r), 0) / items.length;
}

function isValidForMode(r: TrialResult, requireSingleCliCommand: boolean): boolean {
  const validSurface = r.metrics.validToolSurface ?? true;
  const validGranularity = r.metrics.singleCliCommandPerToolCall ?? true;
  return validSurface && (!requireSingleCliCommand || validGranularity);
}

function totalTokens(r: TrialResult): number {
  return (
    r.metrics.inputTokens
    + r.metrics.cachedInputTokens
    + (r.metrics.cacheCreationInputTokens ?? 0)
    + r.metrics.outputTokens
  );
}

function summarize(
  results: TrialResult[],
  requireSingleCliCommand: boolean,
  filter?: (r: TrialResult) => boolean,
): TaskSummary[] {
  const groups = new Map<string, TrialResult[]>();
  for (const r of results) {
    const key = `${r.taskId}::${r.arm}`;
    const g = groups.get(key) ?? [];
    g.push(r);
    groups.set(key, g);
  }

  return [...groups.values()].flatMap(group => {
    const filtered = filter ? group.filter(filter) : group;
    if (filtered.length === 0) return [];
    const first = filtered[0]!;
    return [{
      taskId: first.taskId,
      tier: first.tier,
      arm: first.arm,
      trials: filtered.length,
      successRate: avg(filtered, r => (r.success.pass ? 1 : 0)),
      validToolSurfaceRate: avg(filtered, r => (r.metrics.validToolSurface ?? true ? 1 : 0)),
      singleCliCommandRate: avg(filtered, r => (r.metrics.singleCliCommandPerToolCall ?? true ? 1 : 0)),
      effectiveValidSurfaceRate: avg(filtered, r => (isValidForMode(r, requireSingleCliCommand) ? 1 : 0)),
      avgScore: avg(filtered, r => r.success.score),
      avgInputTokens: avg(filtered, r => r.metrics.inputTokens),
      avgCachedTokens: avg(filtered, r => r.metrics.cachedInputTokens),
      avgCacheCreationTokens: avg(filtered, r => r.metrics.cacheCreationInputTokens ?? 0),
      avgOutputTokens: avg(filtered, r => r.metrics.outputTokens),
      avgTotalTokens: avg(filtered, totalTokens),
      avgToolCalls: avg(filtered, r => r.metrics.toolCallCount),
      avgTurns: avg(filtered, r => r.metrics.turns),
      avgWallClockMs: avg(filtered, r => r.metrics.wallClockMs),
      avgCostUsd: avg(filtered, r => r.metrics.totalCostUsd),
    }];
  }).sort((a, b) => a.tier - b.tier || a.taskId.localeCompare(b.taskId) || ARMS.indexOf(a.arm) - ARMS.indexOf(b.arm));
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const n1 = (v: number) => v.toFixed(1);
const sec = (v: number) => `${(v / 1000).toFixed(1)}s`;
const usd = (v: number) => `$${v.toFixed(4)}`;

function perTaskTable(summaries: TaskSummary[], requireSingleCliCommand: boolean): string {
  const taskIds = [...new Set(summaries.map(s => s.taskId))];
  const validLabel = requireSingleCliCommand ? 'Valid Surface (single)' : 'Valid Surface';
  const rows = [
    `| Task | Tier | Arm | Trials | Success | ${validLabel} | Single CLI Cmd | Score | Input Tok | Cached Tok | Cache Create Tok | Output Tok | Total Tok | Tool Calls | Turns | Time |`,
    '|------|------|-----|--------|---------|---------------|----------------|-------|-----------|------------|------------------|------------|-----------|------------|-------|------|',
  ];
  for (const taskId of taskIds) {
    for (const arm of ARMS) {
      const s = summaries.find(x => x.taskId === taskId && x.arm === arm);
      if (!s) continue;
      rows.push(
        `| ${s.taskId} | ${s.tier} | ${s.arm} | ${s.trials} | ${pct(s.successRate)} | ${pct(s.effectiveValidSurfaceRate)} | ${pct(s.singleCliCommandRate)} | ${n1(s.avgScore)} | ${Math.round(s.avgInputTokens)} | ${Math.round(s.avgCachedTokens)} | ${Math.round(s.avgCacheCreationTokens)} | ${Math.round(s.avgOutputTokens)} | ${Math.round(s.avgTotalTokens)} | ${n1(s.avgToolCalls)} | ${n1(s.avgTurns)} | ${sec(s.avgWallClockMs)} |`,
      );
    }
  }
  return rows.join('\n');
}

function tierSummary(summaries: TaskSummary[], requireSingleCliCommand: boolean): string {
  const tiers = [...new Set(summaries.map(s => s.tier))].sort();
  const validLabel = requireSingleCliCommand ? 'Avg Valid Surface (single)' : 'Avg Valid Surface';
  const lines: string[] = [
    '## Per-Tier Summary',
    '',
    '_Token columns are averaged over valid-surface trials only (apples-to-apples). Trial counts reflect valid trials; the per-task table above shows the unfiltered view._',
    '',
  ];
  for (const tier of tiers) {
    const tierData = summaries.filter(s => s.tier === tier);
    lines.push(`### Tier ${tier}`, '');
    lines.push(`| Arm | Tasks | Trials (valid) | Avg Success | ${validLabel} | Avg Single CLI Cmd | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Turns |`);
    lines.push('|-----|-------|----------------|-------------|-------------------|--------------------|---------------|----------------|----------------------|----------------|---------------|-----------|');
    for (const arm of ARMS) {
      const armData = tierData.filter(s => s.arm === arm);
      if (armData.length === 0) continue;
      const a = (fn: (s: TaskSummary) => number) => armData.reduce((sum, s) => sum + fn(s), 0) / armData.length;
      const totalTrials = armData.reduce((sum, s) => sum + s.trials, 0);
      lines.push(`| ${arm} | ${armData.length} | ${totalTrials} | ${pct(a(s => s.successRate))} | ${pct(a(s => s.effectiveValidSurfaceRate))} | ${pct(a(s => s.singleCliCommandRate))} | ${Math.round(a(s => s.avgInputTokens))} | ${Math.round(a(s => s.avgCachedTokens))} | ${Math.round(a(s => s.avgCacheCreationTokens))} | ${Math.round(a(s => s.avgOutputTokens))} | ${Math.round(a(s => s.avgTotalTokens))} | ${n1(a(s => s.avgTurns))} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function crossoverAnalysis(summaries: TaskSummary[]): string {
  const tiers = [...new Set(summaries.map(s => s.tier))].sort();
  const lines = [
    '## Crossover Analysis',
    '',
    'Per-tier comparison restricted to **valid-surface trials only**. Turns is a proxy for task complexity; Total Tok is the load-bearing cost measurement.',
    '',
    '| Tier | Turns (Skill) | Turns (MCP) | Total Tok (Skill) | Total Tok (MCP) | Tok Skill/MCP | Success (Skill) | Success (MCP) | MCP ≥ Skill (success)? |',
    '|------|---------------|-------------|-------------------|-----------------|---------------|-----------------|---------------|------------------------|',
  ];

  for (const tier of tiers) {
    const skill = summaries.filter(s => s.tier === tier && s.arm === 'skill');
    const mcp = summaries.filter(s => s.tier === tier && s.arm === 'mcp');
    if (skill.length === 0 || mcp.length === 0) continue;

    const aSkill = (fn: (s: TaskSummary) => number) => skill.reduce((sum, s) => sum + fn(s), 0) / skill.length;
    const aMcp = (fn: (s: TaskSummary) => number) => mcp.reduce((sum, s) => sum + fn(s), 0) / mcp.length;
    const skillTok = aSkill(s => s.avgTotalTokens);
    const mcpTok = aMcp(s => s.avgTotalTokens);
    const ratio = mcpTok > 0 ? skillTok / mcpTok : 0;
    const mcpAhead = aMcp(s => s.successRate) >= aSkill(s => s.successRate) ? 'Yes' : 'No';

    lines.push(`| ${tier} | ${n1(aSkill(s => s.avgTurns))} | ${n1(aMcp(s => s.avgTurns))} | ${Math.round(skillTok)} | ${Math.round(mcpTok)} | ${ratio.toFixed(2)}× | ${pct(aSkill(s => s.successRate))} | ${pct(aMcp(s => s.successRate))} | ${mcpAhead} |`);
  }

  return lines.join('\n');
}

function costAppendix(summaries: TaskSummary[]): string {
  const taskIds = [...new Set(summaries.map(s => s.taskId))];
  const tiers = [...new Set(summaries.map(s => s.tier))].sort();
  const lines: string[] = [
    '## Appendix: Cost (USD)',
    '',
    '_Cost is derived from token counts using model-specific pricing at run time and will drift as Anthropic updates prices. Token counts above are the load-bearing measurement._',
    '',
    '### Per-task average cost',
    '',
    '| Task | Tier | Arm | Avg Cost |',
    '|------|------|-----|----------|',
  ];
  for (const taskId of taskIds) {
    for (const arm of ARMS) {
      const s = summaries.find(x => x.taskId === taskId && x.arm === arm);
      if (!s) continue;
      lines.push(`| ${s.taskId} | ${s.tier} | ${s.arm} | ${usd(s.avgCostUsd)} |`);
    }
  }
  lines.push('', '### Per-tier average cost', '');
  for (const tier of tiers) {
    const tierData = summaries.filter(s => s.tier === tier);
    lines.push(`#### Tier ${tier}`, '');
    lines.push('| Arm | Tasks | Avg Cost |');
    lines.push('|-----|-------|----------|');
    for (const arm of ARMS) {
      const armData = tierData.filter(s => s.arm === arm);
      if (armData.length === 0) continue;
      const a = armData.reduce((sum, s) => sum + s.avgCostUsd, 0) / armData.length;
      lines.push(`| ${arm} | ${armData.length} | ${usd(a)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export interface ReportOptions {
  rootDir: string;
  experiment: string;
  runName: string;
  tier?: number | undefined;
  allTiers?: boolean | undefined;
  crossover?: boolean | undefined;
  requireSingleCliCommand?: boolean | undefined;
  includeCost?: boolean | undefined;
}

export async function generateReport(opts: ReportOptions): Promise<string> {
  const { rootDir, experiment, runName, tier, allTiers, crossover, requireSingleCliCommand = false, includeCost = false } = opts;
  const filterTier = allTiers ? undefined : tier;

  const all: TrialResult[] = [];
  for (const arm of ARMS) {
    all.push(...await loadResults(rootDir, experiment, runName, arm, filterTier));
  }

  if (all.length === 0) {
    return `# Report: ${experiment} / ${runName}\n\nNo results found.\n`;
  }

  const summariesAll = summarize(all, requireSingleCliCommand);
  const summariesValid = summarize(all, requireSingleCliCommand, r =>
    isValidForMode(r, requireSingleCliCommand),
  );
  const label = allTiers ? 'All Tiers' : tier !== undefined ? `Tier ${tier}` : 'All';
  const title = `${experiment} / ${runName}`;
  const validityMode = requireSingleCliCommand
    ? 'Validity mode: research-single — chained intended-CLI Bash calls count as invalid surface.'
    : 'Validity mode: practical — chained Bash calls are valid when every segment is the intended CLI.';

  const parts = [
    `# Experiment Report: ${title} — ${label}`,
    `_Generated: ${new Date().toISOString()}_`,
    `_${validityMode}_`,
    '',
    '## Per-Task Results',
    '',
    '_Per-task averages include all trials (invalid trials too) so the Valid Surface column tells you when escapes occurred. The tier summary and crossover below restrict to valid trials only._',
    '',
    perTaskTable(summariesAll, requireSingleCliCommand),
    '',
    tierSummary(summariesValid, requireSingleCliCommand),
  ];

  if (crossover) {
    parts.push('', crossoverAnalysis(summariesValid));
  }

  if (includeCost) {
    parts.push('', costAppendix(summariesAll));
  }

  return parts.join('\n');
}
