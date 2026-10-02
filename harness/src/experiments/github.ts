import type { ExperimentSpec, ExperimentClassifier, ArmConfig, Arm } from '../experiment.js';
import { loadGithubConfig } from '../config.js';
import {
  splitTopLevelShellSegments,
  stripSimpleRedirections,
  hasShellAccountingSyntax,
  standaloneWordPattern,
  SHELL_HELPERS,
} from '../shell.js';

// Standalone helper words only, so `gh`'s own `--jq` flag and paths that
// contain helper names don't match. `git` is a helper here: the skill arm must
// reach GitHub through `gh`.
const INVALID_HELPERS_RE = standaloneWordPattern([...SHELL_HELPERS, 'git']);

/**
 * Tier 1 read-only mode flags obvious `gh` mutators. Maintained alongside the
 * pinned `gh` major version — re-check when `gh` releases new write commands.
 */
const READ_ONLY_MUTATOR_SUBCOMMANDS: RegExp[] = [
  /^gh\s+issue\s+(edit|comment|close|reopen|delete|transfer|lock|unlock|pin|unpin)\b/,
  /^gh\s+pr\s+(create|edit|comment|review|close|reopen|merge|ready|lock|unlock)\b/,
  /^gh\s+repo\s+(create|delete|edit|archive|unarchive|rename|fork)\b/,
  /^gh\s+release\s+(create|edit|delete|upload|delete-asset)\b/,
  /^gh\s+label\s+(create|edit|delete|clone)\b/,
  /^gh\s+workflow\s+(enable|disable|run)\b/,
  /^gh\s+run\s+(rerun|cancel|delete)\b/,
  /^gh\s+secret\s+(set|delete)\b/,
  /^gh\s+variable\s+(set|delete)\b/,
  /^gh\s+ruleset\s+(create|edit|delete)\b/,
];

function isGhApiWrite(segment: string): boolean {
  if (!/^gh\s+api\b/.test(segment)) return false;
  // Explicit write method
  if (/\s(?:--method|--method=|-X|-X=)\s*(POST|PUT|PATCH|DELETE)\b/i.test(segment)) return true;
  if (/\s(?:--method)=(POST|PUT|PATCH|DELETE)\b/i.test(segment)) return true;
  if (/\s-X=(POST|PUT|PATCH|DELETE)\b/i.test(segment)) return true;
  // Implicit write via parameter flag, with no explicit GET/HEAD pairing
  const hasParamFlag = /\s(?:-f|--raw-field|-F|--field|--input)\b/.test(segment);
  if (!hasParamFlag) return false;
  const explicitRead =
    /\s(?:--method|--method=|-X|-X=)\s*(GET|HEAD)\b/i.test(segment) ||
    /\s(?:--method)=(GET|HEAD)\b/i.test(segment) ||
    /\s-X=(GET|HEAD)\b/i.test(segment);
  return !explicitRead;
}

