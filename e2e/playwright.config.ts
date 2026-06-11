import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env['CI'];

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  reporter: CI ? [['html', { outputFolder: 'playwright-report', open: 'never' }]] : 'list',

  use: {
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    animations: 'disabled',
  },

  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },

  snapshotDir: './tests/__screenshots__',
  // Drop the OS suffix from snapshot names — rendering is pinned via SwiftShader
  // so local (win32) and CI (linux) produce identical pixels.
  snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}{-projectName}{ext}',

  webServer: {
    command: 'pnpm --filter @cosmos/web preview --port 4173',
    port: 4173,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        launchOptions: {
          // Deterministic software GL on CI runners — must match when recording baselines.
          args: ['--use-angle=swiftshader'],
        },
      },
    },
    {
      // TASK-014: WebKit runs smoke.spec.ts only — WebGL screenshot assertions are
      // flaky under Linux WebKit's software GL renderer. Perf and flythrough tests
      // are chromium-only for signal reliability.
      name: 'webkit',
      testMatch: '**/smoke.spec.ts',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
