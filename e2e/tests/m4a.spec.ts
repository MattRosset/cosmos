import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-052 — M4a acceptance: Gaia render-tier unification + atmosphere + overlays +
 * tours + cinematic.
 *
 * Two surfaces are exercised:
 *  - `?debug=m4a` — the scripted M3 descent (M3DescentProbe) run against the M4a
 *    composition (combined HYG + Gaia octree, coverage-driven procgen fade + monolith
 *    gate, Earth atmosphere). Used for the tier-unification + atmosphere assertions,
 *    which need a deterministic descent to Earth.
 *  - the production app (`/`) — the full HUD, used for the overlay toggles and the
 *    guided tour + cinematic letterbox.
 *
 * State is read from `window.__cosmos` (the ≤ 4 Hz mirror) + `window.__cosmosDev`
 * (deterministic tier/tour control). Chromium-only, like the other M-gates. The
 * `__cosmos` Window type is declared in m1.spec.ts with the M2/M3 shape, so the M4a
 * fields are reached through a local cast inside each browser-eval callback.
 */

const RESULT_TIMEOUT_MS = 60_000;

/** The M4a-relevant slice of `window.__cosmos` (cast inside browser callbacks). */
interface M4aHook {
  ready: boolean;
  catalogCoverage: number;
  procgenOpacity: number;
  atmosphereMounted: boolean;
  overlays: { constellations: boolean; labels: boolean };
  tour: { active: boolean; stepIndex: number };
  cinematicActive: boolean;
  streaming: { renderedPoints: number; drawCalls: number; inFlight: number };
}

interface M4aSample {
  maxCoverage: number;
  minProcgenWhileCovered: number;
  atmosphereEverMounted: boolean;
  maxRenderedPoints: number;
  maxDrawCalls: number;
  maxInFlight: number;
}

declare global {
  interface Window {
    __m4aSample?: M4aSample;
    __cosmosDev?: {
      setTier(tier: 'high' | 'medium' | 'low' | null): void;
      startTour(): void;
      stopTour(): void;
      focusFirstLabel(): void;
    };
  }
}

/** Sample the M4a hooks every frame, recording the extremes the descent reaches. */
async function injectM4aSampler(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const s: M4aSample = {
      maxCoverage: 0,
      minProcgenWhileCovered: 1,
      atmosphereEverMounted: false,
      maxRenderedPoints: 0,
      maxDrawCalls: 0,
      maxInFlight: 0,
    };
    window.__m4aSample = s;
    const tick = (): void => {
      const c = window.__cosmos as unknown as M4aHook | undefined;
      if (c) {
        if (c.catalogCoverage > s.maxCoverage) s.maxCoverage = c.catalogCoverage;
        // The procgen fade engages in galaxy context as the catalog covers the cut.
        if (c.catalogCoverage >= 0.5 && c.procgenOpacity < s.minProcgenWhileCovered) {
          s.minProcgenWhileCovered = c.procgenOpacity;
        }
        if (c.atmosphereMounted) s.atmosphereEverMounted = true;
        if (c.streaming.renderedPoints > s.maxRenderedPoints) s.maxRenderedPoints = c.streaming.renderedPoints;
        if (c.streaming.drawCalls > s.maxDrawCalls) s.maxDrawCalls = c.streaming.drawCalls;
        if (c.streaming.inFlight > s.maxInFlight) s.maxInFlight = c.streaming.inFlight;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, { timeout: 30_000 });
}

async function waitDescent(page: Page): Promise<{ finalContext: string; finalAnchor: string | null }> {
  await page.waitForFunction(
    () => (window as unknown as { __m3Result?: unknown }).__m3Result !== undefined,
    undefined,
    { timeout: RESULT_TIMEOUT_MS },
  );
  return page.evaluate(
    () =>
      (window as unknown as {
        __m3Result: { finalContext: string; finalAnchor: string | null };
      }).__m3Result,
  );
}

test('M4a tier unification: catalog coverage drives the procgen fade; budgets hold', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await injectM4aSampler(page);
  await page.goto('/?debug=m4a');
  await page.waitForSelector('canvas');
  await waitReady(page);

  const result = await waitDescent(page);
  expect(result.finalContext, 'descent ends in the Sol system').toBe('system');
  expect(result.finalAnchor).toBe('sol');

  const s = (await page.evaluate(() => window.__m4aSample)) as M4aSample;
  console.log(
    `[m4a] coverageMax=${s.maxCoverage.toFixed(3)} procgenMin=${s.minProcgenWhileCovered.toFixed(3)} ` +
      `pts=${s.maxRenderedPoints} draws=${s.maxDrawCalls} inFlight=${s.maxInFlight}`,
  );

  // The combined HYG + Gaia octree covers part of the cut (catalog credibility).
  expect(s.maxCoverage, 'octree tiles cover part of the cut').toBeGreaterThan(0);
  // ADR-006 §5.1: once the catalog covers the cut, the procgen cloud fades out
  // (replacing M3's hard GAL_PROCGEN_FLOOR of 0.5 — the opacity must drop below it).
  expect(
    s.minProcgenWhileCovered,
    'procgen opacity fades below the retired M3 floor as the catalog covers the cut',
  ).toBeLessThan(0.5);

  // §5.8 budget caps still hold across the whole descent.
  expect(s.maxRenderedPoints, 'rendered points within the high-tier cap').toBeLessThanOrEqual(2_000_000);
  expect(s.maxDrawCalls, 'draw calls within the budget').toBeLessThanOrEqual(300);
  expect(s.maxInFlight, 'in-flight requests within the cap').toBeLessThanOrEqual(6);

  expect(pageErrors, 'no uncaught errors during the M4a descent').toHaveLength(0);
});

