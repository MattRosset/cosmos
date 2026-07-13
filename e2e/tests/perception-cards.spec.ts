import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-068 — insight cards + visual identity acceptance: the star card
 * (C1/C2/C3/C6), the planet card (C4/C5), and the unified View drawer (V3)
 * with the `__cosmos.overlays`/`__cosmos.exposure` mirrors. State is read from
 * `window.__cosmos` (≤ 4 Hz mirror, base shape declared in m1.spec.ts; the
 * TASK-068 fields via the local cast below) and role/CSS locators — never
 * re-derived astronomy or pixels. Chromium-only, like the other gates.
 *
 * Copy literals mirror `packages/ui/src/strings.ts` (the user-facing
 * contract); the e2e project intentionally does not depend on the browser
 * `@cosmos/ui` bundle, so they are duplicated here with this note.
 */

// packages/ui/src/strings.ts → STRINGS.badgeNoSystem / badgePlanetSingular/Plural
const BADGE_RE = /^(\d+ known planets?|No known planetary system)$/;
// packages/ui/src/strings.ts → STRINGS.viewDrawerLabel
const VIEW_DRAWER = 'View settings';
// packages/ui/src/astro-derive.ts → STRINGS.sizeBarAriaPrefix + sizeVsEarthSuffix
const SIZE_BAR_RE = /^Size: [\d.]+(e[+-]?\d+)?× Earth$/;
// packages/ui/src/strings.ts → STRINGS.orbitDayYearSuffix / orbitYearOrbitSuffix
const ORBIT_RE = /(-day year|-year orbit)/;

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

test.describe('star card (C1/C2/C3/C6)', () => {
  test('Sirius: class line, visibility, hero ly before pc, badge, collapsed details', async ({
    page,
  }) => {
    await page.goto('/');
    await waitReady(page);

    // Sirius: a bright, named HYG star with no system pack (star card, "No
    // known planetary system" badge variant expected — but the gate accepts
    // either variant so a future exo-host pick stays valid).
    await searchAndGo(page, 'sirius', 'Sirius');
    await expect(page.locator('.cosmos-ui-info-name')).toHaveText('Sirius');

    const classLine = (await page.locator('.cosmos-ui-info-class').textContent()) ?? '';
    const visibility = (await page.locator('.cosmos-ui-info-visibility').textContent()) ?? '';
    const badge = (await page.locator('.cosmos-ui-info-badge').textContent()) ?? '';
    const panel = (await page.locator('.cosmos-ui-info').textContent()) ?? '';
    // CI-triagable (conventions §6): the chosen star + every rendered insight line.
    console.log(
      `[perception-cards] star=${await page.evaluate(() => window.__cosmos?.selectedId)} ` +
        `class="${classLine.trim()}" visibility="${visibility.trim()}" badge="${badge.trim()}"`,
    );

    // C1: a plain-language class line that references the Sun comparison.
    expect(classLine).toContain('Sun');
    // C2: a visibility verdict exists (Sirius is naked-eye bright).
    expect(visibility.length).toBeGreaterThan(0);
    // C3: the system badge shows one of the two honest variants.
    expect(badge.trim()).toMatch(BADGE_RE);
    // C6: hero ly metric precedes the demoted pc detail; never NaN filler.
    expect(panel.indexOf('ly')).toBeLessThan(panel.lastIndexOf('pc'));
    expect(panel).not.toContain('NaN');
    expect(panel).not.toContain('undefined');
    // C6: the expert details row exists and is collapsed by default.
    const details = page.locator('.cosmos-ui-info-details');
    await expect(details).toHaveCount(1);
    await expect(details).toHaveJSProperty('open', false);
  });
});

