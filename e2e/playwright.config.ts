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
  //
  // Local (non-CI) is capped at 2 — NOT Playwright's default (~half the logical cores).
  // The heavy WebGL specs each boot a full SwiftShader scene; letting the default fan
  // out saturates every core and can lock up a dev machine (and orphans chromium on
  // interrupt). Two is the ceiling that stays responsive; drop to `--workers=1` for a
  // single heavy spec.
  workers: CI ? 1 : 2,

  use: {
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    animations: 'disabled',
    // Seed the first-run "seen" flag (TASK-066 V1) for every spec so the one-time
    // teaching overlay never covers the HUD the other gates drive. The dedicated
    // first-run spec opts back into a fresh context via `test.use({ storageState })`.
    // Origin must match the preview webServer below (baseURL defaults to it).
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:4173',
          localStorage: [{ name: 'cosmos.firstrun.v1', value: '1' }],
        },
      ],
    },
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
      testMatch: '**/{smoke,flythrough3,flythrough4}.spec.ts',
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
      testMatch: '**/{smoke,flythrough3,flythrough4}.spec.ts',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
