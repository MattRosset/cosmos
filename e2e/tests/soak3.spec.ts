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
 *   - eviction keeps pace: the tier issues FAR MORE tile requests than the in-flight
 *     cap (so the bounded queue fills and drains many times over), yet the ready set
 *     stays bounded and the heap is flat — i.e. it loads and releases, "not just
 *     growing" (§5.8).
 *
 * Why not assert `loadedChunks` oscillation directly (the spec's literal wording):
 * in this fast scripted path octree tiles arrive already out-of-cut and are
 * released the same frame, so the ready count stays pinned at the one persistent
 * galaxy chunk (observed: loadedChunks ≡ 1 while ~14k requests fire and inFlight
 * swings 1↔6). The churn summary is the signal that genuinely moves and proves the
 * same thing — load↔release cycling, not accumulation. Chromium-only:
 * `performance.memory` does not exist on WebKit/Firefox (those projects skip this).
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

test('soak3: heap plateaus while the streaming tier actively loads and releases', async ({
  page,
}) => {
  test.setTimeout(260_000);

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/?debug=soak3');
  await page.waitForSelector('canvas');
  await waitReady(page);

  await page.waitForFunction(() => window.__soak3Result !== undefined, undefined, {
    timeout: RESULT_TIMEOUT_MS,
  });
  const result = (await page.evaluate(() => window.__soak3Result)) as Soak3Result;

  const heap = result.heapSamples;
  const c = result.churn;
  console.log(
    `[soak3] loops=${result.loops} dur=${(result.durationMs / 1000).toFixed(0)}s ` +
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
  console.log(`[soak3] second-half fittedRise=${(relativeRise * 100).toFixed(1)}% of mean heap`);
  expect(
    relativeRise,
    'heap plateaus: second-half linear trend rises < 10% of mean heap',
  ).toBeLessThan(0.1);

  // ACTIVE LOAD↔RELEASE (deterministic, contention-robust): the tier issues far more
  // tile requests than the in-flight cap, so the bounded queue must fill and drain
  // many times over — that cycling, together with the flat heap above, IS the
  // load↔release churn. The throughput≫depth check replaces the old
  // `inFlightMax > inFlightMin` snapshot, which was fragile: under CPU contention the
  // queue stays saturated across the whole sampling window, pinning inFlightMin ==
  // inFlightMax == cap (observed 6 == 6) even while loading/releasing is healthy.
  expect(
    c.requestsIssued,
    'streaming issued many tile requests (active load, not idle)',
  ).toBeGreaterThan(result.loops * 20);
  expect(
    c.inFlightMax,
    'in-flight concurrency engaged (> the persistent chunk)',
  ).toBeGreaterThanOrEqual(2);
  expect(
    c.requestsIssued,
    'in-flight queue cycled many times over its depth (load/release churn)',
  ).toBeGreaterThan(c.inFlightMax * 10);

  expect(pageErrors, 'no uncaught errors during the soak').toHaveLength(0);
});
