import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-082 — the far-LOD Milky Way impostor draws at its PHYSICAL radius.
 *
 * Before this task the radius was baked into `mesh.scale`, which the impostor's vertex
 * shader never reads (it uses neither `modelMatrix` nor `modelViewMatrix`). The sprite was
 * therefore always one render-space unit across — sub-pixel at every distance the app uses
 * — and had **never contributed a pixel in production**, while a unit test asserting
 * `mesh.scale` stayed green. Measurements: docs/research/galaxy-impostor-scale-is-inert.md.
 *
 * So this gate is in PIXELS, and it is self-relative: it ablates the impostor inside the
 * run (`__cosmosDev.setImpostorRadiusPc`) and compares frames. An absolute lit-pixel
 * threshold would encode one machine's SwiftShader build; a delta against the same frame
 * cannot. Pre-change the delta is exactly 0 — the radius reaches nothing — so this spec
 * cannot pass against the old module.
 *
 * Deterministic only: a frame statistic via `__cosmos.readFrameStats()` (CLAUDE.md testing
 * rule 1 — ask the app, never re-derive), no screenshots, no wall-clock, no `@perf`.
 */

/** CI is SwiftShader and slow; every poll gets an explicit generous timeout. */
const POLL_TIMEOUT_MS = 45_000;

/**
 * Measured on win32 SwiftShader at the settled 0.18 Mpc vantage (radius = discRadiusPc,
 * 15,000 pc): litFrac 0.006584 with the impostor, 0.005455 ablated — a delta of 0.001130.
 * The floor is ~40% of that, which is far above rasterisation noise and far below the
 * signal, so a cross-platform SwiftShader difference cannot flip it. PRE-CHANGE the delta
 * is 0.000000 (the radius never reached the GPU), which is what this floor gates.
 */
const MIN_IMPOSTOR_LIT_DELTA = 0.00045;
/**
 * Positive control: with the impostor ablated the galaxy must STILL be drawn, so "delete
 * the scene" cannot pass this spec. Measured 0.005455 ablated; 0 on a black frame.
 */
const MIN_ABLATED_LIT_FRAC = 0.002;

interface ScaleHook {
  ready: boolean;
  contextId: string;
  goToActive: boolean;
  qualityTier: string;
  procgenOpacity: number;
  cameraPosition: { context: string; local: [number, number, number] };
  errorCounts: { total: number };
  readFrameStats(): Promise<{
    width: number;
    height: number;
    meanLuma: number;
    litFrac: number;
    hotFrac: number;
  } | null>;
}

interface FrameStats {
  width: number;
  height: number;
  meanLuma: number;
  litFrac: number;
  hotFrac: number;
}

/** Everything needed to triage a CI-only failure from logs alone (CLAUDE.md rule 6). */
async function snapshot(page: Page): Promise<string> {
  return JSON.stringify(
    await page.evaluate(() => {
      const c = window.__cosmos as unknown as ScaleHook | undefined;
      return {
        contextId: c?.contextId,
        qualityTier: c?.qualityTier,
        cameraPosition: c?.cameraPosition,
        goToActive: c?.goToActive,
        procgenOpacity: c?.procgenOpacity,
        errorCounts: c?.errorCounts,
      };
    }),
  );
}

async function readStats(page: Page, label: string): Promise<FrameStats> {
  const s = await page.evaluate(() =>
    (window.__cosmos as unknown as ScaleHook).readFrameStats(),
  );
  expect(s, `readFrameStats() returned null at "${label}"; ${await snapshot(page)}`).not.toBeNull();
  // Log every reading BEFORE any assertion — CI-only failures must be triagable from logs.
  console.log(`universe-impostor-scale: ${label} ${JSON.stringify(s)}`);
  return s!;
}

/** `null` restores the shipped radius. */
async function setRadiusPc(page: Page, radiusPc: number | null): Promise<void> {
  await page.evaluate((r) => window.__cosmosDev?.setImpostorRadiusPc(r), radiusPc);
}

