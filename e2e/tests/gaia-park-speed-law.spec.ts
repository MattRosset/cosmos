/**
 * TASK-091 — the galaxy free-flight speed law at a far Gaia park.
 *
 * After parking ~2835 pc from Sol (far outside the HYG point cloud), the speed law must
 * receive a CRUISING distance, not the ~0 that the old `streaming.nearestBodyDistanceM`
 * tile-AABB feed produced inside a covered Gaia tile (the WASD "wall" — see
 * docs/research/gaia-park-navigation-open.md §1).
 *
 * Determinism: reads a scalar + an error count, never frame times (CLAUDE.md §CI gates).
 *
 * Teeth caveat (recorded in TASK-091-NOTES.md): the `distanceToNearestSurfacePc > 100`
 * assertion is red-green ONLY on the dense `octree-gaia` pack (where a chunk covers
 * [2835,0,0] and pre-fix fed ~0). CI serves the 135-star sample with NO Gaia coverage
 * there, so pre-fix HEAD already fell through to `distToField` (~1120) and PASSED — i.e.
 * on CI this is a REGRESSION guard, not red-green teeth. The environment-independent
 * teeth live in the unit tests (hyg-field.test.ts / nav-speed-law.test.ts). The
 * `errorCounts.total === 0` assertion, once TASK-090's tripwire exists, fails if a future
 * regression re-detonates the HYG void walk at this park.
 */
import { test, expect, type Page } from '@playwright/test';

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 60_000,
  });
}

test('galaxy speed law feeds a cruising distance at a far Gaia park (not the ~0 wall)', async ({
  page,
}) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
  await waitReady(page);
  await page.waitForTimeout(1000); // let the field settle

  // Park far in the galaxy field, away from Sol, via the test-hook command.
  await page.evaluate(() => window.__cosmos!.goToPosition([2835, 0, 0]));
  await page.waitForFunction(() => window.__cosmos?.goToActive === false, undefined, {
    timeout: 30_000,
  });
  await page.waitForTimeout(500); // settle a few frames so the galaxy feed runs at rest

  const result = await page.evaluate(() => ({
    context: window.__cosmos!.contextId,
    distFromSolPc: Math.hypot(...window.__cosmos!.cameraPosition.local),
    distanceToNearestSurfacePc: window.__cosmos!.distanceToNearestSurfacePc,
    errorsTotal: window.__cosmos!.errorCounts.total,
  }));

  // Triage-from-logs (CLAUDE.md §6): log the chosen input + measured quantities.
  console.log(
    `[gaia-park-speed-law] context=${result.context} distFromSol=${result.distFromSolPc.toFixed(0)}pc ` +
      `surfaceFeed=${result.distanceToNearestSurfacePc.toFixed(1)}pc errors=${result.errorsTotal}`,
  );

  // We flew to a galaxy-frame position; a park that deep is outside any system.
  expect(result.context).toBe('galaxy');
  // The speed law received a cruising distance — WASD-unstuck (the fix). On the dense
  // pack this is red-green; on the sample pack it is a regression guard (see header).
  expect(result.distanceToNearestSurfacePc).toBeGreaterThan(100);
  // No sustained nav-feed breach detonated at the park (rides TASK-090's tripwire).
  expect(result.errorsTotal).toBe(0);
});