function isGhSegment(segment: string, readOnly: boolean): { ok: boolean; rawApi: boolean; reason?: string } {
  const normalized = stripSimpleRedirections(segment);
  if (!/^gh(\s|$)/.test(normalized)) {
    return { ok: false, rawApi: false, reason: `non-gh Bash segment: ${normalized.slice(0, 120)}` };
  }
  if (/`|\$\(/.test(normalized)) {
    return { ok: false, rawApi: false, reason: `command substitution in segment: ${normalized.slice(0, 120)}` };
  }
  const rest = normalized.replace(/^gh(\s|$)/, ' ');
  if (INVALID_HELPERS_RE.test(rest)) {
    return { ok: false, rawApi: false, reason: `invalid helper inside gh segment: ${normalized.slice(0, 120)}` };
  }
  const rawApi = /^gh\s+api\b/.test(normalized);
  if (readOnly) {
    for (const re of READ_ONLY_MUTATOR_SUBCOMMANDS) {
      if (re.test(normalized)) {
        return { ok: false, rawApi, reason: `read-only mode: write mutator in segment: ${normalized.slice(0, 120)}` };
      }
    }
    if (isGhApiWrite(normalized)) {
      return {
        ok: false,
        rawApi: true,
        reason: `read-only mode: gh api write (explicit or implicit POST) in segment: ${normalized.slice(0, 120)}`,
      };
    }
  }
  return { ok: true, rawApi };
}

interface GitHubClassifierOptions {
  readOnly: boolean;
}

export function buildGitHubClassifier(opts: GitHubClassifierOptions): ExperimentClassifier {
  return {
    intendedMcpPrefix: 'mcp__github__',
    intendedSkillName: 'github-cli',
    intendedShellCommand: 'gh',

    classifyShellCommand(command: string) {
      const segments = splitTopLevelShellSegments(command);
      if (segments.length === 0) {
        return { surfaceReason: 'empty Bash command', granularityReason: 'empty Bash command' };
      }
      for (const seg of segments) {
        const r = isGhSegment(seg, opts.readOnly);
        if (!r.ok) {
          return {
            surfaceReason: r.reason ?? 'invalid gh segment',
            granularityReason: r.reason ?? 'invalid gh segment',
          };
        }
      }
      const granularityReason = hasShellAccountingSyntax(command)
        ? `multiple shell operations in one Bash call: ${command.slice(0, 120)}`
        : null;
      return { surfaceReason: null, granularityReason };
    },
  };
}

function buildArms(readOnly: boolean): Record<Arm, ArmConfig> {
  return {
    baseline: {
      id: 'baseline',
      description: 'No GitHub execution surface — pure reasoning floor against off-host state',
      mcpConfig: '{"mcpServers":{}}',
      tools: ['Read', 'Glob', 'Grep', 'Write', 'ToolSearch', 'TodoWrite'],
    },
    skill: {
      id: 'skill',
      description: 'GitHub CLI skill — gh commands (sandboxed Bash) plus Write for artifacts',
      mcpConfig: '{"mcpServers":{}}',
      tools: ['Skill', 'Bash', 'Write', 'ToolSearch', 'TodoWrite'],
      // Sandboxed so the shell can't reach the developer's own gh keyring login
      // or read files under $HOME (see SECURITY.md).
      sandboxNetwork: ['api.github.com', 'github.com'],
    },
    mcp: {
      id: 'mcp',
      description: readOnly
        ? 'GitHub MCP (read-only) — mcp__github__* tools from a --read-only server'
        : 'GitHub MCP (read-write) — mcp__github__* read and write tools',
      mcpConfig: readOnly ? '.mcp.github.ro.json' : '.mcp.github.rw.json',
      tools: ['Write', 'ToolSearch', 'TodoWrite'],
      extraEnv: { GITHUB_TOOLSETS: 'context,repos,issues,pull_requests,users,actions' },
    },
  };
}

/** Forwards the agent token under the key each arm's tool expects. */
export function buildGithubAgentEnv(arm: Arm, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (arm === 'baseline') return {};
  const agentToken = env.GITHUB_AGENT_TOKEN ?? '';
  const host = env.GITHUB_HOST ?? '';
  if (arm === 'skill') {
    return {
      GH_TOKEN: agentToken,
      GITHUB_TOKEN: agentToken,
      ...(host ? { GH_HOST: host } : {}),
    };
  }
  return {
    GITHUB_PERSONAL_ACCESS_TOKEN: agentToken,
    ...(host ? { GITHUB_HOST: host } : {}),
  };
}

/** Tier 1 (read-only) GitHub experiment, selected with `--experiment github`. */
export const githubExperiment: ExperimentSpec = {
  name: 'github',
  description: 'GitHub tool surface: gh CLI skill vs github-mcp-server. Tier 1 read-only.',
  arms: buildArms(true),
  classifier: buildGitHubClassifier({ readOnly: true }),
  tasksPath: 'experiments/github/tasks/index.js',
  buildAgentEnv: arm => buildGithubAgentEnv(arm),
  preflight: async () => {
    loadGithubConfig();
  },
};

/**
 * Read-write spec for Tier 2 mutation tasks, selected with `--experiment github-rw`.
 * Shares the `github` storage name, so results land under experiments/github/runs/.
 */
export const githubExperimentRw: ExperimentSpec = {
  ...githubExperiment,
  arms: buildArms(false),
  classifier: buildGitHubClassifier({ readOnly: false }),
};