test.describe('TASK-082 — galaxy impostor radius reaches the screen', () => {
  test('the impostor contributes pixels, and more of them as it grows', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas');
    await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
      timeout: 30_000,
    });

    // The procgen layer (which carries the impostor) is tier-gated downstream, and a drifted
    // tier changes the draw budget under us. Pin high (this also disables PerformanceMonitor
    // stepDown) and assert it, or the whole spec can go vacuous.
    await page.evaluate(() => window.__cosmosDev?.setTier('high'));
    await page.waitForFunction(
      () => (window.__cosmos as unknown as ScaleHook | undefined)?.qualityTier === 'high',
      undefined,
      { timeout: POLL_TIMEOUT_MS },
    );

    // Ascend to universe context through the real HUD control. The segment boots disabled
    // (gated on galaxyNavReady), so wait for enablement explicitly.
    const universe = page.getByRole('button', { name: /Universe/i });
    await expect(universe).toBeEnabled({ timeout: 30_000 });
    await universe.click();

    // Read only the SETTLED vantage (~0.18 Mpc), never a mid-flight frame.
    try {
      await page.waitForFunction(
        () => {
          const c = window.__cosmos as unknown as ScaleHook | undefined;
          if (!c || c.contextId !== 'universe' || c.goToActive) return false;
          const l = c.cameraPosition.local;
          return Math.hypot(l[0]!, l[1]!, l[2]!) > 0.175;
        },
        undefined,
        { timeout: POLL_TIMEOUT_MS },
      );
    } catch (e) {
      console.log(`universe-impostor-scale: never settled at the vantage; ${await snapshot(page)}`);
      throw e;
    }

    // The impostor only owns a share of the galaxy's brightness once the far LOD takes over;
    // if the procgen layer is off entirely there is nothing to measure.
    const procgen = await page.evaluate(
      () => (window.__cosmos as unknown as ScaleHook).procgenOpacity,
    );
    expect(procgen, `procgenOpacity=${procgen}; the procgen layer is off, spec is vacuous`).toBeGreaterThan(0);

    const shipped = await readStats(page, 'shipped radius (discRadiusPc)');

    // Ablate: radius 0 collapses the billboard to a point. `applyFrame` rewrites the radius
    // every frame from the override, so this holds until released.
    await setRadiusPc(page, 0);
    const ablated = await readStats(page, 'ablated (radius 0)');

    // Grow it: strictly more lit pixels than the shipped radius.
    await setRadiusPc(page, 30_000);
    const doubled = await readStats(page, 'doubled radius (30000 pc)');

    await setRadiusPc(page, null);

    const delta = shipped.litFrac - ablated.litFrac;
    console.log(
      `universe-impostor-scale: litFrac shipped=${shipped.litFrac} ablated=${ablated.litFrac} ` +
        `doubled=${doubled.litFrac} delta=${delta} state=${await snapshot(page)}`,
    );

    expect(
      delta,
      `the impostor contributes ${delta} of the frame — at 0 its radius is not reaching the GPU ` +
        `(shipped=${shipped.litFrac}, ablated=${ablated.litFrac})`,
    ).toBeGreaterThan(MIN_IMPOSTOR_LIT_DELTA);

    expect(
      doubled.litFrac,
      `doubling the radius did not grow the sprite (doubled=${doubled.litFrac}, shipped=${shipped.litFrac})`,
    ).toBeGreaterThan(shipped.litFrac);

    expect(
      ablated.litFrac,
      `litFrac=${ablated.litFrac} with the impostor ablated — the galaxy itself is not drawn, ` +
        `so this spec would pass on an empty scene`,
    ).toBeGreaterThan(MIN_ABLATED_LIT_FRAC);

    const errors = await page.evaluate(
      () => (window.__cosmos as unknown as ScaleHook | undefined)?.errorCounts,
    );
    expect(errors?.total, `errorCounts=${JSON.stringify(errors)}`).toBe(0);
  });
});
