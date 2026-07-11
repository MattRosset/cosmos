import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-066 — perception literacy acceptance: the movement-mode badge (S2), the
 * human-first InfoPanel copy (D1 + W4 `@ c` ETA), and the first-run three-mode
 * teaching overlay (V1). State is read from `window.__cosmos` (the ≤ 4 Hz mirror,
 * shape declared in m1.spec.ts) and role/CSS locators — never re-derived timing.
 * Chromium-only, like the other gates.
 *
 * Copy literals below mirror `packages/ui/src/strings.ts` (the user-facing contract).
 * The e2e project intentionally does not depend on the browser `@cosmos/ui` bundle,
 * so the strings are duplicated here with this note; a copy change updates both.
 */

// packages/ui/src/strings.ts → STRINGS.modeScaleJump
const SCALE_JUMP_LABEL = 'Scale jump';
// packages/ui/src/strings.ts → STRINGS.lightTravelPrefix
const LIGHT_TRAVEL_PREFIX = 'light takes';
// packages/ui/src/strings.ts → STRINGS.galacticDescendHint (D8)
const GALACTIC_HINT = 'Barely moving? Use ◂ Galaxy to descend to a star.';
// packages/ui/src/strings.ts → STRINGS.firstRunTitle / dismiss / reopen labels
const FIRST_RUN_TITLE_RE = /Three ways to move/i;
const FIRST_RUN_DISMISS = 'Start exploring';
const FIRST_RUN_REOPEN = 'Movement guide';

const SOL_SYSTEM = 'sol';

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

test.describe('movement-mode badge (S2) + galactic hint (D8)', () => {
  test('sub-threshold fly unlabeled; viewGalaxy shows "Scale jump" then the descend hint', async ({
    page,
  }) => {
    await page.goto('/');
    await waitReady(page);
    expect(await page.evaluate(() => window.__cosmos?.contextId)).toBe('galaxy');
    // D8 gate: near Sol (0.06 pc from the origin) the galactic descend hint is absent —
    // it is scale-gated, not always-on.
    await expect(page.locator('.hud-galactic-hint')).toHaveCount(0);

    // ── Short fly: descend into Sol (boot camera sits 0.06 pc from Sol, far below
    // the 100 pc scale-jump threshold). While that goTo runs, the badge must NOT
    // claim a scale jump — a sub-threshold flight is plain exploration.
    await searchAndGo(page, 'saturn', 'Saturn');
    await page.waitForFunction(() => window.__cosmos?.goToActive === true, undefined, {
      timeout: 5_000,
    });
    // The invariant is only that a sub-threshold hop never shows a "Scale jump"
    // badge. During the goTo the badge is ABSENT (null label), and `not.toHaveText`
    // errors on a missing element rather than passing — so assert on a text-filtered
    // locator instead: zero scale-jump badges exist, whether the badge is absent or
    // reads "Exploring".
    await expect(
      page.locator('.hud-mode-badge', { hasText: SCALE_JUMP_LABEL }),
    ).toHaveCount(0);

    // Let the (two-leg) descent settle inside the Sol system.
    await page.waitForFunction(
      (id) => window.__cosmos?.contextId === 'system' && window.__cosmos?.anchorSystemId === id,
      SOL_SYSTEM,
      { timeout: 45_000 },
    );
    await page.waitForFunction(() => window.__cosmos?.goToActive === false, undefined, {
      timeout: 45_000,
    });

    // ── Scale jump: the breadcrumb "Milky Way" leaps ~49 kpc to the whole-galaxy
    // vantage — far above the threshold — so the badge reads the scale-jump label
    // for the duration of the flight, then clears once it settles.
    const milkyWay = page.getByRole('button', { name: /Milky Way/ });
    await expect(milkyWay).toBeEnabled({ timeout: 30_000 });
    await milkyWay.click();
    await page.waitForFunction(() => window.__cosmos?.goToActive === true, undefined, {
      timeout: 5_000,
    });
    // CI-triagable (conventions §6): record what the badge actually reads mid-jump.
    const badgeAtJump = await page.locator('.hud-mode-badge').textContent();
    console.log(
      `[perception] mode badge during viewGalaxy jump = "${badgeAtJump}" ` +
        `(context=${await page.evaluate(() => window.__cosmos?.contextId)})`,
    );
    await expect(page.locator('.hud-mode-badge')).toHaveText(SCALE_JUMP_LABEL);

    await page.waitForFunction(() => window.__cosmos?.goToActive === false, undefined, {
      timeout: 30_000,
    });
    await expect(page.locator('.hud-mode-badge')).toHaveCount(0);

    // D8 gate: settled at the whole-galaxy vantage (~49 kpc, galaxy context), the
    // descend hint now renders. `toHaveText` reads the DOM regardless of the idle
    // chrome fade (opacity), so it is independent of auto-hide timing.
    expect(await page.evaluate(() => window.__cosmos?.contextId)).toBe('galaxy');
    await expect(page.locator('.hud-galactic-hint')).toHaveText(GALACTIC_HINT);
  });
});

