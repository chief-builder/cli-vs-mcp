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

    const checks = [labelOk, stateOk, commentOk, decoysUntouched];
    const matched = checks.filter(Boolean).length;
    const score = matched / checks.length;
    const notes = matched === checks.length
      ? 'all workflow steps applied to target only'
      : `label=${labelOk} closed=${stateOk} comment=${commentOk} decoys-untouched=${decoysUntouched}${decoyNotes.length ? ' (' + decoyNotes.join('; ') + ')' : ''}`;

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

const tier2_file_patch_pr: Task = {
  id: 'tier2_file_patch_pr',
  tier: 2,

  setup: async (seed) => {
    const cfg = ghConfigFromEnv();
    const marker = hexFromSeed(seed, 'patch-marker', 8).toUpperCase();
    const changedFile = 'src/widget.ts';
    const expectedFunctionName = `solve_${marker}`;
    const expectedReturnValue = `done-${marker}`;
    const expectedPrTitle = `Fix MARKER-${marker}`;
    const expectedPrBodyPhrase = `addresses-${marker}`;

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

    const repoSeed: RepoSeed = {
      description: 'tier2_file_patch_pr sandbox',
      files: [
        { path: 'README.md', content: '# patch sandbox\n' },
        { path: changedFile, content: initialContent },
      ],
    };

    const repo = await provisionRepo(
      cfg,
      repoNameFor('tier2_file_patch_pr', seed),
      repoSeed,
    );

    return {
      repo,
      marker,
      expectedFunctionName,
      expectedReturnValue,
      expectedPrTitle,
      expectedPrBodyPhrase,
      changedFile,
    } satisfies FilePatchState;
  },

  cleanup: async (state) => {
    const s = state as FilePatchState | null;
    if (s) await s.repo.cleanupHandle();
  },

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

  successCheck: async (ctx) => {
    const cfg = ghConfigFromEnv();
    const expected = ctx.state as FilePatchState;
    const repo = expected.repo.fullName;

    // Find any open PR into main with the expected title.
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
      // Check the file on the head branch contains the new function.
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

      // Confirm the PR doesn't touch other files.
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
];
