import type { Task, TaskContext } from '../../../harness/src/tasks.js';
import {
  ghConfigFromEnv,
  provisionRepo,
  repoNameFor,
  type ProvisionedRepo,
  type RepoSeed,
} from '../provisioner.js';

function hexFromSeed(seed: string, salt: string, len: number): string {
  // FNV-1a derived hex — mirrors the helper in tier1.ts so seed-derived
  // markers stay reproducible across tiers.
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

// ---------------------------------------------------------------------------
// tier2_issue_workflow — find an issue, label it, comment, close it
// ---------------------------------------------------------------------------

interface IssueWorkflowState {
  repo: ProvisionedRepo;
  targetIssueNumber: number;
  targetMarker: string;
  expectedCommentPhrase: string;
  expectedLabel: string;
  decoyIssueNumbers: number[];
}

const tier2_issue_workflow: Task = {
  id: 'tier2_issue_workflow',
  tier: 2,

  setup: async (seed) => {
    const cfg = ghConfigFromEnv();
    const marker = hexFromSeed(seed, 'workflow-marker', 8).toUpperCase();
    const expectedCommentPhrase = `triaged-${marker}`;
    const expectedLabel = 'priority-high';

    const repoSeed: RepoSeed = {
      description: 'tier2_issue_workflow sandbox',
      files: [{ path: 'README.md', content: '# triage workflow sandbox\n' }],
      labels: [
        { name: 'bug', color: 'd73a4a' },
        { name: 'enhancement', color: 'a2eeef' },
        { name: 'priority-high', color: 'b60205' },
        { name: 'priority-low', color: '0e8a16' },
      ],
      issues: [
        {
          title: `Decoy issue ${hexFromSeed(seed, 'd1', 4)}`,
          body: 'Unrelated work.',
          labels: ['enhancement'],
        },
        {
          // Target issue — title contains the per-trial marker.
          title: `Investigate regression ${marker}`,
          body: `Customers report degraded behaviour starting today.\n\nMarker: ${marker}`,
          labels: ['bug'],
        },
        {
          title: `Decoy issue ${hexFromSeed(seed, 'd2', 4)}`,
          body: 'Another unrelated issue.',
          labels: ['priority-low'],
        },
      ],
    };

    const repo = await provisionRepo(
      cfg,
      repoNameFor('tier2_issue_workflow', seed),
      repoSeed,
    );

    // Issues are created in insertion order; numbers start at 1.
    return {
      repo,
      targetIssueNumber: 2,
      targetMarker: marker,
      expectedCommentPhrase,
      expectedLabel,
      decoyIssueNumbers: [1, 3],
    } satisfies IssueWorkflowState;
  },

  cleanup: async (state) => {
    const s = state as IssueWorkflowState | null;
    if (s) await s.repo.cleanupHandle();
  },

  prompt: (ctx: TaskContext) => {
    const s = ctx.state as IssueWorkflowState;
    return `
You have access to a private GitHub repository at:
  ${s.repo.htmlUrl}

It contains three open issues. Exactly one issue is the target: its title contains the marker string ${s.targetMarker}.

Do the following, all against the target issue only:

1. Add the label "${s.expectedLabel}" (the label already exists in the repo).
2. Post a comment whose body contains the exact phrase "${s.expectedCommentPhrase}".
3. Close the issue.

Do not modify the other two issues. When all three steps are done you are finished — you do not need to write any local artifact.
    `.trim();
  },

  successCheck: async (ctx) => {
    const cfg = ghConfigFromEnv();
    const expected = ctx.state as IssueWorkflowState;
    const repo = expected.repo.fullName;

    const target = await fetchJson(cfg.host, cfg.controllerToken,
      `/repos/${repo}/issues/${expected.targetIssueNumber}`) as {
        state: string;
        labels: Array<{ name: string }>;
      };
    const targetComments = await fetchJson(cfg.host, cfg.controllerToken,
      `/repos/${repo}/issues/${expected.targetIssueNumber}/comments`) as Array<{ body: string }>;

    const labelOk = target.labels.some(l => l.name === expected.expectedLabel);
    const stateOk = target.state === 'closed';
    const commentOk = targetComments.some(c => (c.body ?? '').includes(expected.expectedCommentPhrase));

    // Verify decoys were not touched — still open, no comments added.
    let decoysUntouched = true;
    const decoyNotes: string[] = [];
    for (const num of expected.decoyIssueNumbers) {
      const d = await fetchJson(cfg.host, cfg.controllerToken,
        `/repos/${repo}/issues/${num}`) as { state: string };
      const dc = await fetchJson(cfg.host, cfg.controllerToken,
        `/repos/${repo}/issues/${num}/comments`) as Array<{ body: string }>;
      if (d.state !== 'open' || dc.length > 0) {
        decoysUntouched = false;
        decoyNotes.push(`issue #${num}: state=${d.state}, comments=${dc.length}`);
      }
    }

    // decoysUntouched only counts as positive signal when the agent at least
    // touched the target — otherwise inaction would score 0.25 for free.
    const touchedTarget = labelOk || stateOk || commentOk;
    const decoyCheck = touchedTarget && decoysUntouched;

    const checks = [labelOk, stateOk, commentOk, decoyCheck];
    const matched = checks.filter(Boolean).length;
    const score = matched / checks.length;
    const notes = matched === checks.length
      ? 'all workflow steps applied to target only'
      : `label=${labelOk} closed=${stateOk} comment=${commentOk} decoys-untouched=${decoysUntouched}${decoyNotes.length ? ' (' + decoyNotes.join('; ') + ')' : ''}${!touchedTarget ? ' (target untouched — decoy check not credited)' : ''}`;

    return {
      pass: matched === checks.length,
      score,
      notes,
      extras: {
        repoFullName: repo,
        targetIssueNumber: expected.targetIssueNumber,
        expectedLabel: expected.expectedLabel,
        expectedCommentPhrase: expected.expectedCommentPhrase,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// tier2_file_patch_pr — replace a TODO, open a PR
// ---------------------------------------------------------------------------

interface FilePatchState {
  repo: ProvisionedRepo;
  marker: string;
  expectedFunctionName: string;
  expectedReturnValue: string;
  expectedPrTitle: string;
  expectedPrBodyPhrase: string;
  changedFile: string;
}

async function filePatchSetup(taskId: string, seed: string): Promise<FilePatchState> {
  const cfg = ghConfigFromEnv();
  const marker = hexFromSeed(seed, 'patch-marker', 8).toUpperCase();
  const changedFile = 'src/widget.ts';
  const initialContent = [
    `// Widget module.`,
    ``,
    `export function describe(): string {`,
    `  return 'widget';`,
    `}`,
    ``,
    `// TODO MARKER-${marker}: implement the marker handler.`,
    ``,
  ].join('\n');

  const repo = await provisionRepo(cfg, repoNameFor(taskId, seed), {
    description: `${taskId} sandbox`,
    files: [
      { path: 'README.md', content: '# patch sandbox\n' },
      { path: changedFile, content: initialContent },
    ],
  });

  return {
    repo,
    marker,
    expectedFunctionName: `solve_${marker}`,
    expectedReturnValue: `done-${marker}`,
    expectedPrTitle: `Fix MARKER-${marker}`,
    expectedPrBodyPhrase: `addresses-${marker}`,
    changedFile,
  };
}

async function filePatchSuccessCheck(ctx: TaskContext) {
  const cfg = ghConfigFromEnv();
  const expected = ctx.state as FilePatchState;
  const repo = expected.repo.fullName;

  const prs = await fetchJson(cfg.host, cfg.controllerToken,
    `/repos/${repo}/pulls?state=open&base=main`) as Array<{
      number: number;
      title: string;
      body: string | null;
      head: { ref: string };
    }>;

  const pr = prs.find(p => p.title.trim() === expected.expectedPrTitle.trim());
  const titleOk = !!pr;
  const bodyOk = !!pr && (pr.body ?? '').includes(expected.expectedPrBodyPhrase);

  let fileOk = false;
  let functionReturnsOk = false;
  let onlyTargetFileChanged = false;

  if (pr) {
    try {
      const fileContent = await fetchTextContents(cfg.host, cfg.controllerToken,
        `/repos/${repo}/contents/${encodeURI(expected.changedFile)}?ref=${encodeURIComponent(pr.head.ref)}`);
      if (fileContent !== null) {
        const fnRegex = new RegExp(`function\\s+${expected.expectedFunctionName}\\s*\\(`);
        const returnRegex = new RegExp(`['"\`]${expected.expectedReturnValue}['"\`]`);
        fileOk = fnRegex.test(fileContent);
        functionReturnsOk = fileOk && returnRegex.test(fileContent);
      }
    } catch {
      // fileOk stays false
    }

    try {
      const files = await fetchJson(cfg.host, cfg.controllerToken,
        `/repos/${repo}/pulls/${pr.number}/files`) as Array<{ filename: string }>;
      onlyTargetFileChanged = files.length > 0 && files.every(f => f.filename === expected.changedFile);
    } catch {
      // onlyTargetFileChanged stays false
    }
  }

  const checks = [titleOk, bodyOk, fileOk, functionReturnsOk, onlyTargetFileChanged];
  const matched = checks.filter(Boolean).length;
  const score = matched / checks.length;
  const notes = matched === checks.length
    ? 'PR + branch file content + scope all match'
    : `title=${titleOk} body=${bodyOk} fn-present=${fileOk} fn-returns-expected=${functionReturnsOk} only-target-file=${onlyTargetFileChanged}`;

  return {
    pass: matched === checks.length,
    score,
    notes,
    extras: {
      repoFullName: repo,
      prNumber: pr?.number ?? null,
      expectedFunctionName: expected.expectedFunctionName,
      expectedPrTitle: expected.expectedPrTitle,
    },
  };
}

async function filePatchCleanup(state: unknown): Promise<void> {
  const s = state as FilePatchState | null;
  if (s) await s.repo.cleanupHandle();
}

const tier2_file_patch_pr: Task = {
  id: 'tier2_file_patch_pr',
  tier: 2,
  setup: (seed) => filePatchSetup('tier2_file_patch_pr', seed),
  cleanup: filePatchCleanup,
  successCheck: filePatchSuccessCheck,
  prompt: (ctx: TaskContext) => {
    const s = ctx.state as FilePatchState;
    return `
You have access to a private GitHub repository at:
  ${s.repo.htmlUrl}

The file ${s.changedFile} on main contains a TODO comment marked MARKER-${s.marker}. Your job:

1. Create a new branch off main.
2. On that branch, replace the TODO line with an exported function named ${s.expectedFunctionName} that takes no parameters and returns the literal string "${s.expectedReturnValue}".
3. Open a pull request from your branch into main with:
   - Title: ${s.expectedPrTitle}
   - Body containing the exact phrase: ${s.expectedPrBodyPhrase}

Do not modify any file other than ${s.changedFile}. When the PR is open you are done — you do not need to write any local artifact.
    `.trim();
  },
};

// Variant: same task setup and success check, but the prompt names the
// in-surface workaround (gh api's @file / --input flags + the Write tool)
// so we can measure whether the file_patch_pr skill-arm escape pattern
// from tier2-n5 is a prompt-knowledge gap or a deeper affordance gap.
const tier2_file_patch_pr_directed: Task = {
  id: 'tier2_file_patch_pr_directed',
  tier: 2,
  setup: (seed) => filePatchSetup('tier2_file_patch_pr_directed', seed),
  cleanup: filePatchCleanup,
  successCheck: filePatchSuccessCheck,
  prompt: (ctx: TaskContext) => {
    const s = ctx.state as FilePatchState;
    return `
You have access to a private GitHub repository at:
  ${s.repo.htmlUrl}

The file ${s.changedFile} on main contains a TODO comment marked MARKER-${s.marker}. Your job:

1. Create a new branch off main.
2. On that branch, replace the TODO line with an exported function named ${s.expectedFunctionName} that takes no parameters and returns the literal string "${s.expectedReturnValue}".
3. Open a pull request from your branch into main with:
   - Title: ${s.expectedPrTitle}
   - Body containing the exact phrase: ${s.expectedPrBodyPhrase}

Tooling notes — important:
- The ONLY allowed Bash command is \`gh ...\`. Shell helpers (\`cat\`, \`base64\`, \`awk\`, \`sed\`, \`echo\`), pipes, redirections (\`>\`, \`>>\`, \`2>&1\`), shell variable assignments (\`NAME=value\`), and command substitution (\`\$(...)\`) are NOT allowed and will be flagged as off-surface.
- When you need to pass file content or a JSON body to \`gh api\`, write the content to a local file using the \`Write\` tool, then point \`gh\` at it:
    - \`gh api ENDPOINT -F field=@local-file\` reads the value for one field from a file
    - \`gh api ENDPOINT --input request.json\` reads the entire request body from a file
- That is the in-surface pattern for multi-line content. Do not use shell variable assignment to stage content.

Do not modify any file other than ${s.changedFile}. When the PR is open you are done — you do not need to write any local artifact.
    `.trim();
  },
};

// ---------------------------------------------------------------------------
// tier2_issue_create — single-primitive write: create one issue
//
// Picked as a clean apples-to-apples task because both sides have a single
// matched primitive:
//   skill: gh issue create --title "..." --body "..." --label bug --label priority-high
//   mcp:   mcp__github__issue_write (create variant, already proven in
//          tier2_issue_workflow n5)
//
// Note: tier2_release_create was attempted first but pulled — the
// github-mcp-server (any toolset) exposes only read tools for releases.
// gh release create works fine on the skill side; there's no MCP write
// primitive to compare against, so it isn't a tool-surface comparison.
// ---------------------------------------------------------------------------

interface IssueCreateState {
  repo: ProvisionedRepo;
  marker: string;
  expectedTitle: string;
  expectedBodyPhrase: string;
  expectedLabels: string[];
}

const tier2_issue_create: Task = {
  id: 'tier2_issue_create',
  tier: 2,

  setup: async (seed) => {
    const cfg = ghConfigFromEnv();
    const marker = hexFromSeed(seed, 'issue-create', 8).toUpperCase();
    const expectedLabels = ['bug', 'priority-high'];

    const repo = await provisionRepo(
      cfg,
      repoNameFor('tier2_issue_create', seed),
      {
        description: 'tier2_issue_create sandbox',
        files: [{ path: 'README.md', content: '# issue create sandbox\n' }],
        labels: [
          { name: 'bug', color: 'd73a4a' },
          { name: 'enhancement', color: 'a2eeef' },
          { name: 'priority-high', color: 'b60205' },
          { name: 'priority-low', color: '0e8a16' },
        ],
      },
    );

    return {
      repo,
      marker,
      expectedTitle: `Investigate ${marker}`,
      expectedBodyPhrase: `report-${marker}`,
      expectedLabels,
    } satisfies IssueCreateState;
  },

  cleanup: async (state) => {
    const s = state as IssueCreateState | null;
    if (s) await s.repo.cleanupHandle();
  },

  prompt: (ctx: TaskContext) => {
    const s = ctx.state as IssueCreateState;
    return `
You have access to a private GitHub repository at:
  ${s.repo.htmlUrl}

Create one new issue with:
  - Title: ${s.expectedTitle}
  - Body containing the exact phrase: ${s.expectedBodyPhrase}
  - Labels: ${s.expectedLabels.join(', ')} (both labels already exist in the repo)

When the issue has been created you are done — you do not need to write any local artifact.
    `.trim();
  },

  successCheck: async (ctx) => {
    const cfg = ghConfigFromEnv();
    const expected = ctx.state as IssueCreateState;
    const repo = expected.repo.fullName;

    // List open issues; find one whose title exactly matches the expected.
    // The /issues endpoint has noticeable eventual-consistency lag after a
    // create — a freshly-POSTed issue can be 200 OK at GET /issues/{n} while
    // returning 0 results from the list endpoint. Retry the list a few
    // times with backoff before declaring "no issue found".
    type IssueRow = {
      number: number;
      title: string;
      body: string | null;
      labels: Array<{ name: string }>;
      pull_request?: unknown;
    };
    let candidates: IssueRow[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const issues = await fetchJson(cfg.host, cfg.controllerToken,
        `/repos/${repo}/issues?state=open&per_page=20`) as IssueRow[];
      candidates = issues.filter(i => !i.pull_request
        && i.title.trim() === expected.expectedTitle.trim());
      if (candidates.length > 0) break;
      if (attempt < 5) await new Promise(r => setTimeout(r, 500));
    }

    if (candidates.length === 0) {
      return {
        pass: false,
        score: 0,
        notes: `no open issue found with title "${expected.expectedTitle}" after 6 attempts`,
        extras: { repoFullName: repo, expectedTitle: expected.expectedTitle },
      };
    }
    if (candidates.length > 1) {
      return {
        pass: false,
        score: 0,
        notes: `expected exactly one issue with the title; found ${candidates.length}`,
        extras: { repoFullName: repo, expectedTitle: expected.expectedTitle },
      };
    }

    const issue = candidates[0]!;
    const titleOk = true;
    const bodyOk = (issue.body ?? '').includes(expected.expectedBodyPhrase);
    const labelNames = issue.labels.map(l => l.name);
    const labelsOk = expected.expectedLabels.every(n => labelNames.includes(n))
      && labelNames.length === expected.expectedLabels.length;

    const checks = [titleOk, bodyOk, labelsOk];
    const matched = checks.filter(Boolean).length;
    const score = matched / checks.length;
    const notes = matched === checks.length
      ? 'issue created with all expected fields'
      : `title=${titleOk} body=${bodyOk} labels=${labelsOk} (got=${labelNames.join('|')})`;

    return {
      pass: matched === checks.length,
      score,
      notes,
      extras: {
        repoFullName: repo,
        issueNumber: issue.number,
        expectedTitle: expected.expectedTitle,
        expectedLabels: expected.expectedLabels,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// HTTP helpers — mirror the inline pattern from tier1.ts so this file stays
// self-contained and the controller token never leaves the harness process.
// ---------------------------------------------------------------------------

async function fetchJson(host: string, token: string, path: string): Promise<unknown> {
  const res = await fetch(`https://${host}${path}`, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchTextContents(host: string, token: string, path: string): Promise<string | null> {
  // GitHub's contents endpoint returns either base64 JSON or raw text depending
  // on Accept. Using the raw media type lets us skip the base64 round-trip.
  const res = await fetch(`https://${host}${path}`, {
    headers: { ...ghHeaders(token), Accept: 'application/vnd.github.raw+json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
  return res.text();
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

export const tier2Tasks: Task[] = [
  tier2_issue_workflow,
  tier2_file_patch_pr,
  tier2_file_patch_pr_directed,
  tier2_issue_create,
];
