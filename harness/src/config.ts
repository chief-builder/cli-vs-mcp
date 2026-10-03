import { z } from 'zod';

/**
 * Harness-wide defaults and environment validation. Everything a run depends
 * on that isn't per-experiment lives here so it's set (and checked) in one place.
 */

export const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Wall-clock budget per trial. execa kills the `claude` child when it expires. */
export const TRIAL_TIMEOUT_MS = 240_000;

/**
 * Tools blocked in every arm. Each is an out-of-band execution or fetch channel
 * an agent can reach for when Bash is constrained. `--tools` already leaves them
 * out; they stay on `--disallowed-tools` as a second guard.
 */
export const ALWAYS_BLOCKED_TOOLS = ['WebFetch', 'WebSearch', 'Monitor', 'CronCreate', 'RemoteTrigger'] as const;

/**
 * Planning and bookkeeping tools. They neither execute nor fetch anything, so the
 * classifier treats them as in-surface in every arm. Names cover both the older
 * (`TodoWrite`) and newer (`Task*`) Claude Code todo tools.
 */
export const PLANNING_TOOLS = [
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'EnterPlanMode',
  'ExitPlanMode',
  'AskUserQuestion',
] as const;

/** Flags shared by every arm of every experiment. */
export const COMMON_CLAUDE_FLAGS = ['--setting-sources', 'project,local', '--permission-mode', 'bypassPermissions'];

/** Run names become directory names under experiments/<exp>/runs/. */
export const RUN_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const GithubEnvSchema = z.object({
  GITHUB_AGENT_TOKEN: z.string({ error: 'is required' }).min(1, 'is required'),
  GITHUB_CONTROLLER_TOKEN: z.string({ error: 'is required' }).min(1, 'is required'),
  GITHUB_SANDBOX_OWNER: z
    .string({ error: 'is required' })
    .regex(/^[A-Za-z0-9-]{1,39}$/, 'must be a GitHub user or org name'),
  GITHUB_HOST: z
    .string()
    .regex(/^[A-Za-z0-9.-]+$/, 'must be a bare hostname')
    .optional(),
});

export interface GithubConfig {
  agentToken: string;
  controllerToken: string;
  sandboxOwner: string;
  /** API host for the provisioner, e.g. api.github.com. */
  apiHost: string;
  /** Host override forwarded to the agent (GH_HOST / GITHUB_HOST), if any. */
  agentHost: string | undefined;
}

/**
 * Reads and validates the GitHub experiment's env vars. Throws one error that
 * lists every problem. Token values never appear in the message.
 */
export function loadGithubConfig(env: NodeJS.ProcessEnv = process.env): GithubConfig {
  const parsed = GithubEnvSchema.safeParse({
    GITHUB_AGENT_TOKEN: env.GITHUB_AGENT_TOKEN,
    GITHUB_CONTROLLER_TOKEN: env.GITHUB_CONTROLLER_TOKEN,
    GITHUB_SANDBOX_OWNER: env.GITHUB_SANDBOX_OWNER,
    GITHUB_HOST: env.GITHUB_HOST || undefined,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map(i => `  - ${i.path.join('.')} ${i.message}`).join('\n');
    throw new Error(
      `GitHub experiment configuration is invalid:\n${problems}\n` +
        'Set these in .env at the repo root (loaded automatically) or export them. See README "Configuration".',
    );
  }
  const e = parsed.data;
  return {
    agentToken: e.GITHUB_AGENT_TOKEN,
    controllerToken: e.GITHUB_CONTROLLER_TOKEN,
    sandboxOwner: e.GITHUB_SANDBOX_OWNER,
    apiHost: e.GITHUB_HOST ?? 'api.github.com',
    agentHost: e.GITHUB_HOST,
  };
}
