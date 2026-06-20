import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env['CI'];

export default defineConfig({
  testDir: './tests',
  // 90s (up from 60s) so medium WebGL specs (m1/m2 flights) absorb the slower
  // wall-clock of sharing 2 vCPU under workers:2; the heaviest specs (flythrough3,
  // soak3) set their own longer timeouts.
  timeout: 90_000,
  reporter: CI ? [['html', { outputFolder: 'playwright-report', open: 'never' }]] : 'list',
  // CI parallelism (revisited): the single worker was originally required so the
  // perf gates' frame-time measurements weren't inflated by CPU contention. Those
  // perf gates now run reference-only (@perf / !process.env.CI) — the CI gate is
  // deterministic work-budget + correctness (draw-call/point/in-flight caps, switch
  // sequences, errors), which CPU contention CANNOT fail in false. So we parallelize
  // to cut wall-clock; 2 workers matches the 2-vCPU runner. If a heavy WebGL spec
  // ever times out under contention here, drop back to 1 or shard across runners.
  workers: CI ? 2 : undefined,

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
