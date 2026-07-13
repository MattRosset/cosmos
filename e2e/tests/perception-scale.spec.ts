import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-067 — perception v2 acceptance: the unified Jump HUD (W2) with repetition
 * dampening (W2a), the jump letterbox (D4, class-toggle assertions only), and the
 * persistent scale ruler (D3). State is read from `window.__cosmos` (shape declared
 * in m1.spec.ts) and role/CSS locators — never re-derived timing or pixels.
 * Chromium-only, like the other gates.
 *
 * Constants below mirror `packages/ui/src/scale-ruler.ts` + `strings.ts` and
 * `packages/core-types/src/coords.ts` (the e2e project intentionally does not
 * depend on the workspace bundles); a change there updates both.
 */

// packages/ui/src/scale-ruler.ts → GALACTIC_SURVEY_MIN_PC (pinned 2,000 pc)
const GALACTIC_SURVEY_MIN_PC = 2_000;
// packages/core-types/src/coords.ts → CONTEXT_UNIT_METERS
const CONTEXT_UNIT_METERS: Record<string, number> = {
  universe: 3.0857e22,
  galaxy: 3.0857e16,
  system: 1.495978707e11,
  planet: 1e3,
};
// packages/ui/src/jump-hud-model.ts → JUMP_COUNT_KEY / LETTERBOX_SHOWN_KEY
const JUMP_COUNT_KEY = 'cosmos.jumps.large.count';
const LETTERBOX_SHOWN_KEY = 'cosmos.jumps.letterboxShown';

const SOL_SYSTEM = 'sol';

/**
 * Duplicate of the pure D3 mapping (packages/ui/src/scale-ruler.ts,
 * `scaleRulerSegment`) — the sanctioned cross-check: production feeds
 * |cameraLocal| × CONTEXT_UNIT_METERS[contextId], and this test recomputes the
 * identical scalar from `__cosmos.cameraPosition` (a norm of a queried vector,
 * never a re-derivation of the motion law).
 */
function expectedSegment(contextId: string, cameraLocalDistanceM: number): string {
  if (contextId === 'planet') return 'planet';
  if (contextId === 'system') return 'system';
  if (contextId === 'universe') return 'universe';
  return cameraLocalDistanceM >= GALACTIC_SURVEY_MIN_PC * CONTEXT_UNIT_METERS['galaxy']!
    ? 'galactic-survey'
    : 'starfield';
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 30_000,
  });
}

/** Clear the W2a dampening counters so a spec starts from "never jumped". */
async function clearJumpCounters(page: Page): Promise<void> {
  await page.evaluate(
    ([countKey, letterboxKey]) => {
      window.localStorage.removeItem(countKey!);
      window.localStorage.removeItem(letterboxKey!);
    },
    [JUMP_COUNT_KEY, LETTERBOX_SHOWN_KEY],
  );
}

/** Click a breadcrumb jump button and wait for the goTo to become active. */
async function startJump(page: Page, buttonName: RegExp): Promise<void> {
  const btn = page.getByRole('button', { name: buttonName });
  await expect(btn).toBeEnabled({ timeout: 30_000 });
  await btn.click();
  await page.waitForFunction(() => window.__cosmos?.goToActive === true, undefined, {
    timeout: 5_000,
  });
}

async function waitJumpEnd(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.goToActive === false, undefined, {
    timeout: 30_000,
  });
}

const MILKY_WAY = /Milky Way/;
const DESCEND_GALAXY = /^◂ Galaxy$/;

test.describe('unified Jump HUD lifecycle (W2 + D4)', () => {
  test('viewGalaxy: live ly + @ c while jumping, letterbox class, arrival card', async ({
    page,
  }) => {
    await page.goto('/');
    await waitReady(page);
    await clearJumpCounters(page);

    const startCam = await page.evaluate(() => window.__cosmos!.cameraPosition);
    await startJump(page, MILKY_WAY);

    // While jumping: distance remaining in ly + the @ c equivalent.
    const jumping = page.locator('.cosmos-ui-jump--jumping');
    await expect(jumping).toBeVisible();
    await expect(jumping).toContainText('ly remaining');
    await expect(jumping).toContainText('at c');
    const jumpingText = (await jumping.textContent()) ?? '';

    // D4 letterbox: class-toggle assertion, NOT a pixel diff.
    await expect(page.locator('.hud-letterbox')).toHaveClass(/hud-letterbox--active/);

    await waitJumpEnd(page);

    // Arrival: the same component morphs into the summary card — ly + years-order @ c.
    const arrived = page.locator('.cosmos-ui-jump--arrived');
    await expect(arrived).toBeVisible();
    await expect(arrived).toContainText('ly');
    await expect(arrived).toContainText('at c');
    await expect(arrived).toContainText('years');
    const arrivedText = (await arrived.textContent()) ?? '';
    const endCam = await page.evaluate(() => window.__cosmos!.cameraPosition);

    // Letterbox retracts once the jump ends.
    await expect(page.locator('.hud-letterbox')).not.toHaveClass(/hud-letterbox--active/);

    // CI-triagable (conventions §6): the chosen jump + what the HUD displayed.
    console.log(
      `[perception-scale] start=${JSON.stringify(startCam)} end=${JSON.stringify(endCam)} ` +
        `jumping="${jumpingText.trim()}" arrived="${arrivedText.trim()}"`,
    );
  });
});

