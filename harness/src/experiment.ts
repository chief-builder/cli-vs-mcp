import { z } from 'zod';
import type { Task } from './tasks.js';

export const ArmSchema = z.enum(['baseline', 'skill', 'mcp']);
export type Arm = z.infer<typeof ArmSchema>;

/**
 * Per-arm tool isolation: which MCP config to point Claude Code at, the
 * positive allow-list of tools, and the negative deny-list. Plus an
 * `extraEnv` map for env vars the arm needs in the child process
 * (e.g. GITHUB_TOKEN for the skill arm, GITHUB_PERSONAL_ACCESS_TOKEN for
 * the mcp arm).
 */
export const ArmConfigSchema = z.object({
  id: ArmSchema,
  description: z.string(),
  mcpConfig: z.string(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()),
  extraFlags: z.array(z.string()),
  extraEnv: z.record(z.string(), z.string()).optional(),
});
export type ArmConfig = z.infer<typeof ArmConfigSchema>;

/**
 * Per-experiment classifier rules. The transcript classifier in metrics.ts
 * is hard-wired to nothing — it takes its rules from the active experiment's
 * spec so adding a new experiment doesn't require editing the harness core.
 *
 * `classifyShellCommand` is called for every Bash tool call in the skill arm.
 * Return surfaceReason !== null to flag the call as out-of-surface; return
 * granularityReason !== null to flag it as multi-command (matters for
 * research-single mode).
 */
export interface ExperimentClassifier {
  intendedMcpPrefix: string;
  intendedSkillName: string;
  intendedShellCommand: string;
  classifyShellCommand(cmd: string): { surfaceReason: string | null; granularityReason: string | null };
}

export interface ExperimentSpec {
  name: string;
  description: string;
  arms: Record<Arm, ArmConfig>;
  classifier: ExperimentClassifier;
  /**
   * Optional pre-flight check run once before the first trial of a given run.
   * Use it to assert credentials, container images, or external services are
   * reachable. Throwing aborts the run.
   */
  preflight?: () => Promise<void>;
  /**
   * Loaded lazily by the runner — keeps the experiment registry decoupled
   * from per-experiment task definitions.
   */
  tasksPath: string;
  /**
   * Per-arm runtime env vars injected into the child claude process. Called
   * once per trial after the GITHUB_* env scrub. Use this to read tokens
   * from the parent process env and forward them under the right key for
   * each arm (e.g., GH_TOKEN for skill, GITHUB_PERSONAL_ACCESS_TOKEN for
   * mcp).
   */
  buildAgentEnv?: (arm: Arm) => Record<string, string>;
}

export type LoadedExperiment = ExperimentSpec & { tasks: Task[] };
