import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-080 — the galaxy→universe ascent is reachable by a user.
 *
 * Before this task the exit was gated on `ownGalaxyContext`, a controller flag the
 * production app never set (it boots in `galaxy`), so `universe` was unreachable while
 * the HUD's scale ruler already advertised it. This spec is the deterministic gate for
 * both halves: the lifted gate and the `◂ Universe` breadcrumb affordance.
 *
 * Deterministic only — no screenshots, no wall-clock frame assertions, no `@perf` tag.
 * State is read from `window.__cosmos` (the ≤ 4 Hz mirror) and role locators; nothing
 * here re-derives camera math (CLAUDE.md testing rules 1–4).
 */

/** CI is SwiftShader and slow; every poll gets an explicit generous timeout. A CI-only
 *  flake in this repo was fixed by adding one, never by loosening an assertion
 *  (`a2f307a`). */
const POLL_TIMEOUT_MS = 45_000;

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 30_000,
  });
}

/** Snapshot of everything needed to triage a CI-only failure from logs alone (rule 6). */
async function snapshot(page: Page): Promise<string> {
  return JSON.stringify(
    await page.evaluate(() => ({
      contextId: window.__cosmos?.contextId,
      cameraPosition: window.__cosmos?.cameraPosition,
      goToActive: window.__cosmos?.goToActive,
      errorCounts: window.__cosmos?.errorCounts,
    })),
  );
}

async function waitForContext(page: Page, want: string): Promise<void> {
  try {
    await page.waitForFunction(
      (ctx) => window.__cosmos?.contextId === ctx,
      want,
      { timeout: POLL_TIMEOUT_MS },
    );
  } catch (e) {
    console.log(`universe-ascent: never reached contextId=${want}; observed ${await snapshot(page)}`);
    throw e;
  }
}

test.describe('TASK-080 — universe ascent', () => {
  test('the breadcrumb flies galaxy→universe and back', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas');
    await waitReady(page);

    // Boot state: the app starts in the galaxy star field near Sol.
    expect(await page.evaluate(() => window.__cosmos?.contextId)).toBe('galaxy');

    // The segment is gated on galaxyNavReady, so it BOOTS DISABLED — wait for it
    // explicitly rather than leaning on Playwright's implicit actionability timeout,
    // which is the CI-SwiftShader flake this repo already paid for.
    // Precedent: perception-literacy.spec.ts:82-83.
    const universe = page.getByRole('button', { name: /Universe/i });
    await expect(universe).toBeEnabled({ timeout: 30_000 });
    await universe.click();

    await waitForContext(page, 'universe');

    const cam = await page.evaluate(() => window.__cosmos!.cameraPosition);
    expect(cam.context).toBe('universe');
    const dMpc = Math.hypot(cam.local[0]!, cam.local[1]!, cam.local[2]!);
    // Past the 0.1 Mpc exitGalaxyAtM gate — the vantage is 0.18 Mpc by construction.
    expect(dMpc, `arrived at ${dMpc} Mpc; ${await snapshot(page)}`).toBeGreaterThan(0.1);

    // Return leg is ◂ Galaxy, NOT ◂ Milky Way: viewGalaxy's vantage is a RADIUS around
    // its target, so approached from universe it lands at 61,000 pc — outside
    // enterGalaxyAtM (1.543e21 m), in the dead band, and never switches.
    await page.getByRole('button', { name: /Galaxy/ }).click();
    await waitForContext(page, 'galaxy');

    // No invariant/error reports fired during the round trip.
    const errors = await page.evaluate(() => window.__cosmos?.errorCounts);
    expect(errors?.total, `errorCounts=${JSON.stringify(errors)}`).toBe(0);
  });
});
