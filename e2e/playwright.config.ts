import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env['CI'];

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  reporter: CI ? [['html', { outputFolder: 'playwright-report', open: 'never' }]] : 'list',
  // Serial on CI — NOT for perf accuracy (perf gates now run reference-only, @perf /
  // !process.env.CI). The 2-vCPU runner can't run the heavy WebGL specs (flythrough3,
  // m3, soak3, m1/m2 flights) in parallel without starving them: a workers=2 run timed
  // out 7 of them (soak3 alone doubled, 74s→124s) while every deterministic cap still
  // held. So one worker is what lets these heavy specs finish inside their
  // waitForFunction timeouts. To cut wall-clock, shard across runners (each serial) —
  // don't raise workers here.
  workers: CI ? 1 : undefined,

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
      // TASK-014 + TASK-041: WebKit runs smoke.spec.ts and the recorded-flythrough
      // perf gate (flythrough3.spec.ts, §6 cross-browser matrix). WebGL *screenshot*
      // assertions stay chromium-only — flaky under Linux WebKit's software GL — but
      // the flythrough's frame-time + cap clauses run here (no screenshots; the heap
      // assertion is chromium-only since WebKit lacks performance.memory).
      name: 'webkit',
      testMatch: '**/{smoke,flythrough3}.spec.ts',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
    {
      // TASK-041: Firefox joins the §6 cross-browser matrix on the same scope as
      // WebKit — smoke + flythrough3 (perf-relaxed). Heap assertion is chromium-only.
      name: 'firefox',
      testMatch: '**/{smoke,flythrough3}.spec.ts',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
