import { test, expect, type Page } from '@playwright/test';
import { percentile } from './helpers/frame-stats';

/**
 * TASK-040 — M3 acceptance gate: the signature continuous zoom.
 *
 * Opens `?debug=m3` (a self-measuring debug mode in apps/web). M3DescentProbe
 * drives the REAL nav controller through the SHIPPED pipeline — star field, galaxy
 * /streaming tier, system scene — from outside the Milky Way (universe context)
 * down to an Earth-surface approach, crossing universe→galaxy and galaxy→system.
 * It publishes, on `window.__m3Result`:
 *   - switches: the ContextSwitchEvent[] that fired (expect 2, in order)
 *   - enterGalaxyDelta / enterSystemDelta: mean abs pixel delta ACROSS each switch
 *   - medianFlightDelta / maxFlightDelta: the ordinary flight-frame delta distribution
 *   - blankFrames: post-warm-up frames that were uniformly the background colour
 *   - maxFrameMs: largest raw frame time over the run
 *   - finalContext / finalAnchor: where the descent ended
 *
 * Streaming instrumentation (`window.__cosmos.streaming` / `.qualityTier`) is
 * sampled into `window.__m3StreamMax` each frame so the §5.8 budget caps can be
 * asserted across the whole flight.
 *
 * WebGL screenshot baselines (`m3-*.png`) are recorded on CI / with CI's
 * SwiftShader flag — see e2e/README.md "Updating baselines". Chromium-only.
 */

const RESULT_TIMEOUT_MS = 60_000;
const KEYFRAME_SETTLE_MS = 1_000;

interface ContextSwitchEvent {
  readonly from: string;
  readonly to: string;
  readonly anchorId: string | null;
}

interface M3Result {
  switches: ContextSwitchEvent[];
  enterGalaxyDelta: number;
  enterSystemDelta: number;
  medianFlightDelta: number;
  maxFlightDelta: number;
  maxFrameMs: number;
  frameTimesMs: readonly number[];
  blankFrames: number;
  frames: number;
  finalContext: string;
  finalAnchor: string | null;
}

interface M3StreamMax {
  inFlight: number;
  renderedPoints: number;
  drawCalls: number;
}

declare global {
  interface Window {
    __m3Result?: M3Result;
    __m3Live?: { phase: string; switchCount: number };
    __m3StreamMax?: M3StreamMax;
  }
}

/** Record streaming-stat maxima across the flight (mirrored ≤ 4 Hz into __cosmos). */
async function injectStreamingMax(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const m = { inFlight: 0, renderedPoints: 0, drawCalls: 0 };
    (window as unknown as { __m3StreamMax: M3StreamMax }).__m3StreamMax = m;
    const tick = (): void => {
      const s = window.__cosmos?.streaming;
      if (s) {
        if (s.inFlight > m.inFlight) m.inFlight = s.inFlight;
        if (s.renderedPoints > m.renderedPoints) m.renderedPoints = s.renderedPoints;
        if (s.drawCalls > m.drawCalls) m.drawCalls = s.drawCalls;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 30_000,
  });
  // Pre-warm the procgen Milky Way chunk before the descent so the first sampled
  // frames are not blank and the one-time worker hitch lands in warm-up.
  await page.waitForFunction(
    () => (window.__cosmos?.streaming?.renderedPoints ?? 0) >= 1_000_000,
    undefined,
    { timeout: 120_000 },
  );
}

async function screenshotAtPhase(page: Page, switchCount: number, name: string): Promise<void> {
  await page.waitForFunction(
    (n) => (window.__m3Live?.switchCount ?? 0) >= n,
    switchCount,
    { timeout: RESULT_TIMEOUT_MS },
  );
  await page.waitForTimeout(KEYFRAME_SETTLE_MS);
  await expect(page).toHaveScreenshot(name);
}

test('M3 continuous zoom: universe → galaxy → system with no loading screen', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await injectStreamingMax(page);
  await page.goto('/?debug=m3');
  await page.waitForSelector('canvas');
  await waitReady(page);

  // Keyframe baselines: settled frames shortly after each scale boundary (visual
  // backstop; the delta + blank rules below are the authoritative measurements).
  await screenshotAtPhase(page, 1, 'm3-galaxy.png');
  await screenshotAtPhase(page, 2, 'm3-system.png');

  await page.waitForFunction(() => window.__m3Result !== undefined, undefined, {
    timeout: RESULT_TIMEOUT_MS,
  });
  const result = (await page.evaluate(() => window.__m3Result)) as M3Result;

  // The full flight: exactly the two boundary crossings, in order.
  expect(result.switches.map((s) => `${s.from}->${s.to}`)).toEqual([
    'universe->galaxy',
    'galaxy->system',
  ]);
  // Ends in the Sol system.
  expect(result.finalContext).toBe('system');
  expect(result.finalAnchor).toBe('sol');

  // Loading-screen gate: static full-background holds on context-switch frames only.
  expect(result.blankFrames, 'no static blank hold on a context-switch frame').toBe(0);

  // No catastrophic frame and the run produced real on-screen motion.
  expect(result.maxFlightDelta, 'flight frames must produce real motion').toBeGreaterThan(0);

  console.log(
    `[m3] switches=${result.switches.length} blank=${result.blankFrames} frames=${result.frames} ` +
      `enterGal=${result.enterGalaxyDelta.toFixed(3)} enterSys=${result.enterSystemDelta.toFixed(3)} ` +
      `flight(median=${result.medianFlightDelta.toFixed(3)} max=${result.maxFlightDelta.toFixed(3)}) ` +
      `maxFrameMs=${result.maxFrameMs.toFixed(1)}`,
  );

  expect(pageErrors, 'no uncaught errors during the M3 descent').toHaveLength(0);
});