test.describe('planet card (C4/C5)', () => {
  test('Saturn: size bar with Earth-ratio label + human-terms orbit line', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);

    // Selecting via search sets the selection immediately (the fly-to runs in
    // parallel); the card is a pure function of the selected record.
    await searchAndGo(page, 'saturn', 'Saturn');
    await expect(page.locator('.cosmos-ui-info-name')).toHaveText('Saturn');

    const sizeBar = page.locator('.cosmos-ui-info-sizebar');
    await expect(sizeBar).toHaveCount(1);
    const ariaLabel = (await sizeBar.getAttribute('aria-label')) ?? '';
    const orbit = (await page.locator('.cosmos-ui-info-orbit').textContent()) ?? '';
    console.log(
      `[perception-cards] planet=${await page.evaluate(() => window.__cosmos?.selectedId)} ` +
        `sizebar="${ariaLabel}" orbit="${orbit.trim()}"`,
    );

    // C4: the bar's accessible label carries the Earth ratio.
    expect(ariaLabel).toMatch(SIZE_BAR_RE);
    // C5: the orbit reads in human terms (Saturn: a ~29-year orbit).
    expect(orbit).toMatch(ORBIT_RE);

    const panel = (await page.locator('.cosmos-ui-info').textContent()) ?? '';
    expect(panel).not.toContain('NaN');
    expect(panel).not.toContain('undefined');
  });
});

test.describe('View drawer (V3) + exposure mirror', () => {
  test('drawer consolidates overlays/exposure/auto-hide; scattered mounts gone', async ({
    page,
  }) => {
    await page.goto('/');
    await waitReady(page);

    // The superseded scattered mounts are gone: the old top-right overlay
    // block and the dock's exposure slider.
    await expect(page.locator('.cosmos-ui-overlays')).toHaveCount(0);
    await expect(page.locator('.cosmos-ui-dock .cosmos-ui-exposure')).toHaveCount(0);

    // Open the drawer via its role locator.
    await page.getByRole('button', { name: VIEW_DRAWER }).click();
    await expect(page.getByRole('group', { name: VIEW_DRAWER })).toBeVisible();
    // Auto-hide preference lives here too (V2 surface).
    await expect(page.getByRole('button', { name: 'Auto-hide controls' })).toBeVisible();

    // Overlay toggle → the store mirror reflects it (≤ 4 Hz).
    const constBefore = await page.evaluate(() => {
      return (window.__cosmos as unknown as { overlays: { constellations: boolean } }).overlays
        .constellations;
    });
    await page.getByRole('button', { name: 'Constellations' }).click();
    await page.waitForFunction(
      (prev) =>
        (window.__cosmos as unknown as { overlays: { constellations: boolean } }).overlays
          .constellations === !prev,
      constBefore,
      { timeout: 5_000 },
    );
    const constAfter = !constBefore;

    // Exposure slider → the TASK-068 `__cosmos.exposure` mirror moves.
    const expBefore = await page.evaluate(
      () => (window.__cosmos as unknown as { exposure: number }).exposure,
    );
    const slider = page.getByRole('slider', { name: 'Star-field brightness (exposure)' });
    await slider.focus();
    // 50 log-scale steps — a clearly non-zero exposure change.
    for (let i = 0; i < 50; i++) await slider.press('ArrowRight');
    await page.waitForFunction(
      (prev) => {
        const e = (window.__cosmos as unknown as { exposure: number }).exposure;
        return Number.isFinite(e) && e !== prev;
      },
      expBefore,
      { timeout: 5_000 },
    );
    const expAfter = await page.evaluate(
      () => (window.__cosmos as unknown as { exposure: number }).exposure,
    );
    // CI-triagable (conventions §6): which controls were driven + observed values.
    console.log(
      `[perception-cards] drawer: constellations ${constBefore}→${constAfter} ` +
        `exposure ${expBefore}→${expAfter}`,
    );
    expect(expAfter).not.toBe(expBefore);
  });
});

test.describe('reference-machine visuals', () => {
  // Deterministic proxies gate above; the typography/tint look is
  // reference-machine only (conventions §4 — never CI-blocking).
  test.skip(!!process.env['CI'], 'screenshots are reference-machine only');

  test('star card visual identity', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await searchAndGo(page, 'sirius', 'Sirius');
    await expect(page.locator('.cosmos-ui-info-name')).toHaveText('Sirius');
    await expect(page.locator('.cosmos-ui-info')).toHaveScreenshot('star-card-identity.png', {
      mask: [page.locator('canvas')],
    });
  });
});
