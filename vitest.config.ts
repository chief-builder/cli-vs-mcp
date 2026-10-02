import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['harness/src/**/*.ts', 'experiments/github/provisioner.ts', 'experiments/*/tasks/*.ts'],
      reporter: ['text', 'json-summary'],
    },
  },
});