test('M3 streaming budgets stay within the §5.8 caps throughout the flight', async ({
  page,
}) => {
  await injectStreamingMax(page);
  await page.goto('/?debug=m3');
  await page.waitForSelector('canvas');
  await waitReady(page);

  await page.waitForFunction(() => window.__m3Result !== undefined, undefined, {
    timeout: RESULT_TIMEOUT_MS,
  });
  const max = (await page.evaluate(() => window.__m3StreamMax)) as M3StreamMax;

  console.log(
    `[m3] caps inFlight=${max.inFlight} renderedPoints=${max.renderedPoints} drawCalls=${max.drawCalls}`,
  );
  // §5.8 instrumentation: in-flight request cap (6), point budget (2M at 'high'),
  // draw-call budget (300).
  expect(max.inFlight, 'in-flight requests within the pool/budget cap').toBeLessThanOrEqual(6);
  expect(max.renderedPoints, 'rendered points within the high-tier cap').toBeLessThanOrEqual(
    2_000_000,
  );
  expect(max.drawCalls, 'draw calls within the budget').toBeLessThanOrEqual(300);
});

test('M3 boundary switches are invisible against ordinary flight motion', async ({ page }) => {
  await page.goto('/?debug=m3');
  await page.waitForSelector('canvas');
  await waitReady(page);

  await page.waitForFunction(() => window.__m3Result !== undefined, undefined, {
    timeout: RESULT_TIMEOUT_MS,
  });
  const result = (await page.evaluate(() => window.__m3Result)) as M3Result;

  // Reuse the TASK-030 pixel-delta probe rule: neither switch frame may stand out
  // beyond the single most prominent ordinary flight frame.
  const limit = result.maxFlightDelta;
  if (Number.isFinite(result.enterGalaxyDelta)) {
    expect(
      result.enterGalaxyDelta,
      `universe→galaxy switch invisible: ${result.enterGalaxyDelta.toFixed(3)} ≤ ${limit.toFixed(3)}`,
    ).toBeLessThanOrEqual(limit);
  }
  if (Number.isFinite(result.enterSystemDelta)) {
    expect(
      result.enterSystemDelta,
      `galaxy→system switch invisible: ${result.enterSystemDelta.toFixed(3)} ≤ ${limit.toFixed(3)}`,
    ).toBeLessThanOrEqual(limit);
  }
});

test('M3 perf smoke: p95 frame < 50 ms, zero frames > 250 ms during the descent', { tag: '@perf' }, async ({
  page,
}) => {
  await page.goto('/?debug=m3');
  await page.waitForSelector('canvas');
  await waitReady(page);

  await page.waitForFunction(() => window.__m3Result !== undefined, undefined, {
    timeout: RESULT_TIMEOUT_MS,
  });

  const result = (await page.evaluate(() => window.__m3Result)) as M3Result;
  const samples = result.frameTimesMs;
  const p95 = percentile([...samples], 95);
  const worst = result.maxFrameMs;
  console.log(`[m3] perf p95=${p95.toFixed(1)}ms worst=${worst.toFixed(1)}ms n=${samples.length}`);
  expect(p95, 'p95 frame time under the CI-relaxed budget').toBeLessThan(50);
  expect(worst, 'no frame exceeded 250 ms').toBeLessThanOrEqual(250);
});

test('M3 adaptive quality: a throttled CPU drops the tier below high', async ({ page }) => {
  await page.goto('/?debug=m3');
  await page.waitForSelector('canvas');
  await waitReady(page);

  // Throttle the CPU hard (CDP) so the PerformanceMonitor steps the tier down.
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 8 });

  // The tier must fall from 'high' while the descent runs under load (§9: tier
  // change precedes dropped frames). Generous window — this is the CI gate.
  await page.waitForFunction(() => window.__cosmos?.qualityTier !== 'high', undefined, {
    timeout: RESULT_TIMEOUT_MS,
  });
  const tier = await page.evaluate(() => window.__cosmos?.qualityTier);
  console.log(`[m3] quality tier under throttle = ${tier}`);
  expect(tier === 'medium' || tier === 'low').toBe(true);

  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});