test.describe('InfoPanel human-first distance (D1 + W4)', () => {
  test('leads with ly + light-travel, shows an @ c ETA, demotes pc', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);

    // Sirius: a bright, named HYG star with no system pack (stays a star card).
    await searchAndGo(page, 'sirius', 'Sirius');
    await expect(page.locator('.cosmos-ui-info-name')).toHaveText('Sirius');

    const distance = (await page.locator('.cosmos-ui-info-distance').textContent()) ?? '';
    const eta = (await page.locator('.cosmos-ui-info-eta').textContent()) ?? '';
    const panel = (await page.locator('.cosmos-ui-info').textContent()) ?? '';
    // CI-triagable (conventions §6): log the star + the exact rendered copy.
    console.log(
      `[perception] star=${await page.evaluate(() => window.__cosmos?.selectedId)} ` +
        `distance="${distance.trim()}" eta="${eta.trim()}"`,
    );

    // Primary line: light-years + light-travel phrase, and NO parsecs (pc is demoted).
    expect(distance).toContain('ly');
    expect(distance).toContain(LIGHT_TRAVEL_PREFIX);
    expect(distance).not.toContain('pc');

    // The @ c ETA line exists.
    expect(eta).toContain('at c');

    // Order invariant: the human line (ly) precedes the demoted pc detail in the panel.
    expect(panel).toContain('pc'); // pc still available, just not primary
    expect(panel.indexOf('ly')).toBeLessThan(panel.lastIndexOf('pc'));
  });
});

test.describe('first-run overlay (V1)', () => {
  // Opt out of the seeded "seen" flag: a genuinely fresh context so the overlay opens.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('teaches the three modes once, persists dismissal, ? restores it', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);

    const overlay = page.getByRole('dialog', { name: FIRST_RUN_TITLE_RE });
    await expect(overlay).toBeVisible();
    // The whole thesis (research §5.1): all three movement modes are named.
    await expect(overlay).toContainText('Scale jump');
    await expect(overlay).toContainText('Free flight');
    await expect(overlay).toContainText('Guided tour');

    // Production HUD no longer carries the build-stats line (dev-flag only now).
    await expect(page.locator('.hud-panel--info')).not.toContainText('M4a');

    // Dismiss → overlay gone, flag persisted.
    await page.getByRole('button', { name: FIRST_RUN_DISMISS }).click();
    await expect(overlay).toHaveCount(0);

    // Reload (same context keeps the persisted flag) → it does not reappear.
    await page.reload();
    await waitReady(page);
    await expect(page.getByRole('dialog', { name: FIRST_RUN_TITLE_RE })).toHaveCount(0);

    // The dock `?` restores it on demand.
    await page.getByRole('button', { name: FIRST_RUN_REOPEN }).click();
    await expect(page.getByRole('dialog', { name: FIRST_RUN_TITLE_RE })).toBeVisible();
  });
});
