import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: {
        // TASK-062: measured 76.9% at wiring time; ratchet up, never down.
        statements: 75,
      },
    },
  },
});
