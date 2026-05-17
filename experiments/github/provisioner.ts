import { Buffer } from 'node:buffer';

/**
 * Minimal GitHub REST client used by Tier 1 provisioners. Holds the controller
 * token and the sandbox owner so tasks can create / read / delete state
 * without ever exposing the controller token to the agent process.
 *
 * Why not use Octokit? One dependency for ~5 endpoints isn't worth it. If we
 * grow to Tier 2 mutation workflows it might be.
 */
export interface GhConfig {
  controllerToken: string;
  sandboxOwner: string;
  host: string;
}

export function ghConfigFromEnv(): GhConfig {
  const controllerToken = process.env.GITHUB_CONTROLLER_TOKEN;
  const sandboxOwner = process.env.GITHUB_SANDBOX_OWNER;
  if (!controllerToken) throw new Error('GITHUB_CONTROLLER_TOKEN not set');
  if (!sandboxOwner) throw new Error('GITHUB_SANDBOX_OWNER not set');
  return {
    controllerToken,
    sandboxOwner,
    host: process.env.GITHUB_HOST ?? 'api.github.com',
  };
}

interface GhRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  acceptNotFound?: boolean;
  /**
   * If true, treat 422 "already_exists" responses as successful no-ops.
   * Used for label creation, which races against GitHub's auto-created
   * default labels (bug, enhancement, "good first issue", etc.).
   */
  acceptConflict?: boolean;
}

async function ghRequest<T = unknown>(cfg: GhConfig, req: GhRequest): Promise<T | null> {
  const url = `https://${cfg.host}${req.path}`;
  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${cfg.controllerToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'cli-vs-mcp-harness/1.0',
    },
  };
  if (req.body !== undefined) init.body = JSON.stringify(req.body);
  const res = await fetch(url, init);
  if (res.status === 404 && req.acceptNotFound) return null;
  if (res.status === 422 && req.acceptConflict) {
    const text = await res.text();
    if (text.includes('already_exists')) return null;
    throw new Error(`GitHub API ${req.method} ${req.path} -> 422: ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${req.method} ${req.path} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  if (res.status === 204) return null;
  return await res.json() as T;
}

export interface ProvisionedRepo {
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  cleanupHandle: () => Promise<void>;
}

interface RepoSeedFile {
  path: string;
  content: string;
}

interface RepoSeedIssue {
  title: string;
  body: string;
  labels?: string[];
  closeAfter?: boolean;
}

export interface RepoSeed {
  description?: string;
  topics?: string[];
  files: RepoSeedFile[];
  labels?: Array<{ name: string; color: string }>;
  issues?: RepoSeedIssue[];
}

/**
 * Creates a private repo under the sandbox owner with the given seed content.
 * Waits for replication consistency (a GET on the repo path returns 200)
 * before returning. Caller is responsible for calling cleanupHandle() in
 * finally — typically by passing it to Task.cleanup.
 */
export async function provisionRepo(
  cfg: GhConfig,
  repoName: string,
  seed: RepoSeed,
): Promise<ProvisionedRepo> {
  const isOrg = await isOrganization(cfg, cfg.sandboxOwner);

  const createPath = isOrg
    ? `/orgs/${cfg.sandboxOwner}/repos`
    : `/user/repos`;
  await ghRequest(cfg, {
    method: 'POST',
    path: createPath,
    body: {
      name: repoName,
      private: true,
      description: seed.description ?? 'cli-vs-mcp experiment sandbox',
      auto_init: false,
    },
  });

  const fullName = `${cfg.sandboxOwner}/${repoName}`;

  await waitForRepoReady(cfg, fullName);

  if (seed.topics && seed.topics.length > 0) {
    await ghRequest(cfg, {
      method: 'PUT',
      path: `/repos/${fullName}/topics`,
      body: { names: seed.topics },
    });
  }

  for (const file of seed.files) {
    await ghRequest(cfg, {
      method: 'PUT',
      path: `/repos/${fullName}/contents/${encodeURI(file.path)}`,
      body: {
        message: `seed ${file.path}`,
        content: Buffer.from(file.content, 'utf-8').toString('base64'),
      },
    });
  }

  if (seed.labels) {
    for (const label of seed.labels) {
      await ghRequest(cfg, {
        method: 'POST',
        path: `/repos/${fullName}/labels`,
        body: { name: label.name, color: label.color },
        acceptConflict: true,
      });
    }
  }

  if (seed.issues) {
    for (const issue of seed.issues) {
      const created = await ghRequest<{ number: number }>(cfg, {
        method: 'POST',
        path: `/repos/${fullName}/issues`,
        body: {
          title: issue.title,
          body: issue.body,
          ...(issue.labels ? { labels: issue.labels } : {}),
        },
      });
      if (issue.closeAfter && created) {
        await ghRequest(cfg, {
          method: 'PATCH',
          path: `/repos/${fullName}/issues/${created.number}`,
          body: { state: 'closed' },
        });
      }
    }
  }

  return {
    owner: cfg.sandboxOwner,
    name: repoName,
    fullName,
    htmlUrl: `https://github.com/${fullName}`,
    cleanupHandle: () => deleteRepo(cfg, fullName),
  };
}

async function isOrganization(cfg: GhConfig, owner: string): Promise<boolean> {
  const data = await ghRequest<{ type?: string }>(cfg, {
    method: 'GET',
    path: `/users/${owner}`,
  });
  return data?.type === 'Organization';
}

async function waitForRepoReady(cfg: GhConfig, fullName: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const data = await ghRequest(cfg, {
      method: 'GET',
      path: `/repos/${fullName}`,
      acceptNotFound: true,
    });
    if (data) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`repo ${fullName} not visible to API within 15s`);
}

/**
 * Cleanup strategy: hard delete. Requires Administration:write on the sandbox
 * owner. If your controller PAT only has archive scope, swap this for a PATCH
 * archived=true — but expect retried runs to fail with "name already exists"
 * since paired seeds produce deterministic repo names.
 */
async function deleteRepo(cfg: GhConfig, fullName: string): Promise<void> {
  await ghRequest(cfg, {
    method: 'DELETE',
    path: `/repos/${fullName}`,
    acceptNotFound: true,
  });
}

/**
 * Per-trial repo name derived from the paired seed. Keeps sandbox cleanup
 * scriptable: every harness-created repo starts with the prefix.
 */
export function repoNameFor(taskId: string, seed: string): string {
  const short = seed.slice(0, 8);
  return `clivsmcp-${taskId.replace(/_/g, '-')}-${short}`;
}
