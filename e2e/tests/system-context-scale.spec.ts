import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-084 — `SystemScene`'s bodies render at their true angular size in every scale
 * context, not only `system`. Before this task the mesh/orbit-line/atmosphere geometry
 * was baked in system units (AU) but never corrected for the active context: in galaxy
 * context every body drew 206,266× too large (Sol's disc alone spanned ~11° from the
 * 5,000 AU arrival distance). Full writeup: docs/research/m3-switch-delta-yardstick.md
 * (CLAIM 5).
 *
 * `?debug=m4a` is used (not `?debug=m3`) because `M4aApp` keeps the system mounted in
 * EVERY context (`mountedSystemId ?? M3_SOL_SYSTEM_ID`), unlike the production app and
 * `M3App` (which only mount it in `system` — TASK-084's Out-of-scope note). The
 * M3-descent script it runs (`M3DescentProbe`) flies galaxy → system toward Sol, giving
 * a real mid-flight window with `contextId === 'galaxy'` and the system already built.
 *
 * The measurement runs INSIDE the page (an `addInitScript` rAF sampler), not after the
 * fact: by the time `__m3Result` resolves the descent has already left galaxy context,
 * so `__cosmos.projectToScreen` (camera-relative) would be evaluated against the wrong
 * camera position if called from Node afterwards. Everything the sampler touches is a
 * live app read — `__cosmos.systemBody` (mesh.object.scale.x, straight off the THREE
 * scene graph) and `__cosmos.projectToScreen` (the real camera projection) — never a
 * re-derived camera or coordinate model (CLAUDE.md testing rule 1).
 *
 * Two independent projected-diameter measurements are taken through the SAME real
 * `projectToScreen` call, differing only in which radius-in-context-units feeds the
 * limb offset:
 *   - "actual": radius × the LIVE `mesh.object.scale.x` SystemScene applied this frame
 *     (proves D2's per-frame write actually reached the rendered object).
 *   - "expected": radius × `CONTEXT_UNIT_METERS.system / CONTEXT_UNIT_METERS.galaxy`
 *     (the independent formula, read from the app's own constant table via
 *     `__cosmos.contextUnitMeters` — not hardcoded in the test).
 * If D1/D2 are wired correctly the two are identical; the gate is ±5%. A `system`-
 * context sample from the SAME run guards the trivial pass: it must show `meshScaleX`
 * still bit-identical `1` (memory *verify-render-before-perf* — a broken fix could
 * "pass" by never distinguishing contexts at all).
 */

const RESULT_TIMEOUT_MS = 60_000;
const EARTH_ID = 'sol:earth';

interface SystemBodySample {
  readonly contextId: string;
  readonly bodyId: string;
  readonly radiusAu: number;
  readonly dContext: number;
  readonly meshScaleX: number;
  readonly expectedScale: number;
  readonly measuredDiameterPx: number;
  readonly expectedDiameterPx: number;
}

interface SystemContextSample {
  readonly contextId: string;
  readonly meshScaleX: number;
}

interface Task084Store {
  galaxy: SystemBodySample | null;
  system: SystemContextSample | null;
}

declare global {
  interface Window {
    __task084?: Task084Store;
  }
}

async function injectSampler(page: Page, earthId: string): Promise<void> {
  await page.addInitScript((bodyId: string) => {
    window.__task084 = { galaxy: null, system: null };

    /** Perpendicular unit vector to `v` (Gram-Schmidt against +Y, +X fallback if `v`
     *  is nearly parallel to +Y) — plain vector algebra, not camera/projection math. */
    function perpAxis(v: readonly [number, number, number]): [number, number, number] {
      const len = Math.hypot(v[0], v[1], v[2]) || 1;
      const ref: [number, number, number] =
        Math.abs(v[1] / len) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const cx = v[1] * ref[2] - v[2] * ref[1];
      const cy = v[2] * ref[0] - v[0] * ref[2];
      const cz = v[0] * ref[1] - v[1] * ref[0];
      const clen = Math.hypot(cx, cy, cz) || 1;
      return [cx / clen, cy / clen, cz / clen];
    }

    /** Diameter (px) of a body at `offsetContextUnits` from the camera if its
     *  context-unit radius were `radiusAu * scale`, measured via TWO real
     *  `projectToScreen` calls (center + a limb point). */
    function projectedDiameterPx(
      cosmos: Window['__cosmos'],
      cameraLocal: readonly [number, number, number],
      offsetContextUnits: readonly [number, number, number],
      radiusAu: number,
      scale: number,
    ): number | null {
      const center: [number, number, number] = [
        cameraLocal[0] + offsetContextUnits[0],
        cameraLocal[1] + offsetContextUnits[1],
        cameraLocal[2] + offsetContextUnits[2],
      ];
      const axis = perpAxis(offsetContextUnits);
      const r = radiusAu * scale;
      const limb: [number, number, number] = [
        center[0] + axis[0] * r,
        center[1] + axis[1] * r,
        center[2] + axis[2] * r,
      ];
      const centerPx = cosmos!.projectToScreen(center);
      const limbPx = cosmos!.projectToScreen(limb);
      if (!centerPx || !limbPx) return null;
      return 2 * Math.hypot(limbPx.x - centerPx.x, limbPx.y - centerPx.y);
    }

    const tick = (): void => {
      const c = window.__cosmos as unknown as
        | (Window['__cosmos'] & {
            contextUnitMeters: Readonly<Record<string, number>>;
            systemBody(id: string): {
              radiusAu: number;
              renderOffsetContextUnits: readonly [number, number, number];
              meshScaleX: number;
            } | null;
          })
        | undefined;
      const store = window.__task084!;
      if (c?.ready) {
        if (c.contextId === 'galaxy' && store.galaxy === null) {
          const body = c.systemBody(bodyId);
          if (body) {
            const expectedScale = c.contextUnitMeters['system']! / c.contextUnitMeters['galaxy']!;
            const dContext = Math.hypot(...body.renderOffsetContextUnits);
            const measuredDiameterPx = projectedDiameterPx(
              c as Window['__cosmos'],
              c.cameraPosition.local,
              body.renderOffsetContextUnits,
              body.radiusAu,
              body.meshScaleX,
            );
            const expectedDiameterPx = projectedDiameterPx(
              c as Window['__cosmos'],
              c.cameraPosition.local,
              body.renderOffsetContextUnits,
              body.radiusAu,
              expectedScale,
            );
            if (measuredDiameterPx !== null && expectedDiameterPx !== null) {
              store.galaxy = {
                contextId: c.contextId,
                bodyId,
                radiusAu: body.radiusAu,
                dContext,
                meshScaleX: body.meshScaleX,
                expectedScale,
                measuredDiameterPx,
                expectedDiameterPx,
              };
            }
          }
        }
        if (c.contextId === 'system' && !c.goToActive) {
          const body = c.systemBody(bodyId);
          if (body) {
            store.system = { contextId: c.contextId, meshScaleX: body.meshScaleX };
          }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, earthId);
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 30_000,
  });
}

async function waitDescentDone(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __m3Result?: unknown }).__m3Result !== undefined,
    undefined,
    { timeout: RESULT_TIMEOUT_MS },
  );
}

test.describe('TASK-084 — SystemScene bodies are context-scaled', () => {
  test('Earth renders at its true angular size in galaxy context, unchanged in system context', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await injectSampler(page, EARTH_ID);
    await page.goto('/?debug=m4a');
    await page.waitForSelector('canvas');
    await waitReady(page);
    await waitDescentDone(page);

    // Wait on the sampler's REAL captured state, not a proxy for it. The mirrored
    // `contextId`/`goToActive` flags (apps/web/src/glue/time.ts) flip at goTo arrival,
    // but the system sample additionally needs `__cosmos.systemBody('sol:earth')`
    // non-null — which only becomes true once SystemScene's ASYNC texture build
    // resolves and sets `systemFeed.active`/`systemPickGroup` (SystemScene.tsx). Gating
    // on the flags let `evaluate` read `store.system === null` in the window before that
    // async build finished (the merge-to-main flake: 52 passed / 1 failed, byte-identical
    // app code to the passing PR head). Gate on the captured samples directly instead —
    // CLAUDE.md testing rule 1: query real state, never a proxy. Root cause:
    // docs/research/system-context-scale-system-sample-flake.md.
    await page.waitForFunction(
      () => window.__task084?.galaxy != null && window.__task084?.system != null,
      undefined,
      { timeout: 10_000 },
    );

    const result = await page.evaluate(() => window.__task084!);

    // Log everything BEFORE asserting — a CI-only failure must be triagable from logs
    // alone (CLAUDE.md testing rule 6).
    console.log(`system-context-scale: ${JSON.stringify(result)}`);

    expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);

    expect(
      result.galaxy,
      'never captured a galaxy-context sample of sol:earth during the descent — ' +
        'the M4a system was not mounted, or the body never projected on-screen',
    ).not.toBeNull();
    const g = result.galaxy!;

    // The formula's exact value (D1) — sanity-checks the sample itself.
    expect(g.expectedScale).toBeCloseTo(1.495978707e11 / 3.0857e16, 9);

    // The core claim: the LIVE mesh.object.scale.x SystemScene wrote this frame (D2)
    // matches the independent formula. This is the direct proof the fix reached the
    // rendered object, not just the math.
    expect(
      Math.abs(g.meshScaleX / g.expectedScale - 1),
      `meshScaleX=${g.meshScaleX} expectedScale=${g.expectedScale} — the live mesh ` +
        `scale does not match the formula; D2's per-frame write is not reaching the mesh`,
    ).toBeLessThan(0.05);

    // The Goal, end to end: the projected diameter using the LIVE scale matches the
    // projected diameter an independently-derived correct scale would produce, within
    // ±5% (both measured via the SAME real projectToScreen call — CLAUDE.md rule 1).
    expect(
      Math.abs(g.measuredDiameterPx / g.expectedDiameterPx - 1),
      `measuredDiameterPx=${g.measuredDiameterPx} expectedDiameterPx=${g.expectedDiameterPx} ` +
        `radiusAu=${g.radiusAu} dContext=${g.dContext} meshScaleX=${g.meshScaleX}`,
    ).toBeLessThan(0.05);

    // Guard against the trivial pass (memory verify-render-before-perf): the SAME body
    // in `system` context must still be bit-identical `1` — the fix must move only the
    // galaxy-context size, never the system-context one.
    expect(
      result.system,
      'never captured a settled system-context sample of sol:earth after the descent',
    ).not.toBeNull();
    expect(
      result.system!.meshScaleX,
      `meshScaleX=${result.system!.meshScaleX} in system context — must stay EXACTLY 1 ` +
        `(IEEE-754-exact anchor, D1)`,
    ).toBe(1);
  });
});
