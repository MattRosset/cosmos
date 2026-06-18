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
  },
  outputDir: './test-results-dev',
});
