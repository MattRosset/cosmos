import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-085 — the overlay nebulae + constellation lines subtend their PHYSICAL size in
 * every scale context.
 *
 * Before this task `Overlays.tsx` passed `toRenderSpace`'s active-context-unit offset to
 * renderers holding PARSEC geometry. In universe context that pairs a 0.18 (Mpc) offset
 * with radii of 9.9…49.5 in the same units: the eye sits inside the billboards and the
 * viewport washes to near-white over 98% of its area. The fix scales the whole layer at
 * the projection (`uPcToUnits`), so this gate is a frame statistic, not a uniform value —
 * a uniform assertion is exactly what hid the sibling defect (TASK-082).
 *
 * Deterministic only — no screenshots, no wall-clock assertions, no `@perf` tag. The frame
 * statistic comes from `__cosmos.readFrameStats()` (a read hook on the app, CLAUDE.md
 * testing rule 1); nothing here re-derives camera math or does test-side canvas math.
 */

/** CI is SwiftShader and slow; every poll gets an explicit generous timeout (the CI-only
 *  flakes in this repo were fixed by adding one, never by loosening an assertion). */
const POLL_TIMEOUT_MS = 45_000;

/** Pixels above luma 200, over the whole drawing buffer. Measured pre-fix: 0.98 with
 *  constellations off, 0.58 with them on; post-ablation 0.001. */
const HOT_FRAC_MAX = 0.02;
/** Positive control: the galaxy must still be DRAWN. Measured 0.0066 with the overlays
 *  ablated, 0 on a black frame — so "delete the scene" does not pass this spec. */
const LIT_FRAC_MIN = 0.0002;

/**
 * The TASK-085-relevant slice of `window.__cosmos`. The global `__cosmos` type is declared
 * in m1.spec.ts with the M2/M3 shape, so the newer fields are reached through a local cast
 * inside each browser-eval callback — the m4a.spec.ts pattern.
 */
interface ScaleHook {
  ready: boolean;
  contextId: string;
  goToActive: boolean;
  qualityTier: string;
  procgenOpacity: number;
  cameraPosition: { context: string; local: [number, number, number] };
  overlays: { constellations: boolean; labels: boolean };
  errorCounts: { total: number };
  readFrameStats(): Promise<{
    width: number;
    height: number;
    meanLuma: number;
    litFrac: number;
    hotFrac: number;
  } | null>;
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 30_000,
  });
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
        overlays: c?.overlays,
        procgenOpacity: c?.procgenOpacity,
        errorCounts: c?.errorCounts,
      };
    }),
  );
}

test.describe('TASK-085 — overlay context scale', () => {
  test('the universe vantage is not washed out by the overlays', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas');
    await waitReady(page);

    // The nebula layer is tier-gated (`nebulaeAllowed = tier !== 'low'`), so a drifted
    // tier makes this whole spec VACUOUS — the broken layer simply stops drawing. Pin
    // high (the override also disables PerformanceMonitor's stepDown) and assert it.
    await page.evaluate(() => window.__cosmosDev?.setTier('high'));
    await page.waitForFunction(
      () => (window.__cosmos as unknown as ScaleHook | undefined)?.qualityTier === 'high',
      undefined,
      { timeout: POLL_TIMEOUT_MS },
    );
    const tier = await page.evaluate(
      () => (window.__cosmos as unknown as ScaleHook | undefined)?.qualityTier,
    );
    expect(tier, `quality tier is ${tier}; a 'low' tier hides the nebula and voids this spec`).toBe(
      'high',
    );

    // Constellations default OFF, so the line-set half of the defect is hidden by a
    // default. Toggle it on through the real HUD control, then CLOSE the drawer — an
    // open drawer intercepts the breadcrumb click.
    await page.getByRole('button', { name: 'View settings' }).click();
    await page.getByRole('button', { name: 'Constellations' }).click();
    await page.waitForFunction(
      () =>
        (window.__cosmos as unknown as ScaleHook | undefined)?.overlays.constellations === true,
      undefined,
      { timeout: POLL_TIMEOUT_MS },
    );
    await page.keyboard.press('Escape');

    // The segment boots disabled (gated on galaxyNavReady); wait for it explicitly
    // rather than leaning on Playwright's implicit actionability timeout
    // (universe-ascent.spec.ts:63-66).
    const universe = page.getByRole('button', { name: /Universe/i });
    await expect(universe).toBeEnabled({ timeout: 30_000 });
    await universe.click();

    // Read the SETTLED 0.18 Mpc vantage, never a mid-flight frame.
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
      console.log(`universe-overlay-scale: never settled at the vantage; ${await snapshot(page)}`);
      throw e;
    }

    const stats = await page.evaluate(() =>
      (window.__cosmos as unknown as ScaleHook).readFrameStats(),
    );
    expect(stats, `readFrameStats() returned null; ${await snapshot(page)}`).not.toBeNull();
    const s = stats!;

    // Log BEFORE asserting — a CI-only failure must be triagable from logs alone.
    console.log(
      `universe-overlay-scale: stats=${JSON.stringify(s)} state=${await snapshot(page)}`,
    );

    expect(
      s.hotFrac,
      `hotFrac=${s.hotFrac} (meanLuma=${s.meanLuma}) — the overlays are washing out the universe vantage`,
    ).toBeLessThan(HOT_FRAC_MAX);
    expect(
      s.litFrac,
      `litFrac=${s.litFrac} (meanLuma=${s.meanLuma}) — nothing is being drawn at all`,
    ).toBeGreaterThan(LIT_FRAC_MIN);

    const errors = await page.evaluate(
      () => (window.__cosmos as unknown as ScaleHook | undefined)?.errorCounts,
    );
    expect(errors?.total, `errorCounts=${JSON.stringify(errors)}`).toBe(0);
  });
});
