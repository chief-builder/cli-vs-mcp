import { playwrightExperiment } from './playwright.js';
import { githubExperiment, githubExperimentRw } from './github.js';
import type { ExperimentSpec } from '../experiment.js';

export type ExperimentName = 'playwright' | 'github' | 'github-rw';

export const experiments: Record<ExperimentName, ExperimentSpec> = {
  playwright: playwrightExperiment,
  github: githubExperiment,
  'github-rw': githubExperimentRw,
};

export function getExperiment(name: string): ExperimentSpec {
  if (!(name in experiments)) {
    throw new Error(`Unknown experiment "${name}". Known: ${Object.keys(experiments).join(', ')}`);
  }
  return experiments[name as ExperimentName];
}
