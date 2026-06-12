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
      // SwiftShader is deterministic per-build, but win32 and linux Chromium ship
      // different SwiftShader/Skia builds, so AA edges and canvas-texture text
      // rasterize ~3% differently against a single shared baseline. This ratio
      // absorbs that cross-platform noise while still failing on gross scene
      // regressions (a broken render differs by far more than this).
      maxDiffPixelRatio: 0.05,
    },
  },

  snapshotDir: './tests/__screenshots__',
  // One shared baseline across win32/linux (no OS suffix). Exact pixels differ
  // by platform (see maxDiffPixelRatio above); the gate is intentionally a
  // coarse "scene still renders" signal, not pixel-perfect parity.
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
