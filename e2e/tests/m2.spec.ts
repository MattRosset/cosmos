import { test, expect, type Page } from '@playwright/test';
import { injectFrameStats, readFrameStats, percentile } from './helpers/frame-stats';

/**
 * TASK-029 M2 integration flows: zoom from the star field into Sol, watch
 * planets orbit, search and fly to TRAPPIST-1, and round-trip a bookmark across
 * a reload. Chromium-only (see playwright.config.ts).
 *
 * Screenshot baselines (`m2-*.png`) must be recorded on CI / with CI's
 * SwiftShader flag — see e2e/README.md "Updating baselines".
 */

const SOL_SYSTEM = 'sol';
const TRAPPIST_SYSTEM = 'exo:trappist-1';
const SATURN_ID = 'sol:saturn';

// The `window.__cosmos` shape is declared once in m1.spec.ts (widened for M2).

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 30_000,
  });
}

async function searchAndGo(page: Page, query: string, resultText: string): Promise<void> {
  await page.keyboard.press('Control+k');
  const input = page.locator('.cosmos-ui-palette input');
  await input.fill(query);
  await expect(page.locator('.cosmos-ui-palette-item').first()).toContainText(resultText);
  await input.press('Enter');
}

/** Wait until the named system is the active context (anchor matches, context system). */
async function waitInSystem(page: Page, systemId: string, timeout: number): Promise<void> {
  await page.waitForFunction(
    (id) => window.__cosmos?.contextId === 'system' && window.__cosmos?.anchorSystemId === id,
    systemId,
    { timeout },
  );
}

/** Wait for the (possibly two-leg) flight chain to fully settle. */
async function waitFlightSettled(page: Page, timeout: number): Promise<void> {
  // Allow the second leg to be issued (≤ 100 ms poll) before sampling goToActive.
  await page.waitForTimeout(400);
  await page.waitForFunction(() => window.__cosmos?.goToActive === false, undefined, {
    timeout,
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('enter Sol: search Saturn → descend → rings baseline', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');
  await waitReady(page);

  // We boot in the galaxy star field.
  expect(await page.evaluate(() => window.__cosmos?.contextId)).toBe('galaxy');

  await searchAndGo(page, 'saturn', 'Saturn');
  await page.waitForFunction(() => window.__cosmos?.goToActive === true, undefined, {
    timeout: 3_000,
  });

  await waitInSystem(page, SOL_SYSTEM, 45_000);
  await waitFlightSettled(page, 45_000);
  expect(await page.evaluate(() => window.__cosmos?.selectedId)).toBe(SATURN_ID);

  // Saturn + rings + orbit line at rest — committed baseline.
  await page.waitForTimeout(800);
  await expect(page).toHaveScreenshot('m2-saturn.png');

  expect(pageErrors, 'no uncaught errors entering Sol').toHaveLength(0);
});

test('time: pause freezes the scene, 1e6× advances the epoch', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await searchAndGo(page, 'saturn', 'Saturn');
  await waitInSystem(page, SOL_SYSTEM, 45_000);
  await waitFlightSettled(page, 45_000);
  await page.waitForTimeout(500);

  // Pause → two frames 2 s apart are pixel-identical.
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(300);
  const a = await page.screenshot();
  await page.waitForTimeout(2_000);
  const b = await page.screenshot();
  expect(a.equals(b), 'paused frames must be identical').toBe(true);

  // Resume and wind time to +1e6× (⏩ six steps: 1→10→…→1e6).
  await page.getByRole('button', { name: 'Resume' }).click();
  const fwd = page.getByRole('button', { name: 'Forward faster' });
  for (let i = 0; i < 6; i++) await fwd.click();

  const epochBefore = await page.evaluate(() => window.__cosmos!.epochJD);
  const c = await page.screenshot();
  await page.waitForTimeout(3_000);
  const d = await page.screenshot();
  const epochAfter = await page.evaluate(() => window.__cosmos!.epochJD);

  // Frames 3 s apart must differ (planets moved).
  expect(c.equals(d), 'running-time frames must differ').toBe(false);

  // ~3 s × 1e6 ≈ 34.7 days; allow ±20 %.
  const advancedDays = epochAfter - epochBefore;
  expect(advancedDays).toBeGreaterThan(34.72 * 0.8);
  expect(advancedDays).toBeLessThan(34.72 * 1.2);
});

test('TRAPPIST-1: two-leg flight to a procedural planet', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);

  await searchAndGo(page, 'trappist-1 e', 'TRAPPIST-1 e');
  await waitInSystem(page, TRAPPIST_SYSTEM, 40_000);
  await waitFlightSettled(page, 40_000);

  expect(await page.evaluate(() => window.__cosmos?.anchorSystemId)).toBe(TRAPPIST_SYSTEM);

  // Info panel shows the planet record (radius, semi-major axis, period rows).
  await expect(page.locator('.cosmos-ui-info-name')).toHaveText('TRAPPIST-1 e');
  await expect(page.locator('.cosmos-ui-info')).toContainText('Radius');
  await expect(page.locator('.cosmos-ui-info')).toContainText('Semi-major axis');
  await expect(page.locator('.cosmos-ui-info')).toContainText('Period');
});

test('bookmark round-trip: capture at Saturn survives a reload', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await searchAndGo(page, 'saturn', 'Saturn');
  await waitInSystem(page, SOL_SYSTEM, 45_000);
  await waitFlightSettled(page, 45_000);
  await page.waitForTimeout(500);

  const captured = await page.evaluate(() => ({
    epochJD: window.__cosmos!.epochJD,
    local: window.__cosmos!.cameraPosition.local,
  }));

  // Capture "ringside".
  await page.getByRole('button', { name: 'Open bookmarks' }).click();
  await page.getByLabel('Bookmark name').fill('ringside');
  await page.getByRole('button', { name: 'Save view' }).click();

  await page.reload();
  await waitReady(page);

  // Panel lists the bookmark after the reload (persisted to localStorage).
  await page.getByRole('button', { name: 'Open bookmarks' }).click();
  await expect(page.getByText('ringside')).toBeVisible();

  // Fly to it — epoch + position restore within tolerance.
  await page.getByRole('button', { name: 'Fly to ringside' }).click();
  await page.waitForFunction(
    (target) => {
      const c = window.__cosmos;
      if (!c || c.contextId !== 'system' || c.goToActive) return false;
      const [x, y, z] = c.cameraPosition.local;
      const dx = x - target.local[0];
      const dy = y - target.local[1];
      const dz = z - target.local[2];
      const withinPos = Math.hypot(dx, dy, dz) < 1e-4; // AU
      const withinEpoch = Math.abs(c.epochJD - target.epochJD) < 1e-6;
      return withinPos && withinEpoch;
    },
    captured,
    { timeout: 25_000 },
  );
});

test('perf smoke: Sol approach stays under budget (CI-relaxed)', async ({ page }) => {
  await injectFrameStats(page);
  await page.goto('/');
  await waitReady(page);

  const before = (await readFrameStats(page)).samples.length;
  await searchAndGo(page, 'saturn', 'Saturn');
  await waitInSystem(page, SOL_SYSTEM, 45_000);
  await waitFlightSettled(page, 45_000);

  const stats = await readFrameStats(page);
  const flight = stats.samples.slice(before);
  expect(flight.length).toBeGreaterThan(0);
  expect(percentile(flight, 95), 'p95 frame < 50 ms').toBeLessThan(50);
  expect(Math.max(...flight), 'no frame > 250 ms').toBeLessThan(250);
});
