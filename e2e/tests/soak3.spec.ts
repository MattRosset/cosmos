import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-041 — Phase 3 acceptance gate: the memory-soak test (§5.8 / §6).
 *
 * Opens `?debug=soak3` (a self-measuring debug mode in apps/web). SoakProbe loops
 * the committed recorded flythrough path back and forth — each cycle loads the
 * Milky Way streaming tier on entry and evicts it on exit — for a CI-relaxed loop
 * count (documented in flythrough3-path.json `soakLoops`; the 10-min soak is the
 * reference run on the MANUAL matrix). It samples `usedJSHeapSize` every ~5 s and
 * folds the streaming counters into a per-frame `churn` summary, onto
 * `window.__soak3Result`.
 *
 * PASS rule (memory-stable, §5.8 "memory plateaus"):
 *   - the heap PLATEAUS: a linear regression over the SECOND HALF of the samples
 *     rises by a small fraction of the mean heap (no monotonic growth); and
 *   - eviction keeps pace: the ready tile set oscillates (loadedMin < loadedMax) as the
 *     camera loops in and out, yet the heap stays flat — i.e. it loads and releases,
 *     "not just growing" (§5.8).
 *
 * Churn proxy = `loadedChunks` oscillation. NOTE this was inverted by the BUG-6 fix
 * (TASK-052): before it, octree tiles never loaded (fetch threw) and were re-requested
 * ~6/frame, so loadedChunks stayed pinned at the one persistent galaxy chunk while a huge
 * request storm fired — the old gate keyed on `requestsIssued`. With BUG-6 fixed, tiles
 * load and persist in a bounded cache, so requestsIssued is small (~8) and loadedChunks is
 * the signal that genuinely moves (observed 2↔10). Chromium-only: `performance.memory`
 * does not exist on WebKit/Firefox (those projects skip this).
 */

const RESULT_TIMEOUT_MS = 220_000;

interface SoakChurn {
  inFlightMin: number;
  inFlightMax: number;
  loadedMin: number;
  loadedMax: number;
  renderedMax: number;
  requestsIssued: number;
}

interface Soak3Result {
  heapSamples: number[];
  loadedChunksSamples: number[];
  churn: SoakChurn;
  loops: number;
  durationMs: number;
  done: boolean;
}

declare global {
  interface Window {
    __soak3Result?: Soak3Result;
  }
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 30_000,
  });
  await page.waitForFunction(
    () => (window.__cosmos?.streaming?.renderedPoints ?? 0) >= 1_000_000,
    undefined,
    { timeout: 120_000 },
  );
}

/** Least-squares slope of y over index x = 0..n-1. */
function slope(ys: readonly number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (ys[i]! - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * TASK-053 — the soak runs twice: `soak3` (the M3 composition, the inherited
 * baseline) and `soak4` (the M4a composition — combined HYG+Gaia octree + the
 * constellation/nebula/label overlays + Earth atmosphere, the new leak suspects).
 * Both publish the same `__soak3Result` shape and must satisfy the same plateau +
 * churn rule; soak4 is the one that proves the M4a mounts dispose on context exit.
 */
const SOAK_MODES = ['soak3', 'soak4'] as const;

for (const mode of SOAK_MODES) {
test(`${mode}: heap plateaus while the streaming tier actively loads and releases`, async ({
  page,
}) => {
  test.setTimeout(260_000);

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto(`/?debug=${mode}`);
  await page.waitForSelector('canvas');
  await waitReady(page);

  await page.waitForFunction(() => window.__soak3Result !== undefined, undefined, {
    timeout: RESULT_TIMEOUT_MS,
  });
  const result = (await page.evaluate(() => window.__soak3Result)) as Soak3Result;

  const heap = result.heapSamples;
  const c = result.churn;
  console.log(
    `[${mode}] loops=${result.loops} dur=${(result.durationMs / 1000).toFixed(0)}s ` +
      `heapSamples=${heap.length} heap[0]=${heap[0] ?? 0} heap[-1]=${heap[heap.length - 1] ?? 0} ` +
      `churn(req=${c.requestsIssued} inFlight=${c.inFlightMin}..${c.inFlightMax} ` +
      `loaded=${c.loadedMin}..${c.loadedMax} renderedMax=${c.renderedMax})`,
  );

  // The soak ran enough cycles that a leak would compound (load↔evict each loop).
  expect(result.loops, 'completed multiple down-and-back cycles').toBeGreaterThanOrEqual(3);
  expect(heap.length, 'enough heap samples for a second-half regression').toBeGreaterThanOrEqual(6);

  // Heap PLATEAU: linear trend over the second half rises by a small fraction of
  // the mean heap (no monotonic growth). A real leak over N load↔evict cycles
  // would rise far more than this bound.
  const half = heap.slice(Math.floor(heap.length / 2));
  const meanHeap = half.reduce((a, b) => a + b, 0) / half.length;
  const fittedRise = slope(half) * (half.length - 1);
  const relativeRise = fittedRise / meanHeap;
  console.log(`[${mode}] second-half fittedRise=${(relativeRise * 100).toFixed(1)}% of mean heap`);
  expect(
    relativeRise,
    'heap plateaus: second-half linear trend rises < 10% of mean heap',
  ).toBeLessThan(0.1);

  // ACTIVE LOAD↔RELEASE (deterministic): the camera loops in and out, so the ready tile
  // set both GROWS on approach and SHRINKS on exit — loadedMin < loadedMax. Together with
  // the flat heap above, that oscillation IS the load↔release churn (not idle, not growth).
  //
  // This proxy changed with the BUG-6 fix (TASK-052). BEFORE it, octree tiles never loaded
  // — `fetch` threw Illegal invocation, every tile rejected and was re-requested ~6/frame —
  // so loadedChunks stayed pinned (≡1) while a ~14k-request STORM fired; the old gate keyed
  // on that storm (`requestsIssued > loops*20`). With BUG-6 fixed, tiles actually load and
  // persist in a bounded cache: requestsIssued is now small (≈ unique tiles, ~8) and the
  // genuine churn signal is the ready-set oscillation the old comment said was pinned. So we
  // assert that directly now, plus a liveness floor and engaged concurrency.
  expect(c.requestsIssued, 'streaming issued tile requests (not idle)').toBeGreaterThan(0);
  expect(
    c.inFlightMax,
    'in-flight concurrency engaged (> the persistent chunk)',
  ).toBeGreaterThanOrEqual(2);
  expect(
    c.loadedMax,
    'ready tile set grows then shrinks over the loop (load↔release churn)',
  ).toBeGreaterThan(c.loadedMin);

  expect(pageErrors, 'no uncaught errors during the soak').toHaveLength(0);
});
}
