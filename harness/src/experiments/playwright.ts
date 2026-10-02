import type { ExperimentSpec, ExperimentClassifier, ArmConfig, Arm } from '../experiment.js';
import {
  splitTopLevelShellSegments,
  hasShellAccountingSyntax,
  stripSimpleRedirections,
  standaloneWordPattern,
  SHELL_HELPERS,
} from '../shell.js';

const INVALID_HELPERS_RE = standaloneWordPattern(SHELL_HELPERS);

function isPlaywrightCliSegment(segment: string): boolean {
  const normalized = stripSimpleRedirections(segment);
  if (!/^playwright-cli(\s|$)/.test(normalized)) return false;
  if (/`|\$\(/.test(normalized)) return false;
  const rest = normalized.replace(/^playwright-cli(\s|$)/, ' ');
  return !INVALID_HELPERS_RE.test(rest);
}

export const playwrightClassifier: ExperimentClassifier = {
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

const arms: Record<Arm, ArmConfig> = {
  baseline: {
    id: 'baseline',
    description: 'No browser, shell, skill, or sub-agent execution path — pure reasoning floor',
    mcpConfig: '{"mcpServers":{}}',
    tools: ['Read', 'Glob', 'Grep', 'Write', 'ToolSearch', 'TodoWrite'],
  },
  skill: {
    id: 'skill',
    description: 'Playwright CLI Skill — playwright-cli Bash commands plus Write for artifacts',
    mcpConfig: '{"mcpServers":{}}',
    tools: ['Skill', 'Bash', 'Write', 'ToolSearch', 'TodoWrite'],
  },
  mcp: {
    id: 'mcp',
    description: 'Playwright MCP — mcp__playwright__* tools only, no Skill, no Bash',
    mcpConfig: '.mcp.playwright.json',
    tools: ['Write', 'ToolSearch', 'TodoWrite'],
  },
};

export const playwrightExperiment: ExperimentSpec = {
  name: 'playwright',
  description: 'Playwright tool surface: CLI skill vs MCP server, browser-based fixtures over HTTP',
  arms,
  classifier: playwrightClassifier,
  tasksPath: 'experiments/playwright/tasks/index.js',
};
