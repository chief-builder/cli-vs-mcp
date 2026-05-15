import type { ExperimentSpec, ExperimentClassifier, ArmConfig } from '../experiment.js';
import { splitTopLevelShellSegments, hasShellAccountingSyntax, stripSimpleRedirections } from '../shell.js';

const ALWAYS_BLOCKED = ['WebFetch', 'WebSearch', 'Monitor', 'CronCreate', 'RemoteTrigger'];
const COMMON_FLAGS = ['--setting-sources', 'project,local', '--permission-mode', 'bypassPermissions'];

const INVALID_HELPERS_RE = /\b(curl|wget|cat|ls|python|python3|node|npm|npx|sh|bash|zsh|jq|sed|awk|grep|head|tail)\b/;

function isPlaywrightCliSegment(segment: string): boolean {
  const normalized = stripSimpleRedirections(segment);
  if (!/^playwright-cli(\s|$)/.test(normalized)) return false;
  if (/`|\$\(/.test(normalized)) return false;
  const rest = normalized.replace(/^playwright-cli(\s|$)/, ' ');
  return !INVALID_HELPERS_RE.test(rest);
}

const classifier: ExperimentClassifier = {
  intendedMcpPrefix: 'mcp__playwright__',
  intendedSkillName: 'playwright-cli',
  intendedShellCommand: 'playwright-cli',

  classifyShellCommand(command: string) {
    const segments = splitTopLevelShellSegments(command);
    if (segments.length === 0) {
      return { surfaceReason: 'empty Bash command', granularityReason: 'empty Bash command' };
    }
    const badSegment = segments.find(s => !isPlaywrightCliSegment(s));
    if (badSegment) {
      const reason = `non-playwright-cli Bash segment: ${badSegment.slice(0, 120)}`;
      return { surfaceReason: reason, granularityReason: reason };
    }
    const granularityReason = hasShellAccountingSyntax(command)
      ? `multiple shell operations in one Bash call: ${command.slice(0, 120)}`
      : null;
    return { surfaceReason: null, granularityReason };
  },
};

const arms: Record<'baseline' | 'skill' | 'mcp', ArmConfig> = {
  baseline: {
    id: 'baseline',
    description: 'No browser, shell, skill, or sub-agent execution path — pure reasoning floor',
    mcpConfig: '{"mcpServers":{}}',
    allowedTools: ['ToolSearch', 'Read', 'Glob', 'Grep', 'Write', 'TodoWrite'],
    disallowedTools: ['Skill', 'Bash', 'Task', 'Agent', ...ALWAYS_BLOCKED],
    extraFlags: [...COMMON_FLAGS],
  },
  skill: {
    id: 'skill',
    description: 'Playwright CLI Skill — playwright-cli Bash commands plus Write for artifacts',
    mcpConfig: '{"mcpServers":{}}',
    allowedTools: [
      'ToolSearch',
      'Skill',
      'Bash(playwright-cli:*)',
      'Write',
      'TodoWrite',
    ],
    disallowedTools: ['Task', 'Agent', ...ALWAYS_BLOCKED],
    extraFlags: [...COMMON_FLAGS],
  },
  mcp: {
    id: 'mcp',
    description: 'Playwright MCP — mcp__playwright__* tools only, no Skill, no Bash',
    mcpConfig: '.mcp.playwright.json',
    allowedTools: [
      'ToolSearch',
      'Write',
      'TodoWrite',
      'mcp__playwright__browser_click',
      'mcp__playwright__browser_close',
      'mcp__playwright__browser_console_messages',
      'mcp__playwright__browser_drag',
      'mcp__playwright__browser_drop',
      'mcp__playwright__browser_evaluate',
      'mcp__playwright__browser_file_upload',
      'mcp__playwright__browser_fill_form',
      'mcp__playwright__browser_handle_dialog',
      'mcp__playwright__browser_hover',
      'mcp__playwright__browser_navigate',
      'mcp__playwright__browser_navigate_back',
      'mcp__playwright__browser_network_request',
      'mcp__playwright__browser_network_requests',
      'mcp__playwright__browser_press_key',
      'mcp__playwright__browser_resize',
      'mcp__playwright__browser_run_code_unsafe',
      'mcp__playwright__browser_select_option',
      'mcp__playwright__browser_snapshot',
      'mcp__playwright__browser_tabs',
      'mcp__playwright__browser_take_screenshot',
      'mcp__playwright__browser_type',
      'mcp__playwright__browser_wait_for',
    ],
    disallowedTools: ['Skill', 'Bash', 'Task', 'Agent', ...ALWAYS_BLOCKED],
    extraFlags: [...COMMON_FLAGS],
  },
};

export const playwrightExperiment: ExperimentSpec = {
  name: 'playwright',
  description: 'Playwright tool surface: CLI skill vs MCP server, browser-based fixtures over HTTP',
  arms,
  classifier,
  tasksPath: 'experiments/playwright/tasks/index.js',
};
