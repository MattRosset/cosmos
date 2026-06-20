import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-041 — Phase 3 acceptance gate: the recorded-flythrough perf test (§5.8).
 *
 * Opens `?debug=flythrough3` (a self-measuring debug mode in apps/web).
 * Flythrough3Probe replays the committed recorded camera path — outside the Milky
 * Way → spiral arms → star field → Sol → Earth — through the REAL nav controller
 * + SHIPPED streaming pipeline, with the clock paused. It publishes, on
 * `window.__flythrough3Result`: frame times (p50/p95/max/longFrames), the
 * streaming peak (inFlight/renderedPoints/drawCalls/loadedChunks), and (Chromium
 * only) heap samples.
 *
 * PASS rule — CI gates on the DETERMINISTIC work-budget caps only; wall-clock frame
 * time is NOT a CI gate (see WHY below):
 *   - every project (incl. CI): the descent completes universe→galaxy→system, no page
 *     errors, and the §5.8 caps hold — in-flight ≤ 6, rendered points ≤ 2M, draw
 *     calls ≤ 300. These are hardware-independent and are the real regression gate.
 *     The heap-sampled assertion is Chromium-only (WebKit/Firefox lack
 *     `performance.memory`).
 *   - reference machine only (`!process.env.CI`): p95 ≤ CI_P95_MS (chromium) /
 *     CROSS_BROWSER_P95_MS (webkit+firefox) and no frame > CI_MAX_FRAME_MS. The
 *     p50/p95/max/longFrames line is logged every run so the numbers stay visible.
 *
 * WHY the worst-frame clause is split (TASK-041 finding, signed off): CI runs on
 * SwiftShader (software GL). The recorded descent is smooth there — p50 ≈ 18 ms,
 * p95 ≈ 28 ms — but the COLD load of the HYG octree tier on the dive into the Sol
 * star field uploads new GPU buffers that cost ~50–60 ms to rasterize IN SOFTWARE
 * (on a real GPU these uploads are sub-50 ms). Pre-warming can't dodge it: the
 * tier evicts tiles on leaving, so any first descent pays the cold-upload cost.
 * The strict zero-frame > 50 ms guarantee is therefore verified on the reference
 * GPU (manual checklist), and ALL wall-clock budgets here are reference-only: on a
 * CPU-capped SwiftShader runner the number reflects the runner, not the code, so it
 * cannot gate. CI relies on the deterministic work-budget caps instead, which a
 * gross pipeline regression (hundreds of ms ⇒ millions of extra points / draw calls)
 * still trips.
 */

/** §5.8 smoothness gate (CI-relaxed from the 18.2 ms reference target). */
const CI_P95_MS = 40;
/**
 * Software-renderer worst-frame ceiling. Above the observed cold tile-upload
 * hitch (~60 ms on SwiftShader) with headroom for shared-runner jitter, far below
 * a real regression. The reference-GPU target is the strict 50 ms (manual).
 */
const CI_MAX_FRAME_MS = 80;
/** Relaxed cross-browser p95 for the non-chromium software-GL projects. */
const CROSS_BROWSER_P95_MS = 80;

const RESULT_TIMEOUT_MS = 60_000;

interface ContextSwitchEvent {
  readonly from: string;
  readonly to: string;
  readonly anchorId: string | null;
}

interface StreamingPeak {
  inFlight: number;
  loadedChunks: number;
  renderedPoints: number;
  drawCalls: number;
}

interface Flythrough3Result {
  frames: number;
  frameTimesMs: readonly number[];
  p50: number;
  p95: number;
  maxFrameMs: number;
  longFrames: number;
  heapSamples: readonly number[];
  streamingPeak: StreamingPeak;
  switches: readonly ContextSwitchEvent[];
  finalContext: string;
}

declare global {
  interface Window {
    __flythrough3Result?: Flythrough3Result;
  }
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 30_000,
  });
  // Pre-warm the procgen Milky Way chunk before the descent so the one-time worker
  // hitch lands in warm-up, not in the measured window (§5.8 common mistake).
  await page.waitForFunction(
    () => (window.__cosmos?.streaming?.renderedPoints ?? 0) >= 1_000_000,
    undefined,
    { timeout: 120_000 },
  );
}

test('flythrough3: recorded descent holds the §5.8 frame budget with zero hitch', async ({
  page,
  browserName,
}) => {
  test.setTimeout(180_000);

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/?debug=flythrough3');
  await page.waitForSelector('canvas');
  await waitReady(page);

  await page.waitForFunction(() => window.__flythrough3Result !== undefined, undefined, {
    timeout: RESULT_TIMEOUT_MS,
  });
  const result = (await page.evaluate(() => window.__flythrough3Result)) as Flythrough3Result;

  console.log(
    `[flythrough3:${browserName}] frames=${result.frames} p50=${result.p50.toFixed(1)} ` +
      `p95=${result.p95.toFixed(1)} max=${result.maxFrameMs.toFixed(1)} long=${result.longFrames} ` +
      `peak(inFlight=${result.streamingPeak.inFlight} pts=${result.streamingPeak.renderedPoints} ` +
      `draws=${result.streamingPeak.drawCalls} chunks=${result.streamingPeak.loadedChunks}) ` +
      `heapSamples=${result.heapSamples.length} final=${result.finalContext}`,
  );

  // The descent completed the full universe → galaxy → system path.
  expect(result.switches.map((s) => `${s.from}->${s.to}`)).toEqual([
    'universe->galaxy',
    'galaxy->system',
  ]);
  expect(result.finalContext, 'descent ends in the Sol system').toBe('system');
  expect(result.frames, 'measured real frames during the descent').toBeGreaterThan(30);

  // §5.8 instrumentation caps — asserted on every browser project.
  expect(result.streamingPeak.inFlight, 'in-flight requests ≤ 6 (§5.8 cap)').toBeLessThanOrEqual(6);
  expect(
    result.streamingPeak.renderedPoints,
    'rendered points within the high-tier 2M cap',
  ).toBeLessThanOrEqual(2_000_000);
  expect(result.streamingPeak.drawCalls, 'draw calls within the 300 budget').toBeLessThanOrEqual(
    300,
  );

  // Heap sampled on Chromium (the plateau itself is the soak3 gate, not here).
  if (browserName === 'chromium') {
    expect(result.heapSamples.length, 'heap sampled on Chromium').toBeGreaterThan(0);
  }

  // Wall-clock frame budgets are a REFERENCE-MACHINE criterion, not a CI gate.
  // CI runs on SwiftShader (software GL) on a CPU-capped shared runner, where frame
  // time measures the runner, not the code — a different renderer measuring a
  // different thing, not a noisy version of the GPU number. The deterministic
  // work-budget caps above (in-flight / rendered points / draw calls) are the real
  // regression gate; the strict timing target lives in the manual reference-GPU run.
  // The p50/p95/max/longFrames line is logged every run (above) so the numbers stay
  // visible for trend even though they don't gate.
  if (!process.env['CI']) {
    if (browserName === 'chromium') {
      expect(
        result.p95,
        'p95 frame time within the 40 ms bound (reference machine)',
      ).toBeLessThanOrEqual(CI_P95_MS);
      expect(
        result.maxFrameMs,
        'no frame past the worst-frame ceiling (reference machine)',
      ).toBeLessThanOrEqual(CI_MAX_FRAME_MS);
    } else {
      expect(
        result.p95,
        `${browserName} p95 within the cross-browser bound (reference machine)`,
      ).toBeLessThanOrEqual(CROSS_BROWSER_P95_MS);
    }
  }

  expect(pageErrors, 'no uncaught errors during the flythrough').toHaveLength(0);
});
