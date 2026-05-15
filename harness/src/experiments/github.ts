import type { ExperimentSpec, ExperimentClassifier, ArmConfig } from '../experiment.js';
import {
  splitTopLevelShellSegments,
  stripSimpleRedirections,
  hasShellAccountingSyntax,
  hasShellRedirection,
} from '../shell.js';

const ALWAYS_BLOCKED = ['WebFetch', 'WebSearch', 'Monitor', 'CronCreate', 'RemoteTrigger'];
const COMMON_FLAGS = ['--setting-sources', 'project,local', '--permission-mode', 'bypassPermissions'];

// Match helpers that appear as their own shell token — preceded by start-of-string or whitespace.
// Crucially this must NOT match `gh`'s own `--jq` / `--sed` flags or paths containing the names.
const INVALID_HELPERS_RE = /(?:^|\s)(curl|wget|cat|ls|python|python3|node|npm|npx|sh|bash|zsh|jq|sed|awk|grep|head|tail|git)\b/;

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
  const explicitRead = /\s(?:--method|--method=|-X|-X=)\s*(GET|HEAD)\b/i.test(segment)
    || /\s(?:--method)=(GET|HEAD)\b/i.test(segment)
    || /\s-X=(GET|HEAD)\b/i.test(segment);
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
      return { ok: false, rawApi: true, reason: `read-only mode: gh api write (explicit or implicit POST) in segment: ${normalized.slice(0, 120)}` };
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
      if (hasShellRedirection(command)) {
        const reason = `shell redirection: ${command.slice(0, 120)}`;
        return { surfaceReason: reason, granularityReason: reason };
      }
      for (const seg of segments) {
        const r = isGhSegment(seg, opts.readOnly);
        if (!r.ok) {
          return { surfaceReason: r.reason ?? 'invalid gh segment', granularityReason: r.reason ?? 'invalid gh segment' };
        }
      }
      const granularityReason = hasShellAccountingSyntax(command)
        ? `multiple shell operations in one Bash call: ${command.slice(0, 120)}`
        : null;
      return { surfaceReason: null, granularityReason };
    },
  };
}

/**
 * Read-only MCP tool prefix allow-list. The default toolset
 * (context,repos,issues,pull_requests,users) only exposes read operations
 * when the MCP server is launched with --read-only, but we enumerate the
 * expected names so verify-arms shows a concrete surface.
 *
 * GitHub MCP server tool names use snake_case with no toolset prefix:
 * `mcp__github__list_issues`, not `mcp__github__issues__list`. The list
 * below was hand-curated from the github-mcp-server README's Tools section.
 */
const GITHUB_READ_TOOLS = [
  // context
  'mcp__github__get_me',
  // repos (read)
  'mcp__github__get_repository',
  'mcp__github__list_repositories',
  'mcp__github__search_repositories',
  'mcp__github__list_branches',
  'mcp__github__list_tags',
  'mcp__github__list_commits',
  'mcp__github__get_commit',
  'mcp__github__get_file_contents',
  'mcp__github__list_releases',
  'mcp__github__get_release',
  // issues (read)
  'mcp__github__list_issues',
  'mcp__github__get_issue',
  'mcp__github__get_issue_comments',
  'mcp__github__search_issues',
  // pull requests (read)
  'mcp__github__list_pull_requests',
  'mcp__github__get_pull_request',
  'mcp__github__get_pull_request_diff',
  'mcp__github__get_pull_request_files',
  'mcp__github__get_pull_request_comments',
  'mcp__github__get_pull_request_reviews',
  'mcp__github__search_pull_requests',
  // users (read)
  'mcp__github__search_users',
];

const GITHUB_WRITE_TOOLS = [
  // repos (write)
  'mcp__github__create_or_update_file',
  'mcp__github__delete_file',
  'mcp__github__create_branch',
  'mcp__github__create_repository',
  // issues (write)
  'mcp__github__create_issue',
  'mcp__github__update_issue',
  'mcp__github__add_issue_comment',
  // pull requests (write)
  'mcp__github__create_pull_request',
  'mcp__github__update_pull_request',
  'mcp__github__create_pull_request_review',
  'mcp__github__merge_pull_request',
  // releases (write)
  'mcp__github__create_release',
];

