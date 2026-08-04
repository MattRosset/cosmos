import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Entry-point CLIs are thin argv wrappers around tested functions (their logic lives in
      // build.ts / gaia-ingest.ts, covered ≥95%); they run top-level on import via process.argv
      // and are exercised via `build:*` scripts, not unit tests. Excluding them scopes the gate
      // to logic — with them out, real coverage is ~96% (TASK-070).
      exclude: ['src/cli.ts', 'src/gaia-cli.ts', 'src/gaia-index-cli.ts'],
      thresholds: {
        // TASK-062: measured 80.3% at wiring time; ratcheted to 90 once the CLI entry points
        // were scoped out (TASK-070). Ratchet up, never down.
        statements: 90,
      },
    },
  },
});
