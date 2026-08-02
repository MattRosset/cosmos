import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-088 (Task B) — Gaia octree-stream pick → real DR3 identity. Flips research CLAIM 1
 * (docs/research/gaia-pick-identity-gap.md): a full-viewport `__cosmos.pickAt` sweep near Sol
 * measured ZERO `gaia:*` ids before this task (the ~1.1M streamed octree points were unpicked).
 * After it, the same sweep yields at least one `gaia:*`, and clicking that pixel resolves — via
 * the D1 sidecar — to a real 19-digit `gaia:<source_id>` in `__cosmos.selectedId` (which also
 * exercises the BUG-6 `fetch` receiver guard that fetch mocks cannot catch — the real-run smoke).
 *
 * REFERENCE-ONLY (skipped in CI): tile-mount timing is machine-dependent, so this is gated
 * behind an explicit readiness wait and kept off the blocking gate. The deterministic,
 * WebGL-free contract lives in the unit gates (octree-pick.test.ts, gaia-identity.test.ts).
 */

const READY_TIMEOUT_MS = 30_000;
const GAIA_TIMEOUT_MS = 45_000;

interface GaiaPickHook {
  ready: boolean;
  contextId: string;
  selectedId: string | null;
  cameraPosition: { context: string; local: [number, number, number] };
  errorCounts: { total: number };
  streaming: { loadedChunks: number };
  catalogCoverage: number;
  pickAt(clientX: number, clientY: number): string | null;
}

/** Sweep pickAt over an 8px grid (research CLAIM 1 snippet), returning the prefix histogram and
 *  the first pixel that picked a gaia star. Runs entirely in the page. */
function sweepInPage(): { histogram: Record<string, number>; gaia: { x: number; y: number } | null } {
  const c = window.__cosmos as unknown as GaiaPickHook;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const histogram: Record<string, number> = {};
  let gaia: { x: number; y: number } | null = null;
  for (let y = 0; y < H; y += 8) {
    for (let x = 0; x < W; x += 8) {
      const id = c.pickAt(x, y);
      if (!id) continue;
      const prefix = String(id).split(':')[0]!;
      histogram[prefix] = (histogram[prefix] ?? 0) + 1;
      if (prefix === 'gaia' && gaia === null) gaia = { x, y };
    }
  }
  return { histogram, gaia };
}

async function snapshot(page: Page): Promise<string> {
  return JSON.stringify(
    await page.evaluate(() => {
      const c = window.__cosmos as unknown as GaiaPickHook | undefined;
      return {
        contextId: c?.contextId,
        cameraPosition: c?.cameraPosition,
        loadedChunks: c?.streaming?.loadedChunks,
        catalogCoverage: c?.catalogCoverage,
        selectedId: c?.selectedId,
      };
    }),
  );
}

test.describe('TASK-088 — Gaia becomes pickable near Sol (flips research CLAIM 1)', () => {
  test.skip(!!process.env['CI'], 'tile-mount timing is machine-dependent — reference-only (gates 2–4 are the blocking contract)');

  test('a viewport pickAt sweep yields a gaia:* id, and clicking it resolves a real DR3 source_id', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForSelector('canvas');
    await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
      timeout: READY_TIMEOUT_MS,
    });

    // Readiness: wait until the Gaia octree tile has mounted AND the sweep can pick a gaia star
    // (worker-fetch invisibility, BUG-10 — do NOT wait on the resource API; poll loadedChunks +
    // the pick itself). This poll is both the readiness signal and the CLAIM-1-flip assertion.
    try {
      await page.waitForFunction(
        () => {
          const c = window.__cosmos as unknown as GaiaPickHook | undefined;
          if (!c?.streaming || c.streaming.loadedChunks <= 0) return false;
          const W = window.innerWidth;
          const H = window.innerHeight;
          for (let y = 0; y < H; y += 8) {
            for (let x = 0; x < W; x += 8) {
              const id = c.pickAt(x, y);
              if (id && String(id).startsWith('gaia:')) return true;
            }
          }
          return false;
        },
        undefined,
        { timeout: GAIA_TIMEOUT_MS },
      );
    } catch (e) {
      const { histogram } = await page.evaluate(sweepInPage);
      console.log(
        `gaia-pick-identity: no gaia:* pickable; sweep histogram=${JSON.stringify(histogram)}; ${await snapshot(page)}`,
      );
      throw e;
    }

    // Sweep once more to capture the histogram (proof) + a concrete gaia pixel to click.
    const { histogram, gaia } = await page.evaluate(sweepInPage);
    console.log(`gaia-pick-identity: sweep histogram=${JSON.stringify(histogram)}; gaia pixel=${JSON.stringify(gaia)}`);
    expect(histogram['gaia'], `expected ≥1 gaia:* hit; histogram=${JSON.stringify(histogram)}`).toBeGreaterThan(0);
    expect(gaia).not.toBeNull();

    // Click the gaia pixel through the real DOM; the provisional gaia:<catalogId> is upgraded
    // asynchronously to the real gaia:<source_id> (19 digits). Asserting the 19-digit form
    // proves the D1 sidecar fetch succeeded in a REAL browser (BUG-6 receiver guard) and the
    // bigint was interpolated losslessly (not Number()-truncated).
    await page.mouse.click(gaia!.x, gaia!.y);
    try {
      await page.waitForFunction(
        () => {
          const id = (window.__cosmos as unknown as GaiaPickHook | undefined)?.selectedId;
          return typeof id === 'string' && /^gaia:\d{19}$/.test(id);
        },
        undefined,
        { timeout: GAIA_TIMEOUT_MS },
      );
    } catch (e) {
      console.log(`gaia-pick-identity: selectedId never reached 19-digit gaia id; ${await snapshot(page)}`);
      throw e;
    }
    const selectedId = await page.evaluate(
      () => (window.__cosmos as unknown as GaiaPickHook | undefined)?.selectedId,
    );
    console.log(`gaia-pick-identity: selectedId=${selectedId}`);
    expect(selectedId).toMatch(/^gaia:\d{19}$/);

    const errors = await page.evaluate(
      () => (window.__cosmos as unknown as GaiaPickHook | undefined)?.errorCounts,
    );
    expect(errors?.total, `errorCounts=${JSON.stringify(errors)}`).toBe(0);
  });
});
