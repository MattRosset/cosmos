import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-086 (G3) — the local-group galaxy field actually draws pixels in `universe`
 * context.
 *
 * Before this task `makeLocalGroup()` generated 12 records but `StarApp.tsx` only ever
 * destructured `milkyWay`; the other 11 galaxies were discarded, so ascending to
 * `universe` showed an almost-empty void with a single impostor. Per the repo's own
 * failure history (`docs/research/galaxy-impostor-scale-is-inert.md`) an object's
 * existence/visibility flag can be "correct" while it draws zero pixels — so this gate
 * is a FRAME measurement (`__cosmos.readFrameStats()`), ablated WITHIN one run via
 * `window.__cosmosDev.setLocalGroupVisible`, mirroring
 * `e2e/tests/universe-impostor-scale.spec.ts`'s methodology exactly: measure the ON/OFF
 * litFrac delta on the reference machine, then gate at ~40% of the measured value — never
 * a bare `> off`, and never an absolute lit-pixel count (that would encode this machine's
 * SwiftShader build).
 *
 * The 11 galaxies are small (5-50 kpc) sprites scattered across a 1.5 Mpc sphere, so a
 * boot-orientation frame may have NONE in the frustum — an ablation delta of ~0 in that
 * case would be a false negative (vacuously passing on a broken layer), not evidence of
 * correctness. `__cosmosDev.orientTo` (TASK-086) reorients the camera to face a KNOWN
 * galaxy first, and the spec asserts `projectToScreen` resolves before measuring, so the
 * frame in front of the camera is not just anything the boot vantage happened to point at
 * (CLAUDE.md testing rule 1 — query the real state, don't assume it).
 *
 * Deterministic only: no screenshots, no wall-clock perf, no `@perf` tag.
 */

/** CI is SwiftShader and slow; every poll gets an explicit generous timeout. */
const POLL_TIMEOUT_MS = 45_000;
/**
 * Settle wait after `orientTo` (durationMs 600). `window.__cosmos.goToActive` is only
 * mirrored on a ≤4 Hz timer (`glue/time.ts`), which makes it a RACY settlement signal:
 * it can read stale `false` before the mirror ever observes the flight go true. A fixed
 * settle wait — same pattern as `ctxswitch.spec.ts`/`m3.spec.ts`'s `KEYFRAME_SETTLE_MS`
 * — sidesteps the mirror lag (see NOTES-2026-07-27-task-086.md).
 */
const ORIENT_SETTLE_MS = 1_000;

/**
 * Measured on win32 SwiftShader at the settled 0.18 Mpc vantage, oriented + FULLY
 * SETTLED (1000ms after `orientTo`) toward `proc:localgroup:3` (seed=1's local group,
 * `positionMpc` ≈ [-0.77, 0.72, 0.24] Mpc): litFrac 0.00059-0.00060 with the local-group
 * layer on (5 repeats), 0 ablated every time — a delta of ~0.0006. The floor is ~40% of
 * the measured delta (0.00024), mirroring `universe-impostor-scale.spec.ts`'s
 * `MIN_IMPOSTOR_LIT_DELTA` derivation exactly. See NOTES-2026-07-27-task-086.md JC-3.
 *
 * Unlike that sibling spec, there is no separate "ablated frame still has SOME lit
 * pixels" positive control here: `orientTo` deliberately turns the camera AWAY from the
 * Milky Way (at the universe origin) to face `proc:localgroup:3`, so with the
 * local-group layer ablated the frame is legitimately black (0 galaxies + no Milky Way
 * impostor + no overlay in that direction) — that is the correct, not a vacuous,
 * ablated reading. The delta assertion alone still guards against "delete the whole
 * scene": a dead render pipeline reads on=off=0, delta=0, which fails the floor exactly
 * as an actually-broken layer would.
 */
const MIN_LOCAL_GROUP_LIT_DELTA = 0.00024;

/** `proc:localgroup:3`'s positionMpc from `generateLocalGroup({ seed: 1 })` (LOCAL_GROUP_SEED,
 *  `apps/web/src/glue/local-group.ts`) — logged directly by the unit test
 *  (`packages/nav/test/local-group.test.ts`), not re-derived here (CLAUDE.md rule 1). */
const GALAXY_3_POSITION_MPC: [number, number, number] = [
  -0.7696923437412311, 0.724360694793291, 0.23944436975468775,
];

interface LocalGroupHook {
  ready: boolean;
  contextId: string;
  goToActive: boolean;
  cameraPosition: { context: string; local: [number, number, number] };
  errorCounts: { total: number };
  projectToScreen(local: readonly [number, number, number]): { x: number; y: number } | null;
  readFrameStats(): Promise<{
    width: number;
    height: number;
    meanLuma: number;
    litFrac: number;
    hotFrac: number;
  } | null>;
}

/** Everything needed to triage a CI-only failure from logs alone (CLAUDE.md rule 6). */
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

async function readStats(page: Page, label: string) {
  const s = await page.evaluate(() =>
    (window.__cosmos as unknown as LocalGroupHook).readFrameStats(),
  );
  expect(s, `readFrameStats() returned null at "${label}"; ${await snapshot(page)}`).not.toBeNull();
  console.log(`universe-local-group-visibility: ${label} ${JSON.stringify(s)}`);
  return s!;
}

test.describe('TASK-086 (G3) — local-group galaxy field visibility', () => {
  test('the local-group layer contributes pixels in universe context', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('canvas');
    await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
      timeout: 30_000,
    });

    // Ascend to universe through the real HUD control (same path universe-ascent.spec.ts
    // and universe-impostor-scale.spec.ts use). The segment boots disabled.
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
      console.log(
        `universe-local-group-visibility: never settled at the vantage; ${await snapshot(page)}`,
      );
      throw e;
    }

    // Guarantee ≥1 galaxy is in-frame before measuring — otherwise the ablation delta
    // can be vacuously ~0 because the 11 galaxies are scattered on a 1.5 Mpc sphere and
    // the boot orientation is arbitrary (G3's own stated risk). Fixed settle wait, not a
    // goToActive poll (see ORIENT_SETTLE_MS comment) — a frame taken mid-slew is still
    // valid for "is it in frame at all" but would make the ON/OFF comparison below
    // noisier (the camera keeps moving between the two reads).
    await page.evaluate((target) => window.__cosmosDev?.orientTo(target), GALAXY_3_POSITION_MPC);
    await page.waitForTimeout(ORIENT_SETTLE_MS);
    const projected = await page.evaluate(
      (target) => (window.__cosmos as unknown as LocalGroupHook).projectToScreen(target),
      GALAXY_3_POSITION_MPC,
    );
    expect(
      projected,
      `projectToScreen(galaxy 3) is null after orientTo — nothing to measure; ${await snapshot(page)}`,
    ).not.toBeNull();

    // contextId must still be universe after the nudge (NOTES JC-1 — orientTo's move is
    // negligible vs the galaxy-switch gates, but assert it rather than assume it).
    const ctxAfterOrient = await page.evaluate(() => window.__cosmos?.contextId);
    expect(ctxAfterOrient, `orientTo tripped a context switch; ${await snapshot(page)}`).toBe(
      'universe',
    );

    const layerOn = await readStats(page, 'local-group layer ON');

    await page.evaluate(() => window.__cosmosDev?.setLocalGroupVisible(false));
    const layerOff = await readStats(page, 'local-group layer OFF (ablated)');

    await page.evaluate(() => window.__cosmosDev?.setLocalGroupVisible(true));

    const delta = layerOn.litFrac - layerOff.litFrac;
    console.log(
      `universe-local-group-visibility: litFrac on=${layerOn.litFrac} off=${layerOff.litFrac} ` +
        `delta=${delta} state=${await snapshot(page)}`,
    );

    expect(
      delta,
      `the local-group layer contributes ${delta} of the frame — it is not reaching the GPU ` +
        `(on=${layerOn.litFrac}, off=${layerOff.litFrac})`,
    ).toBeGreaterThan(MIN_LOCAL_GROUP_LIT_DELTA);

    // Positive control: something is actually drawn with the layer ON (guards against
    // "nothing renders, on=off=0, but a bug makes the delta computation itself lie").
    expect(
      layerOn.litFrac,
      `litFrac=${layerOn.litFrac} with the local-group layer ON — nothing is being drawn at all`,
    ).toBeGreaterThan(0);

    const errors = await page.evaluate(
      () => (window.__cosmos as unknown as LocalGroupHook | undefined)?.errorCounts,
    );
    expect(errors?.total, `errorCounts=${JSON.stringify(errors)}`).toBe(0);
  });
});
