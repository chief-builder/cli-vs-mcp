import type { IncomingMessage, ServerResponse } from 'node:http';

export interface SuccessResult {
  pass: boolean;
  score: number;
  notes: string;
  /** Per-task custom metrics surfaced into the trial result JSON. */
  extras?: Record<string, unknown>;
}

export interface TaskContext {
  rootDir: string;
  fixturesPath: string;
  fixturesUrl: string;
  outputDir: string;
  state: unknown;
}

export type RenderFn = (
  state: unknown,
  req: IncomingMessage,
  res: ServerResponse,
  body: Buffer,
) => Promise<boolean> | boolean;

export interface Task {
  id: string;
  tier: 1 | 2 | 3;
  setup?: (seed: string) => Promise<unknown> | unknown;
  renderResponse?: RenderFn;
  prompt: (ctx: TaskContext) => string;
  successCheck: (ctx: TaskContext) => Promise<SuccessResult>;
  /** Optional teardown — runs after successCheck whether or not the trial passed. */
  cleanup?: (state: unknown) => Promise<void> | void;
}
