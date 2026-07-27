import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-083 — the star pick ray's origin must be in parsecs in EVERY scale context, not only
 * `galaxy`. `pickAt` builds its ray origin from `controller.state.position.local` (active-
 * context units) and feeds it to a pick path that subtracts `batch.originPc` (parsecs). In
 * galaxy context the two coincide, so the bug is invisible; in `system` context the origin
 * is inflated 206,266× and the pick resolves a wildly displaced — i.e. WRONG — star, or none.
 * Full writeup + live measurement: docs/research/star-pick-ray-origin-context-units.md.
 *
 * Why `?debug=m4a` (not the production app): `M4aApp` keeps the Sol system mounted in every
 * context and runs the `M3DescentProbe` galaxy → system descent, giving a deterministic
 * settled `contextId === 'system'` pose with the star field live — the same route the merged
 * `system-context-scale.spec.ts` uses. This spec cannot live in galaxy context: there
 * `pcScales('galaxy')` is exactly 1, so the fix is bit-identical to the bug (a galaxy-only
 * pick test is a false green — the m1 / perception specs, which stay unchanged, cover galaxy).
 *
 * The test asks the LIVE app, never a re-derived camera (CLAUDE.md testing rule 1): it
 * projects real catalog stars through `__cosmos.projectToScreen` and reads `__cosmos.pickAt`
 * at the projected pixel. No hard-coded pixel or star identity — the target is chosen at
 * runtime from whatever pack is served (rule 2). The star position → context-frame conversion
 * reuses the app's own `__cosmos.contextUnitMeters` table (never a hardcoded ratio).
 *
 * Power (stated in the PR body, gate item 3): on `main` this fails — at every on-screen star
 * `pickAt` returns a different id than the projection (measured 0/40 match); with the fix the
 * pick agrees with the projection (measured 36/40, the 4 "misses" being exact co-located
 * star pairs sharing one pixel — which this spec excludes via the isolation filter below).
 */

const RESULT_TIMEOUT_MS = 60_000;

/** Two on-screen stars nearer than this (CSS px) are treated as one blob: their projected
 *  pixels overlap, so the angular pick can legitimately resolve either. The target is chosen
 *  with NO neighbour inside this radius, so "the pick must return the projected star" is an
 *  unambiguous claim rather than a coin-flip between co-located stars. */
const MIN_NEIGHBOUR_SEP_PX = 6;

interface PickProbeResult {
  readonly onScreenCount: number;
  readonly target:
    | { readonly id: string; readonly x: number; readonly y: number; readonly distPc: number }
    | null;
  readonly picked: string | null;
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, { timeout: 30_000 });
}

async function waitSettledSystem(page: Page): Promise<void> {
  // The descent script resolves __m3Result (accessed via local cast — it is not part of the
  // shared __cosmos global type). contextId/goToActive are mirrored from a 250ms timer, so
  // wait for the settled system-context flags, not just descent completion.
  await page.waitForFunction(
    () => (window as unknown as { __m3Result?: unknown }).__m3Result !== undefined,
    undefined,
    { timeout: RESULT_TIMEOUT_MS },
  );
  await page.waitForFunction(
    () => window.__cosmos?.contextId === 'system' && window.__cosmos?.goToActive === false,
    undefined,
    { timeout: 5_000 },
  );
}

test('system-context pick: clicking a drawn background star selects THAT star, not one 206,266x away', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/?debug=m4a');
  await page.waitForSelector('canvas');
  await waitReady(page);
  await waitSettledSystem(page);

  const result: PickProbeResult = await page.evaluate(async (minSep) => {
    // contextUnitMeters is not on the shared __cosmos global type; cast it in locally, the
    // same way system-context-scale.spec.ts does. pickAt/projectToScreen/contextId are read
    // through this cast too.
    const c = window.__cosmos as unknown as {
      contextId: string;
      contextUnitMeters: Readonly<Record<string, number>>;
      pickAt(clientX: number, clientY: number): string | null;
      projectToScreen(local: readonly [number, number, number]): { x: number; y: number } | null;
    };

    const base = location.origin;
    const manifest = (await (await fetch(base + '/packs/manifest.json')).json()) as {
      count: number;
      binUrl: string;
      originPc: [number, number, number];
      buffers: Record<string, { byteOffset: number; byteLength: number }>;
    };
    const binBuf = await (await fetch(base + '/packs/' + manifest.binUrl)).arrayBuffer();
    const posMeta = manifest.buffers['positionsPc']!;
    const idMeta = manifest.buffers['catalogIds']!;
    const positions = new Float32Array(binBuf, posMeta.byteOffset, posMeta.byteLength / 4);
    const catalogIds = new Uint32Array(binBuf, idMeta.byteOffset, idMeta.byteLength / 4);
    const originPc = manifest.originPc;

    // projectToScreen expects the position in the ACTIVE context's units, but the pack is
    // parsecs — convert with the app's own constant table (parsecs → system units).
    const cum = c.contextUnitMeters;
    const pcToUnits = cum['galaxy']! / cum['system']!;

    type Hit = { id: string; x: number; y: number; distPc: number };
    const hits: Hit[] = [];
    for (let i = 0; i < manifest.count; i++) {
      const px = c.projectToScreen([
        (originPc[0] + positions[i * 3]!) * pcToUnits,
        (originPc[1] + positions[i * 3 + 1]!) * pcToUnits,
        (originPc[2] + positions[i * 3 + 2]!) * pcToUnits,
      ]);
      if (!px) continue;
      const distPc = Math.hypot(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
      hits.push({ id: 'hyg:' + catalogIds[i]!, x: px.x, y: px.y, distPc });
    }

    // Target: the nearest on-screen catalog star with NO other on-screen star within
    // `minSep` px (unambiguous for an angular pick), so "pick returns the projected star" is
    // a clean assertion. Nearest ⇒ a genuine foreground-of-field star, not a faint speck.
    hits.sort((a, b) => a.distPc - b.distPc);
    let target: Hit | null = null;
    for (const cand of hits) {
      let isolated = true;
      for (const other of hits) {
        if (other === cand) continue;
        if (Math.hypot(other.x - cand.x, other.y - cand.y) < minSep) {
          isolated = false;
          break;
        }
      }
      if (isolated) {
        target = cand;
        break;
      }
    }

    return {
      onScreenCount: hits.length,
      target,
      picked: target ? c.pickAt(target.x, target.y) : null,
    };
  }, MIN_NEIGHBOUR_SEP_PX);

  // Log the chosen input + measured quantity BEFORE asserting — a CI-only failure must be
  // triagable from logs alone (CLAUDE.md testing rule 6).
  console.log(`system-context-pick: ${JSON.stringify(result)}`);

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);

  expect(
    result.target,
    `no isolated on-screen catalog star in system context (onScreen=${result.onScreenCount}) — ` +
      'either the star field is not drawn in system context, or the descent never settled',
  ).not.toBeNull();

  // The core claim. On `main` the ray origin is in system units while the batch subtracts
  // parsecs, so the pick resolves a star ~206,266× displaced → a DIFFERENT id (or null).
  // With the TASK-083 fix the origin is parsecs and the pick agrees with the projection.
  expect(
    result.picked,
    `pickAt at the projected pixel of ${result.target!.id} (${Math.round(result.target!.x)}, ` +
      `${Math.round(result.target!.y)}, ${result.target!.distPc.toFixed(2)} pc) must resolve THAT ` +
      `star; got ${result.picked}`,
  ).toBe(result.target!.id);
});
