import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task, TaskContext } from '../../../harness/src/tasks.js';
import {
  ghConfigFromEnv,
  provisionRepo,
  repoNameFor,
  type ProvisionedRepo,
  type RepoSeed,
} from '../provisioner.js';

function hexFromSeed(seed: string, salt: string, len: number): string {
  // FNV-1a derived hex — same source style as harness/src/trialState.ts so
  // GitHub task seeds remain reproducible.
  let h = 2166136261;
  const s = seed + ':' + salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let out = '';
  while (out.length < len) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
    h = (h + 0x9e3779b9) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, len);
}

async function readJsonIfExists<T = unknown>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// tier1_repo_inventory — describe a private sandbox repo
// ---------------------------------------------------------------------------

interface RepoInventoryState {
  repo: ProvisionedRepo;
  expectedDescription: string;
  expectedTopics: string[];
  expectedDefaultBranch: string;
  hiddenMarker: string;
}

const tier1_repo_inventory: Task = {
  id: 'tier1_repo_inventory',
  tier: 1,

  setup: async (seed) => {
    const cfg = ghConfigFromEnv();
    const marker = hexFromSeed(seed, 'marker', 16);
    const expectedDescription = `cli-vs-mcp sandbox repo (${seed.slice(0, 6)})`;
    const expectedTopics = [
      `topic-${hexFromSeed(seed, 'topic-a', 4)}`,
      `topic-${hexFromSeed(seed, 'topic-b', 4)}`,
      'cli-vs-mcp',
    ];
    const repoSeed: RepoSeed = {
      description: expectedDescription,
      topics: expectedTopics,
      files: [
        {
          path: 'README.md',
          content: `# Sandbox\n\nMarker: ${marker}\n`,
        },
      ],
    };
    const repo = await provisionRepo(cfg, repoNameFor('tier1_repo_inventory', seed), repoSeed);
    return {
      repo,
      expectedDescription,
      expectedTopics,
      expectedDefaultBranch: 'main',
      hiddenMarker: marker,
    } satisfies RepoInventoryState;
  },

  cleanup: async (state) => {
    const s = state as RepoInventoryState | null;
    if (s) await s.repo.cleanupHandle();
  },

  prompt: (ctx: TaskContext) => {
    const s = ctx.state as RepoInventoryState;
    return `
Inspect the private GitHub repository at:
  ${s.repo.htmlUrl}

Report the following facts as a JSON object saved at this exact path:
  ${ctx.outputDir}/repo_inventory.json

The JSON must have these keys:
  - "description": the repo's description string
  - "topics": an array of topic strings (alphabetical order doesn't matter)
  - "default_branch": the default branch name
  - "readme_marker": the hex marker string found in README.md (look for "Marker: ...")

When the file is written, you are done.
    `.trim();
  },

  successCheck: async (ctx) => {
    const path = join(ctx.outputDir, 'repo_inventory.json');
    const data = await readJsonIfExists<{
      description?: string;
      topics?: string[];
      default_branch?: string;
      readme_marker?: string;
    }>(path);
    if (!data) return { pass: false, score: 0, notes: `missing or invalid JSON at ${path}` };
    const expected = ctx.state as RepoInventoryState;

    const descOk = (data.description ?? '').trim() === expected.expectedDescription;
    const topicsOk = Array.isArray(data.topics)
      && data.topics.length === expected.expectedTopics.length
      && expected.expectedTopics.every(t => data.topics!.includes(t));
    const branchOk = (data.default_branch ?? '').trim() === expected.expectedDefaultBranch;
    const markerOk = (data.readme_marker ?? '').trim() === expected.hiddenMarker;
    const checks = [descOk, topicsOk, branchOk, markerOk];
    const matched = checks.filter(Boolean).length;
    const score = matched / checks.length;
    return {
      pass: matched === checks.length,
      score,
      notes: matched === checks.length
        ? 'all repo facts match'
        : `mismatch: description=${descOk} topics=${topicsOk} default_branch=${branchOk} readme_marker=${markerOk}`,
      extras: {
        repoFullName: expected.repo.fullName,
        expectedDescription: expected.expectedDescription,
        expectedTopics: expected.expectedTopics,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// tier1_issue_triage — find the one issue with a per-trial marker
// ---------------------------------------------------------------------------

interface IssueTriageState {
  repo: ProvisionedRepo;
  hiddenMarker: string;
  targetIssueTitle: string;
  targetLabels: string[];
}

const tier1_issue_triage: Task = {
  id: 'tier1_issue_triage',
  tier: 1,

  setup: async (seed) => {
    const cfg = ghConfigFromEnv();
    const hiddenMarker = `MARKER-${hexFromSeed(seed, 'issue-marker', 12).toUpperCase()}`;
    const targetIssueTitle = `Target issue ${hexFromSeed(seed, 'issue-title', 6)}`;
    const targetLabels = ['bug', 'priority-high'];

    const repoSeed: RepoSeed = {
      description: 'tier1_issue_triage sandbox',
      files: [{ path: 'README.md', content: '# triage sandbox\n' }],
      labels: [
        { name: 'bug', color: 'd73a4a' },
        { name: 'enhancement', color: 'a2eeef' },
        { name: 'priority-high', color: 'b60205' },
        { name: 'priority-low', color: '0e8a16' },
        { name: 'good first issue', color: '7057ff' },
      ],
      issues: [
        {
          title: `Decoy issue ${hexFromSeed(seed, 'd1', 4)}`,
          body: 'Unrelated content.',
          labels: ['enhancement'],
        },
        {
          title: `Decoy issue ${hexFromSeed(seed, 'd2', 4)}`,
          body: 'Another decoy.',
          labels: ['priority-low'],
        },
        {
          title: targetIssueTitle,
          body: `This is the target issue. It contains a hidden marker: ${hiddenMarker}`,
          labels: targetLabels,
        },
        {
          title: `Decoy closed ${hexFromSeed(seed, 'd3', 4)}`,
          body: 'Closed for a reason.',
          labels: ['bug'],
          closeAfter: true,
        },
        {
          title: `Decoy issue ${hexFromSeed(seed, 'd4', 4)}`,
          body: 'Good first issue but no marker.',
          labels: ['good first issue'],
        },
      ],
    };
    const repo = await provisionRepo(cfg, repoNameFor('tier1_issue_triage', seed), repoSeed);
    return { repo, hiddenMarker, targetIssueTitle, targetLabels } satisfies IssueTriageState;
  },

  cleanup: async (state) => {
    const s = state as IssueTriageState | null;
    if (s) await s.repo.cleanupHandle();
  },

  prompt: (ctx: TaskContext) => {
    const s = ctx.state as IssueTriageState;
    return `
The private repository ${s.repo.fullName} (at ${s.repo.htmlUrl}) has several open and closed issues.

Find the OPEN issue whose body contains a marker matching the pattern:
  MARKER-XXXXXXXXXXXX   (a 12-character uppercase hex code after the literal prefix "MARKER-")

Save a JSON object at this exact path:
  ${ctx.outputDir}/issue_triage.json

The JSON must have these keys:
  - "issue_number": the issue number as an integer
  - "title": the issue title (exact string)
  - "labels": an array of label name strings (e.g. ["bug","priority-high"])
  - "marker": the full marker string including the "MARKER-" prefix

When the file is written, you are done.
    `.trim();
  },

  successCheck: async (ctx) => {
    const path = join(ctx.outputDir, 'issue_triage.json');
    const data = await readJsonIfExists<{
      issue_number?: number;
      title?: string;
      labels?: string[];
      marker?: string;
    }>(path);
    if (!data) return { pass: false, score: 0, notes: `missing or invalid JSON at ${path}` };
    const expected = ctx.state as IssueTriageState;

    const titleOk = (data.title ?? '').trim() === expected.targetIssueTitle;
    const markerOk = (data.marker ?? '').trim() === expected.hiddenMarker;
    const labels = Array.isArray(data.labels) ? data.labels : [];
    const labelsOk = expected.targetLabels.every(l => labels.includes(l));
    const numberOk = typeof data.issue_number === 'number' && data.issue_number > 0;

    const checks = [titleOk, markerOk, labelsOk, numberOk];
    const matched = checks.filter(Boolean).length;
    return {
      pass: matched === checks.length,
      score: matched / checks.length,
      notes: matched === checks.length
        ? 'issue found, fields match'
        : `mismatch: title=${titleOk} marker=${markerOk} labels=${labelsOk} number=${numberOk}`,
      extras: { repoFullName: expected.repo.fullName, expectedTitle: expected.targetIssueTitle },
    };
  },
};

// ---------------------------------------------------------------------------
// tier1_pr_diff_answer — answer a question about a PR's diff
// ---------------------------------------------------------------------------

interface PrDiffAnswerState {
  repo: ProvisionedRepo;
  prNumber: number;
  answerFunctionName: string;
  changedFile: string;
}

const tier1_pr_diff_answer: Task = {
  id: 'tier1_pr_diff_answer',
  tier: 1,

  setup: async (seed) => {
    const cfg = ghConfigFromEnv();
    const answerFunctionName = `fn_${hexFromSeed(seed, 'fn', 6)}`;
    const changedFile = 'src/widget.ts';

    const initialContent = [
      `// widget module`,
      `export function widget_existing(): number {`,
      `  return 42;`,
      `}`,
      '',
    ].join('\n');

    const updatedContent = [
      `// widget module`,
      `export function widget_existing(): number {`,
      `  return 42;`,
      `}`,
      '',
      `export function ${answerFunctionName}(input: string): string {`,
      `  return input.toUpperCase();`,
      `}`,
      '',
    ].join('\n');

    const repoSeed: RepoSeed = {
      description: 'tier1_pr_diff_answer sandbox',
      files: [
        { path: 'README.md', content: '# PR diff sandbox\n' },
        { path: changedFile, content: initialContent },
      ],
    };
    const repo = await provisionRepo(cfg, repoNameFor('tier1_pr_diff_answer', seed), repoSeed);

    // Create branch + updated file + PR
    const baseRef = await fetchJson(
      cfg.host,
      cfg.controllerToken,
      `/repos/${repo.fullName}/git/refs/heads/main`,
    ) as { object: { sha: string } };
    const branchName = `feature-${seed.slice(0, 8)}`;
    await postJson(cfg.host, cfg.controllerToken, `/repos/${repo.fullName}/git/refs`, {
      ref: `refs/heads/${branchName}`,
      sha: baseRef.object.sha,
    });

    // Update file on branch. A freshly-created branch ref can 404 on
    // /contents/...?ref= for a brief window even though the file exists on
    // the source ref — retry on 404 with backoff before giving up.
    let currentFile: { sha: string } | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        currentFile = await fetchJson(
          cfg.host,
          cfg.controllerToken,
          `/repos/${repo.fullName}/contents/${encodeURI(changedFile)}?ref=${branchName}`,
        ) as { sha: string };
        break;
      } catch (err) {
        if (attempt === 5 || !/-> 404:/.test(String(err))) throw err;
        await new Promise(r => setTimeout(r, 500));
      }
    }
    if (!currentFile) throw new Error('unreachable: retry loop exited without value');
    await putJson(cfg.host, cfg.controllerToken, `/repos/${repo.fullName}/contents/${encodeURI(changedFile)}`, {
      message: `add ${answerFunctionName}`,
      content: Buffer.from(updatedContent, 'utf-8').toString('base64'),
      sha: currentFile.sha,
      branch: branchName,
    });

    const pr = await postJson(cfg.host, cfg.controllerToken, `/repos/${repo.fullName}/pulls`, {
      title: `Add ${answerFunctionName}`,
      head: branchName,
      base: 'main',
      body: `This PR adds a new exported function to ${changedFile}.`,
    }) as { number: number };

    return {
      repo,
      prNumber: pr.number,
      answerFunctionName,
      changedFile,
    } satisfies PrDiffAnswerState;
  },

  cleanup: async (state) => {
    const s = state as PrDiffAnswerState | null;
    if (s) await s.repo.cleanupHandle();
  },

  prompt: (ctx: TaskContext) => {
    const s = ctx.state as PrDiffAnswerState;
    return `
The private repository ${s.repo.fullName} has one open pull request (#${s.prNumber}) at:
  ${s.repo.htmlUrl}/pull/${s.prNumber}

Inspect the PR's diff and answer this question by saving JSON at this exact path:
  ${ctx.outputDir}/pr_diff.json

The PR adds exactly one new top-level exported function. Report:
  - "pr_number": ${s.prNumber}
  - "changed_file": the path of the file the function was added to (e.g. "src/widget.ts")
  - "added_function_name": the name of the newly added exported function (just the identifier, e.g. "fn_abc123")

When the file is written, you are done.
    `.trim();
  },

  successCheck: async (ctx) => {
    const path = join(ctx.outputDir, 'pr_diff.json');
    const data = await readJsonIfExists<{
      pr_number?: number;
      changed_file?: string;
      added_function_name?: string;
    }>(path);
    if (!data) return { pass: false, score: 0, notes: `missing or invalid JSON at ${path}` };
    const expected = ctx.state as PrDiffAnswerState;

    const numberOk = data.pr_number === expected.prNumber;
    const fileOk = (data.changed_file ?? '').trim() === expected.changedFile;
    const fnOk = (data.added_function_name ?? '').trim() === expected.answerFunctionName;
    const checks = [numberOk, fileOk, fnOk];
    const matched = checks.filter(Boolean).length;
    return {
      pass: matched === checks.length,
      score: matched / checks.length,
      notes: matched === checks.length
        ? 'PR diff answers match'
        : `mismatch: pr_number=${numberOk} changed_file=${fileOk} added_function_name=${fnOk}`,
      extras: { repoFullName: expected.repo.fullName, expectedFn: expected.answerFunctionName },
    };
  },
};

async function fetchJson(host: string, token: string, path: string): Promise<unknown> {
  const res = await fetch(`https://${host}${path}`, {
    headers: ghHeaders(token),
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function postJson(host: string, token: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`https://${host}${path}`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function putJson(host: string, token: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`https://${host}${path}`, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'cli-vs-mcp-harness/1.0',
  };
}

// ---------------------------------------------------------------------------
// tier1_workflow_status — read the most recent finished workflow run
//
// Clean apples-to-apples task: both arms have a single first-class read
// primitive (gh run list --json / mcp__github__list_workflow_runs).
// Provisioning pushes a workflow file whose `name:` carries the per-trial
// marker, then polls /actions/runs until status=completed.
// ---------------------------------------------------------------------------

interface WorkflowStatusState {
  repo: ProvisionedRepo;
  marker: string;
  expectedWorkflowName: string;
  expectedConclusion: 'success';
  expectedHeadSha: string;
  runId: number;
}

const tier1_workflow_status: Task = {
  id: 'tier1_workflow_status',
  tier: 1,

  setup: async (seed) => {
    const cfg = ghConfigFromEnv();
    const marker = hexFromSeed(seed, 'workflow-name', 8).toUpperCase();
    const expectedWorkflowName = `Build ${marker}`;

    // Bare repo (no auto_init); we commit a single workflow file ourselves so
    // the resulting push gives us a deterministic head_sha to verify against.
    const repo = await provisionRepo(
      cfg,
      repoNameFor('tier1_workflow_status', seed),
      {
        description: 'tier1_workflow_status sandbox',
        files: [{ path: 'README.md', content: '# workflow status sandbox\n' }],
      },
    );

    // Push the workflow file. The push triggers the workflow on the `push` event.
    const workflowYaml = [
      `name: ${expectedWorkflowName}`,
      `on: [push]`,
      `jobs:`,
      `  build:`,
      `    runs-on: ubuntu-latest`,
      `    steps:`,
      `      - run: echo "build ${marker}"`,
      ``,
    ].join('\n');
    const putResp = await putJson(cfg.host, cfg.controllerToken,
      `/repos/${repo.fullName}/contents/${encodeURI('.github/workflows/seeded.yml')}`,
      {
        message: `add workflow ${marker}`,
        content: Buffer.from(workflowYaml, 'utf-8').toString('base64'),
      }) as { commit: { sha: string } };
    const expectedHeadSha = putResp.commit.sha;

    // Poll for the run to appear and complete. Workflow runs queue and execute
    // asynchronously; we wait up to ~90s for a completed status.
    const deadline = Date.now() + 90_000;
    let runId = -1;
    let conclusion: string | null = null;
    while (Date.now() < deadline) {
      const runs = await fetchJson(cfg.host, cfg.controllerToken,
        `/repos/${repo.fullName}/actions/runs?per_page=5`) as {
          workflow_runs: Array<{
            id: number;
            status: string;
            conclusion: string | null;
            head_sha: string;
            name?: string;
          }>;
        };
      const match = runs.workflow_runs.find(r => r.head_sha === expectedHeadSha);
      if (match) {
        runId = match.id;
        if (match.status === 'completed') {
          conclusion = match.conclusion;
          break;
        }
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    if (conclusion !== 'success') {
      throw new Error(
        `workflow run did not complete with success within 90s `
        + `(runId=${runId}, conclusion=${conclusion ?? 'still-pending'})`,
      );
    }

    return {
      repo,
      marker,
      expectedWorkflowName,
      expectedConclusion: 'success',
      expectedHeadSha,
      runId,
    } satisfies WorkflowStatusState;
  },

  cleanup: async (state) => {
    const s = state as WorkflowStatusState | null;
    if (s) await s.repo.cleanupHandle();
  },

  prompt: (ctx: TaskContext) => {
    const s = ctx.state as WorkflowStatusState;
    return `
Inspect the workflow runs on this private GitHub repository:
  ${s.repo.htmlUrl}

There is exactly one completed workflow run. Report the following as JSON saved at this exact path:
  ${ctx.outputDir}/run_status.json

The JSON must have these keys:
  - "workflow_name": the workflow's "name" field (the human-readable workflow name, not the file path)
  - "conclusion":    the run's conclusion (e.g., "success" / "failure")
  - "head_sha":      the run's head commit SHA (full 40-character hex)

When the file is written, you are done.
    `.trim();
  },

  successCheck: async (ctx) => {
    const path = join(ctx.outputDir, 'run_status.json');
    const data = await readJsonIfExists<{
      workflow_name?: string;
      conclusion?: string;
      head_sha?: string;
    }>(path);
    if (!data) return { pass: false, score: 0, notes: `missing or invalid JSON at ${path}` };
    const expected = ctx.state as WorkflowStatusState;

    const nameOk = (data.workflow_name ?? '').trim() === expected.expectedWorkflowName;
    const conclusionOk = (data.conclusion ?? '').trim() === expected.expectedConclusion;
    const headOk = (data.head_sha ?? '').trim() === expected.expectedHeadSha;
    const checks = [nameOk, conclusionOk, headOk];
    const matched = checks.filter(Boolean).length;
    const score = matched / checks.length;
    return {
      pass: matched === checks.length,
      score,
      notes: matched === checks.length
        ? 'workflow run fields all match'
        : `mismatch: name=${nameOk} conclusion=${conclusionOk} head_sha=${headOk}`,
      extras: {
        repoFullName: expected.repo.fullName,
        runId: expected.runId,
        expectedWorkflowName: expected.expectedWorkflowName,
      },
    };
  },
};

export const tier1Tasks: Task[] = [
  tier1_repo_inventory,
  tier1_issue_triage,
  tier1_pr_diff_answer,
  tier1_workflow_status,
];