function buildArms(readOnly: boolean): Record<'baseline' | 'skill' | 'mcp', ArmConfig> {
  const mcpAllowedTools = readOnly
    ? GITHUB_READ_TOOLS
    : [...GITHUB_READ_TOOLS, ...GITHUB_WRITE_TOOLS];
  const mcpConfigPath = readOnly ? '.mcp.github.ro.json' : '.mcp.github.rw.json';
  const toolsets = 'context,repos,issues,pull_requests,users';

  return {
    baseline: {
      id: 'baseline',
      description: 'No GitHub execution surface — pure reasoning floor against off-host state',
      mcpConfig: '{"mcpServers":{}}',
      allowedTools: ['ToolSearch', 'Read', 'Glob', 'Grep', 'Write', 'TodoWrite'],
      disallowedTools: ['Skill', 'Bash', 'Task', 'Agent', ...ALWAYS_BLOCKED],
      extraFlags: [...COMMON_FLAGS],
    },
    skill: {
      id: 'skill',
      description: 'GitHub CLI skill — gh commands plus Write for artifacts',
      mcpConfig: '{"mcpServers":{}}',
      allowedTools: [
        'ToolSearch',
        'Skill',
        'Bash(gh:*)',
        'Write',
        'TodoWrite',
      ],
      disallowedTools: ['Task', 'Agent', ...ALWAYS_BLOCKED],
      extraFlags: [...COMMON_FLAGS],
    },
    mcp: {
      id: 'mcp',
      description: readOnly
        ? 'GitHub MCP (read-only) — mcp__github__* read tools only'
        : 'GitHub MCP (read-write) — mcp__github__* read and write tools',
      mcpConfig: mcpConfigPath,
      allowedTools: ['ToolSearch', 'Write', 'TodoWrite', ...mcpAllowedTools],
      disallowedTools: ['Skill', 'Bash', 'Task', 'Agent', ...ALWAYS_BLOCKED],
      extraFlags: [...COMMON_FLAGS],
      extraEnv: { GITHUB_TOOLSETS: toolsets },
    },
  };
}

function buildGithubAgentEnv(arm: 'baseline' | 'skill' | 'mcp'): Record<string, string> {
  const agentToken = process.env.GITHUB_AGENT_TOKEN ?? '';
  const host = process.env.GITHUB_HOST ?? '';
  if (arm === 'baseline') return {};
  if (arm === 'skill') {
    return {
      GH_TOKEN: agentToken,
      GITHUB_TOKEN: agentToken,
      ...(host ? { GH_HOST: host } : {}),
    };
  }
  // mcp arm
  return {
    GITHUB_PERSONAL_ACCESS_TOKEN: agentToken,
    ...(host ? { GITHUB_HOST: host } : {}),
  };
}

/**
 * Default (Tier 1, read-only) GitHub experiment. The runner picks this spec
 * for `--experiment github` unless the task itself opts into mutation mode.
 */
export const githubExperiment: ExperimentSpec = {
  name: 'github',
  description: 'GitHub tool surface: gh CLI skill vs github-mcp-server. Tier 1 read-only.',
  arms: buildArms(true),
  classifier: buildGitHubClassifier({ readOnly: true }),
  tasksPath: 'experiments/github/tasks/index.js',
  buildAgentEnv: buildGithubAgentEnv,
  preflight: async () => {
    const missing: string[] = [];
    if (!process.env.GITHUB_AGENT_TOKEN) missing.push('GITHUB_AGENT_TOKEN');
    if (!process.env.GITHUB_CONTROLLER_TOKEN) missing.push('GITHUB_CONTROLLER_TOKEN');
    if (!process.env.GITHUB_SANDBOX_OWNER) missing.push('GITHUB_SANDBOX_OWNER');
    if (missing.length > 0) {
      throw new Error(
        `GitHub experiment requires env vars: ${missing.join(', ')}.\n` +
          'See README.md "Running the GitHub experiment" for setup. Tokens must be scoped to the sandbox owner only.',
      );
    }
  },
};

/** Read-write spec for Tier 2+ mutation tasks. Selected via --experiment github-rw. */
export const githubExperimentRw: ExperimentSpec = {
  ...githubExperiment,
  arms: buildArms(false),
  classifier: buildGitHubClassifier({ readOnly: false }),
  buildAgentEnv: buildGithubAgentEnv,
};
