import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-086 (G4) — clicking a local-group galaxy in `universe` context selects it and
 * shows its deterministic generated name (`Galaxy G-<n>`) in the breadcrumb.
 *
 * Uses the app's own pick/projection query hooks (`__cosmos.projectToScreen` /
 * `__cosmos.pickAt`) rather than re-deriving the camera projection in test code
 * (CLAUDE.md testing rules 1/2) and asserts the resulting text via a role locator
 * (`getByRole('navigation', { name: 'Location' })` then `getByText`), not a coordinate
 * probe (rule 3) — the breadcrumb's current segment is a plain `<span>` with no role of
 * its own, so the nav landmark is the stable anchor.
 *
 * Deterministic only — no screenshots, no wall-clock assertions, no `@perf` tag.
 */

const POLL_TIMEOUT_MS = 45_000;
/**
 * Settle wait after `orientTo` (durationMs 600 in `StarApp.tsx`'s dev-surface wiring).
 * `window.__cosmos.goToActive` is only mirrored on a ≤4 Hz timer (`glue/time.ts`), which
 * makes it a RACY settlement signal here: it can read stale `false` (left over from the
 * PRIOR flight) before the mirror ever observes `orientTo`'s flight go true, so polling
 * for "goToActive === false" can resolve before the slew even starts, leaving the pixel
 * read stale by click time (measured: this spec flaked exactly this way). A fixed
 * settle wait — same pattern as `ctxswitch.spec.ts`/`m3.spec.ts`'s `KEYFRAME_SETTLE_MS`
 * — sidesteps the mirror lag entirely.
 */
const ORIENT_SETTLE_MS = 1_000;

/** `proc:localgroup:3`'s positionMpc from `generateLocalGroup({ seed: 1 })` — logged by
 *  `packages/nav/test/local-group.test.ts`, not re-derived here (CLAUDE.md rule 1). */
const GALAXY_3_POSITION_MPC: [number, number, number] = [
  -0.7696923437412311, 0.724360694793291, 0.23944436975468775,
];
const GALAXY_3_ID = 'proc:localgroup:3';
const GALAXY_3_NAME = 'Galaxy G-3';

interface LocalGroupHook {
  ready: boolean;
  contextId: string;
  goToActive: boolean;
  cameraPosition: { context: string; local: [number, number, number] };
  errorCounts: { total: number };
  pickAt(clientX: number, clientY: number): string | null;
  projectToScreen(local: readonly [number, number, number]): { x: number; y: number } | null;
}

async function snapshot(page: Page): Promise<string> {
  return JSON.stringify(
    await page.evaluate(() => {
      const c = window.__cosmos as unknown as LocalGroupHook | undefined;
      return {
        contextId: c?.contextId,
        cameraPosition: c?.cameraPosition,
        goToActive: c?.goToActive,
        errorCounts: c?.errorCounts,
      };
    }),
  );
}

test.describe('TASK-086 (G4) — local-group galaxy select → breadcrumb name', () => {
  test('clicking a galaxy in universe context shows "Galaxy G-<n>" in the breadcrumb', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForSelector('canvas');
    await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
      timeout: 30_000,
    });

    const universe = page.getByRole('button', { name: /Universe/i });
    await expect(universe).toBeEnabled({ timeout: 30_000 });
    await universe.click();

    try {
      await page.waitForFunction(
        () => {
          const c = window.__cosmos as unknown as LocalGroupHook | undefined;
          if (!c || c.contextId !== 'universe' || c.goToActive) return false;
          const l = c.cameraPosition.local;
          return Math.hypot(l[0]!, l[1]!, l[2]!) > 0.175;
        },
        undefined,
        { timeout: POLL_TIMEOUT_MS },
      );
    } catch (e) {
      console.log(`universe-local-group-select: never settled at the vantage; ${await snapshot(page)}`);
      throw e;
    }

    // The galaxy may be behind the camera / off-screen at the boot orientation — orient
    // toward it first via the app's own reorientation hook (do NOT re-derive the
    // projection in test code, per the spec's own instruction).
    let projected = await page.evaluate(
      (target) => (window.__cosmos as unknown as LocalGroupHook).projectToScreen(target),
      GALAXY_3_POSITION_MPC,
    );
    if (projected === null) {
      await page.evaluate((target) => window.__cosmosDev?.orientTo(target), GALAXY_3_POSITION_MPC);
      // Fixed settle wait, not a goToActive poll (see ORIENT_SETTLE_MS comment) — the
      // slew runs over its own durationMs (600ms); wait it out plus margin before
      // reading the FINAL pixel to click.
      await page.waitForTimeout(ORIENT_SETTLE_MS);
      projected = await page.evaluate(
        (target) => (window.__cosmos as unknown as LocalGroupHook).projectToScreen(target),
        GALAXY_3_POSITION_MPC,
      );
    }
    expect(
      projected,
      `projectToScreen(galaxy 3) is null even after orientTo; ${await snapshot(page)}`,
    ).not.toBeNull();
    const { x, y } = projected!;
    console.log(`universe-local-group-select: projected galaxy 3 to (${x}, ${y})`);

    // Query the production pick path at that pixel (no selection side-effect) before
    // dispatching a real click, so a failure is triagable ("wrong pixel" vs "click
    // didn't register").
    const picked = await page.evaluate(
      ([px, py]) => (window.__cosmos as unknown as LocalGroupHook).pickAt(px, py),
      [x, y],
    );
    console.log(`universe-local-group-select: pickAt(${x}, ${y}) = ${picked}`);
    expect(picked, `pickAt(${x}, ${y}) returned ${picked}, expected ${GALAXY_3_ID}`).toBe(
      GALAXY_3_ID,
    );

    // Real click — same pixel, dispatched through the DOM (pointerdown/up), not pickAt.
    await page.mouse.click(x, y);

    const nav = page.getByRole('navigation', { name: 'Location' });
    await expect(nav.getByText(GALAXY_3_NAME), `breadcrumb never showed "${GALAXY_3_NAME}"`).toBeVisible(
      { timeout: POLL_TIMEOUT_MS },
    );

    const errors = await page.evaluate(
      () => (window.__cosmos as unknown as LocalGroupHook | undefined)?.errorCounts,
    );
    expect(errors?.total, `errorCounts=${JSON.stringify(errors)}`).toBe(0);
  });
});