test('M4a atmosphere: mounted on Earth at high, unmounted at medium/low', async ({ page }) => {
  await page.goto('/?debug=m4a');
  await page.waitForSelector('canvas');
  await waitReady(page);
  await waitDescent(page); // ends at the Earth approach in the Sol system

  // High tier (default): the Earth atmosphere shell is mounted.
  await page.waitForFunction(
    () => (window.__cosmos as unknown as M4aHook | undefined)?.atmosphereMounted === true,
    undefined,
    { timeout: RESULT_TIMEOUT_MS },
  );

  // Forcing medium/low (ADR-005 §5 degradation) unmounts it.
  await page.evaluate(() => window.__cosmosDev?.setTier('low'));
  await page.waitForFunction(
    () => (window.__cosmos as unknown as M4aHook | undefined)?.atmosphereMounted === false,
    undefined,
    { timeout: RESULT_TIMEOUT_MS },
  );

  // Restoring high re-mounts it.
  await page.evaluate(() => window.__cosmosDev?.setTier('high'));
  await page.waitForFunction(
    () => (window.__cosmos as unknown as M4aHook | undefined)?.atmosphereMounted === true,
    undefined,
    { timeout: RESULT_TIMEOUT_MS },
  );
});

test('M4a overlays: constellation + label toggles drive the store and the HUD', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
  await waitReady(page);

  // Constellations: toggle on via the HUD control → store reflects it.
  await page.getByRole('button', { name: 'Constellations' }).click();
  await page.waitForFunction(
    () => (window.__cosmos as unknown as M4aHook | undefined)?.overlays.constellations === true,
    undefined,
    { timeout: RESULT_TIMEOUT_MS },
  );

  // Labels: toggle on → store reflects it AND the label layer renders entries.
  await page.getByRole('button', { name: 'Labels' }).click();
  await page.waitForFunction(
    () => (window.__cosmos as unknown as M4aHook | undefined)?.overlays.labels === true,
    undefined,
    { timeout: RESULT_TIMEOUT_MS },
  );
  // The labelled stars are the brightest giants — distant and scattered, so the
  // arbitrary boot orientation frames none of them. Reorient to face the brightest
  // one so a label is deterministically on-screen, then assert it reaches the DOM.
  await page.evaluate(() => window.__cosmosDev?.focusFirstLabel());
  await page.waitForFunction(() => document.querySelectorAll('.cosmos-ui-label').length > 0, undefined, {
    timeout: RESULT_TIMEOUT_MS,
  });

  // Both off → no label entries remain.
  await page.getByRole('button', { name: 'Constellations' }).click();
  await page.getByRole('button', { name: 'Labels' }).click();
  await page.waitForFunction(
    () =>
      (window.__cosmos as unknown as M4aHook | undefined)?.overlays.labels === false &&
      document.querySelectorAll('.cosmos-ui-label').length === 0,
    undefined,
    { timeout: RESULT_TIMEOUT_MS },
  );
});

test('M4a guided tour: cinematic flight + letterbox chrome, exit returns to free flight', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
  await waitReady(page);

  // Start the committed grand tour.
  await page.evaluate(() => window.__cosmosDev?.startTour());
  await page.waitForFunction(
    () => (window.__cosmos as unknown as M4aHook | undefined)?.tour.active === true,
    undefined,
    { timeout: RESULT_TIMEOUT_MS },
  );

  // The tour card is shown and the app flies a cinematic spline to step 0.
  await expect(page.getByRole('region', { name: 'Guided tour' })).toBeVisible();
  await page.waitForFunction(
    () => (window.__cosmos as unknown as M4aHook | undefined)?.cinematicActive === true,
    undefined,
    { timeout: RESULT_TIMEOUT_MS },
  );
  // Letterbox chrome is active during the cinematic.
  await expect(page.locator('.hud-letterbox--active')).toHaveCount(1);

  // Exit returns to free flight (no cinematic, no tour).
  await page.getByRole('button', { name: 'Exit tour' }).click();
  await page.waitForFunction(
    () => {
      const c = window.__cosmos as unknown as M4aHook | undefined;
      return c?.tour.active === false && c?.cinematicActive === false;
    },
    undefined,
    { timeout: RESULT_TIMEOUT_MS },
  );
});