test.describe('repetition dampening (W2a)', () => {
  test('letterbox first jump only; arrival card one-line from jump 4 on', async ({ page }) => {
    test.setTimeout(150_000); // four full ~5 s breadcrumb flights + settles
    await page.goto('/');
    await waitReady(page);
    await clearJumpCounters(page);

    // Milky Way ⇄ star field bounces: every leg is a ~49 kpc scale jump.
    const legs = [MILKY_WAY, DESCEND_GALAXY, MILKY_WAY, DESCEND_GALAXY];
    for (let jump = 1; jump <= legs.length; jump++) {
      await startJump(page, legs[jump - 1]!);
      await expect(page.locator('.cosmos-ui-jump--jumping')).toBeVisible();
      // Letterbox: first large jump only (storage-driven, deterministic).
      if (jump === 1) {
        await expect(page.locator('.hud-letterbox')).toHaveClass(/hud-letterbox--active/);
      } else {
        await expect(page.locator('.hud-letterbox')).not.toHaveClass(/hud-letterbox--active/);
      }
      await waitJumpEnd(page);
      const arrived = page.locator('.cosmos-ui-jump--arrived');
      await expect(arrived).toBeVisible();
      // Full card for the first 3 large jumps, the one-line variant from jump 4 on.
      const variant = jump <= 3 ? /cosmos-ui-jump--full/ : /cosmos-ui-jump--brief/;
      await expect(arrived).toHaveClass(variant);
      console.log(
        `[perception-scale] dampening jump=${jump} card="${((await arrived.textContent()) ?? '').trim()}" ` +
          `count=${await page.evaluate((k) => window.localStorage.getItem(k), JUMP_COUNT_KEY)}`,
      );
    }
  });
});

test.describe('scale-jump threshold gate', () => {
  test('a short in-system fly never mounts the Jump HUD or letterbox', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await waitReady(page);
    await clearJumpCounters(page);

    // Saturn descent: the boot camera sits 0.06 pc from Sol — far below the
    // 100 pc scale-jump threshold — then flies planet legs inside the system.
    await page.keyboard.press('Control+k');
    const input = page.locator('.cosmos-ui-palette input');
    await input.fill('saturn');
    await expect(page.locator('.cosmos-ui-palette-item').first()).toContainText('Saturn');
    await input.press('Enter');
    await page.waitForFunction(() => window.__cosmos?.goToActive === true, undefined, {
      timeout: 5_000,
    });

    await expect(page.locator('.cosmos-ui-jump')).toHaveCount(0);
    await expect(page.locator('.hud-letterbox')).not.toHaveClass(/hud-letterbox--active/);

    // Let the (two-leg) descent settle inside the Sol system — still nothing.
    await page.waitForFunction(
      (id) => window.__cosmos?.contextId === 'system' && window.__cosmos?.anchorSystemId === id,
      SOL_SYSTEM,
      { timeout: 45_000 },
    );
    await expect(page.locator('.cosmos-ui-jump')).toHaveCount(0);
    await expect(page.locator('.hud-letterbox')).not.toHaveClass(/hud-letterbox--active/);
  });
});

test.describe('scale ruler (D3)', () => {
  test('highlighted segment matches the pure mapping at both vantages', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    await waitReady(page);

    const active = page.locator('.cosmos-ui-ruler-seg--active');

    async function assertRulerMatchesState(vantage: string): Promise<void> {
      // The sanctioned scalar: |cameraLocal| × CONTEXT_UNIT_METERS[contextId] —
      // production's ScaleRulerHost feeds the identical number.
      const state = await page.evaluate(() => ({
        contextId: window.__cosmos!.contextId,
        local: window.__cosmos!.cameraPosition.local,
      }));
      const d =
        Math.hypot(state.local[0], state.local[1], state.local[2]) *
        CONTEXT_UNIT_METERS[state.contextId]!;
      const expected = expectedSegment(state.contextId, d);
      // DOM presence + segment identity only — no pixel positions.
      await expect(active).toHaveCount(1);
      await expect(active).toHaveAttribute('data-segment', expected);
      console.log(
        `[perception-scale] ruler @ ${vantage}: context=${state.contextId} d=${d.toExponential(3)} m ` +
          `→ segment=${expected}`,
      );
    }

    // Sol boot vantage (~0.06 pc from the galaxy-frame origin) → 'starfield'.
    await assertRulerMatchesState('Sol boot');

    // Post-viewGalaxy vantage (~49 kpc) → 'galactic-survey'.
    await startJump(page, MILKY_WAY);
    await waitJumpEnd(page);
    await assertRulerMatchesState('post-viewGalaxy');
  });
});

test.describe('reference-machine visuals', () => {
  // Deterministic proxies (class toggles, DOM identity) gate in CI above; the
  // actual look of the letterbox + Jump HUD is reference-machine only.
  test.skip(!!process.env['CI'], 'screenshots are reference-machine only');

  test('letterbox + jump HUD framing', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await clearJumpCounters(page);
    await startJump(page, MILKY_WAY);
    await expect(page.locator('.hud-letterbox')).toHaveClass(/hud-letterbox--active/);
    // Let the 600 ms bar transition finish before capturing.
    await page.waitForTimeout(800);
    await expect(page).toHaveScreenshot('jump-letterbox-hud.png', {
      // Mid-flight canvas + the ticking ly countdown are wall-clock dependent —
      // mask them; the framing chrome (bars, ruler, breadcrumb) is the subject.
      mask: [page.locator('canvas'), page.locator('.cosmos-ui-jump')],
    });
  });
});
