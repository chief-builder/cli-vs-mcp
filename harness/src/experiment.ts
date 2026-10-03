import { z } from 'zod';

export const ArmSchema = z.enum(['baseline', 'skill', 'mcp']);
export type Arm = z.infer<typeof ArmSchema>;
export const ARMS: readonly Arm[] = ArmSchema.options;

/**
 * Per-arm tool isolation.
 *
 * `tools` is passed to `claude --tools` and is the positive list of built-in
 * tools the agent gets. MCP tools come only from `mcpConfig`. The classifier
 * treats the same list as the arm's surface, so configuration and validity
 * scoring can't drift apart.
 *
 * `sandboxNetwork`, when set, runs Bash inside Claude Code's OS sandbox with no
 * unsandboxed fallback. Reads under the home directory are denied, and only the
 * listed hosts are on the allow-list. Use it for arms whose shell must not reach
 * the developer's own credentials (for example, the gh keyring login).
 */
export interface ArmConfig {
  id: Arm;
  description: string;
  /** Inline JSON or a path relative to the repo root. */
  mcpConfig: string;
  tools: readonly string[];
  extraEnv?: Record<string, string>;
  sandboxNetwork?: readonly string[];
}

/**
 * Per-experiment classifier rules. metrics.ts calls `classifyShellCommand` for
 * every Bash call in the skill arm. Return surfaceReason !== null to flag the
 * call as out-of-surface; return granularityReason !== null to flag it as
 * multi-command (which matters in research-single mode).
 */
export interface ExperimentClassifier {
  intendedMcpPrefix: string;
  intendedSkillName: string;
  intendedShellCommand: string;
  classifyShellCommand(cmd: string): { surfaceReason: string | null; granularityReason: string | null };
}

export interface ExperimentSpec {
  /** Storage name: results go under experiments/<name>/runs/. */
  name: string;
  description: string;
  arms: Record<Arm, ArmConfig>;
  classifier: ExperimentClassifier;
  /**
   * Optional check run once before the first trial. Assert credentials,
   * container images, or external services here. Throwing aborts the run.
   */
  preflight?: () => Promise<void>;
  /** Module exporting `tasks: Task[]`, relative to the repo root. Loaded lazily. */
  tasksPath: string;
  /**
   * Per-arm env vars injected into the child `claude` process after the GH_* /
   * GITHUB_* scrub. Used to forward the agent token under the key each arm
   * expects.
   */
  buildAgentEnv?: (arm: Arm) => Record<string, string>;
}
