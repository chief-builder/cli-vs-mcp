import type { Arm } from './experiment.js';
import type { ExperimentClassifier } from './experiment.js';

export interface ToolCallRecord {
  name: string;
  turnIndex: number;
  command?: string;
}

export interface EscapeToolCallRecord extends ToolCallRecord {
  reason: string;
}

export interface Metrics {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  toolCalls: ToolCallRecord[];
  toolCallCount: number;
  turns: number;
  wallClockMs: number;
  contextWindowPeak: number;
  totalCostUsd: number;
  modelsUsed: string[];
  /**
   * True iff the agent invoked an intended tool at least once: a Skill call
   * matching the experiment's intendedSkillName OR a tool whose name starts
   * with the experiment's intendedMcpPrefix.
   */
  usedIntendedTool: boolean;
  validToolSurface: boolean;
  escapeToolUsed: boolean;
  escapeToolCalls: EscapeToolCallRecord[];
  /**
   * Research-mode flag: true when every Bash call contained exactly one
   * intended-CLI command (no `&&`, `;`, `|`, redirections, or substitutions).
   */
  singleCliCommandPerToolCall: boolean;
  cliCommandGranularityViolations: EscapeToolCallRecord[];
}

interface AssistantEvent {
  type: 'assistant';
  message: {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'thinking'; thinking: string }
      | { type: 'tool_use'; id: string; name: string; input: unknown }
    >;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

interface ResultEvent {
  type: 'result';
  subtype?: 'success' | 'error';
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, ModelUsage>;
}

type StreamEvent = AssistantEvent | ResultEvent | { type: string };

function getSkillName(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const skill = (input as { skill?: unknown }).skill;
  return typeof skill === 'string' ? skill : null;
}

function getBashCommand(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const command = (input as { command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
}

const ALWAYS_BLOCKED_NAMES = new Set(['WebFetch', 'WebSearch', 'Monitor', 'CronCreate', 'RemoteTrigger']);

function classifyToolUse(
  arm: Arm | undefined,
  classifier: ExperimentClassifier,
  name: string,
  input: unknown,
): { surfaceReason: string | null; granularityReason: string | null } {
  if (!arm) return { surfaceReason: null, granularityReason: null };

  if (ALWAYS_BLOCKED_NAMES.has(name)) {
    const reason = `${name} is an out-of-band execution or fetch path`;
    return { surfaceReason: reason, granularityReason: reason };
  }

  const isIntendedMcpTool = name.startsWith(classifier.intendedMcpPrefix);

  if (arm === 'baseline') {
    if (name === 'Bash' || name === 'Skill' || name === 'Task' || name === 'Agent' || isIntendedMcpTool) {
      const reason = `${name} is not allowed in the baseline arm`;
      return { surfaceReason: reason, granularityReason: reason };
    }
    return { surfaceReason: null, granularityReason: null };
  }

  if (arm === 'mcp') {
    if (name === 'Bash' || name === 'Skill' || name === 'Task' || name === 'Agent') {
      const reason = `${name} is not allowed in the mcp arm`;
      return { surfaceReason: reason, granularityReason: reason };
    }
    return { surfaceReason: null, granularityReason: null };
  }

  if (arm === 'skill') {
    if (name === 'Task' || name === 'Agent' || isIntendedMcpTool) {
      const reason = `${name} is not allowed in the skill arm`;
      return { surfaceReason: reason, granularityReason: reason };
    }
    if (name === 'Skill') {
      const skill = getSkillName(input);
      const reason = skill === classifier.intendedSkillName
        ? null
        : `unexpected skill ${skill ?? '(unknown)'}`;
      return { surfaceReason: reason, granularityReason: reason };
    }
    if (name === 'Bash') {
      const command = getBashCommand(input);
      if (!command) {
        return {
          surfaceReason: 'Bash command missing command text',
          granularityReason: 'Bash command missing command text',
        };
      }
      return classifier.classifyShellCommand(command);
    }
  }

  return { surfaceReason: null, granularityReason: null };
}

export function parseTranscript(rawLines: string[], arm: Arm | undefined, classifier: ExperimentClassifier): Metrics {
  const events: StreamEvent[] = [];
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      events.push(JSON.parse(trimmed) as StreamEvent);
    } catch {
      // skip malformed
    }
  }

  const metrics: Metrics = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    toolCalls: [],
    toolCallCount: 0,
    turns: 0,
    wallClockMs: 0,
    contextWindowPeak: 0,
    totalCostUsd: 0,
    modelsUsed: [],
    usedIntendedTool: false,
    validToolSurface: true,
    escapeToolUsed: false,
    escapeToolCalls: [],
    singleCliCommandPerToolCall: true,
    cliCommandGranularityViolations: [],
  };

  let turnIndex = 0;

  for (const event of events) {
    if (event.type === 'assistant') {
      const e = event as AssistantEvent;
      turnIndex++;
      metrics.turns++;

      const usage = e.message.usage;
      if (usage) {
        const tokensInContext = (usage.input_tokens ?? 0)
          + (usage.cache_read_input_tokens ?? 0)
          + (usage.cache_creation_input_tokens ?? 0);
        if (tokensInContext > metrics.contextWindowPeak) {
          metrics.contextWindowPeak = tokensInContext;
        }
      }

      for (const block of e.message.content) {
        if (block.type === 'tool_use') {
          const command = block.name === 'Bash' ? getBashCommand(block.input) : undefined;
          const record: ToolCallRecord = {
            name: block.name,
            turnIndex,
            ...(command ? { command } : {}),
          };
          metrics.toolCalls.push(record);
          metrics.toolCallCount++;
          if (block.name.startsWith(classifier.intendedMcpPrefix)) {
            metrics.usedIntendedTool = true;
          } else if (block.name === 'Skill') {
            if (getSkillName(block.input) === classifier.intendedSkillName) {
              metrics.usedIntendedTool = true;
            }
          }

          const { surfaceReason, granularityReason } = classifyToolUse(arm, classifier, block.name, block.input);
          if (surfaceReason) {
            metrics.validToolSurface = false;
            metrics.escapeToolUsed = true;
            metrics.escapeToolCalls.push({ ...record, reason: surfaceReason });
          }
          if (granularityReason) {
            metrics.singleCliCommandPerToolCall = false;
            metrics.cliCommandGranularityViolations.push({ ...record, reason: granularityReason });
          }
        }
      }
    }

    if (event.type === 'result') {
      const e = event as ResultEvent;
      metrics.wallClockMs = e.duration_ms ?? 0;
      metrics.totalCostUsd = e.total_cost_usd ?? 0;

      if (e.modelUsage && typeof e.modelUsage === 'object') {
        for (const [model, u] of Object.entries(e.modelUsage)) {
          metrics.modelsUsed.push(model);
          metrics.inputTokens += u.inputTokens ?? 0;
          metrics.outputTokens += u.outputTokens ?? 0;
          metrics.cachedInputTokens += u.cacheReadInputTokens ?? 0;
          metrics.cacheCreationInputTokens += u.cacheCreationInputTokens ?? 0;
        }
      } else if (e.usage) {
        metrics.inputTokens = e.usage.input_tokens ?? 0;
        metrics.outputTokens = e.usage.output_tokens ?? 0;
        metrics.cachedInputTokens = e.usage.cache_read_input_tokens ?? 0;
        metrics.cacheCreationInputTokens = e.usage.cache_creation_input_tokens ?? 0;
      }
    }
  }

  return metrics;
}
