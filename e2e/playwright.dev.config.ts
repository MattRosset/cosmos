import { defineConfig } from '@playwright/test';

/** Dev-server config for local transition diagnostics (port 5173). */
export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 720 },
    video: 'on',
    trace: 'off',
    // Match the CI config: seed the first-run "seen" flag so the one-time teaching
    // overlay (TASK-066 V1) never covers the HUD during local diagnostics. Origin is
    // the dev server (5173), not the CI preview (4173).
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:5173',
          localStorage: [{ name: 'cosmos.firstrun.v1', value: '1' }],
        },
      ],
    },
  },
  outputDir: './test-results-dev',
});
