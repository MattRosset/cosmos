import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-070 — search a Gaia DR3 star by source_id and fly to it. Deterministic (no pixels,
 * no wall-clock, no streamed-tile timing): the reverse lookup fetches the committed sample
 * index + tile on demand, and the fly target is captured synchronously by the coordinator's
 * `flyTo` (`__cosmos.flightTarget`). This is also the guard against the "flew via
 * onGoTo(bodyId) = silent no-op" trap — we assert the camera target actually MOVED to the
 * resolved star position, not merely that select fired.
 *
 * The known input/output come from the committed 135-star sample pack
 * (apps/web/public/packs/octree-gaia-sample): source_id 4000000000000000137 is catalogId 0,
 * at galactic-pc [-8.8259, 18.2478, 21.2278]. (Cross-checked by the pack-tool reverse-lookup
 * unit test against the freshly-built pack.)
 */

const SAMPLE_SOURCE_ID = '4000000000000000137';
const EXPECTED_POS: readonly [number, number, number] = [
  -8.825887680053711, 18.247846603393555, 21.227828979492188,
];
const TOL_PC = 0.01;

interface FlightHook {
  ready: boolean;
  flightTarget: { context: string; local: [number, number, number] } | null;
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, { timeout: 30_000 });
}

test('search a Gaia source_id → the palette flies the camera to the star position', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/');
  await waitReady(page);

  await page.keyboard.press('Control+k');
  const input = page.locator('.cosmos-ui-palette input');
  await input.fill(SAMPLE_SOURCE_ID);

  // A single "Gaia DR3 <id>" hit row (role locator + text — no coordinate clicks).
  const hit = page.getByRole('option', { name: `Gaia DR3 ${SAMPLE_SOURCE_ID}` });
  await expect(hit).toBeVisible({ timeout: 15_000 });
  await hit.click();

  // The fly target must be the resolved star position (galaxy context), proving a real move.
  await page.waitForFunction(
    () => {
      const c = window.__cosmos as unknown as FlightHook;
      return c.flightTarget !== null && c.flightTarget.context === 'galaxy';
    },
    undefined,
    { timeout: 15_000 },
  );
  const target = await page.evaluate(() => (window.__cosmos as unknown as FlightHook).flightTarget);
  expect(target).not.toBeNull();
  console.log(`gaia-search flightTarget: ${JSON.stringify(target)} expected ${JSON.stringify(EXPECTED_POS)}`);
  expect(target!.context).toBe('galaxy');
  expect(Math.abs(target!.local[0] - EXPECTED_POS[0])).toBeLessThan(TOL_PC);
  expect(Math.abs(target!.local[1] - EXPECTED_POS[1])).toBeLessThan(TOL_PC);
  expect(Math.abs(target!.local[2] - EXPECTED_POS[2])).toBeLessThan(TOL_PC);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('garbage numeric input shows the empty state with no errors and no fly', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/');
  await waitReady(page);

  const before = await page.evaluate(
    () => (window.__cosmos as unknown as FlightHook).flightTarget,
  );

  await page.keyboard.press('Control+k');
  const input = page.locator('.cosmos-ui-palette input');
  await input.fill('99999999999'); // valid id shape, absent from the catalog → a miss

  await expect(page.locator('.cosmos-ui-palette-no-matches')).toBeVisible({ timeout: 15_000 });

  // No fly was issued (target unchanged from before opening the palette).
  const after = await page.evaluate(() => (window.__cosmos as unknown as FlightHook).flightTarget);
  expect(after).toEqual(before);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
