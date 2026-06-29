import { test, expect, type Page } from '@playwright/test';

/**
 * TASK-059 — error gate: a scripted universe → galaxy → Sol → Earth descent against
 * the SHIPPED M4a composition (`?debug=errorgate`, mirrors `M4aApp`/`Flythrough4ProbeApp`
 * — combined HYG+Gaia octree, full packs, same scenes) asserts the diagnostics
 * counters TASK-058 exposed never went red:
 *
 *   1. `errorCounts.total === 0` — no silent error anywhere during the run.
 *   2. `failedChunks === 0` — no octree tile backed off to terminal `failed` (the
 *      BUG-6 storm would have shown here).
 *   3. `catalogCoverage > 0` — the catalog tier actually loaded near Sol.
 *
 * `?inject=1` is the gate's own red-on-regression self-test: it deliberately fails
 * the combined octree's root tile forever, proving the gate actually detects the
 * BUG-6 class rather than vacuously passing every run.
 */

const RESULT_TIMEOUT_MS = 60_000;

/** The error-gate-relevant slice of `window.__errorGateResult` (cast in browser callbacks). */
interface ErrorGateResult {
  readonly errorCounts: { readonly total: number; readonly streaming: number };
  readonly failedChunks: number;
  readonly catalogCoverage: number;
  readonly finalContext: string;
  readonly finalAnchor: string | null;
}

declare global {
  interface Window {
    __errorGateResult?: ErrorGateResult;
  }
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, { timeout: 30_000 });
}

async function waitResult(page: Page): Promise<ErrorGateResult> {
  await page.waitForFunction(() => window.__errorGateResult !== undefined, undefined, {
    timeout: RESULT_TIMEOUT_MS,
  });
  return page.evaluate(() => window.__errorGateResult!);
}

test('error gate: zero unexpected errors, zero failed chunks, catalog coverage loaded', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/?debug=errorgate');
  await page.waitForSelector('canvas');
  await waitReady(page);

  const result = await waitResult(page);
  expect(result.finalContext, 'descent ends in the Sol system').toBe('system');
  expect(result.finalAnchor).toBe('sol');

  // The default expectation is a hard zero — no allow-list entries today. A
  // legitimate error would need an explicit, commented, reasoned entry here; do
  // NOT relax this to `< N` (per the task's "do not weaken the gate" constraint).
  expect(result.errorCounts.total, 'no unexpected error was reported anywhere').toBe(0);
  expect(result.failedChunks, 'no octree tile backed off to the terminal failed state').toBe(0);
  expect(result.catalogCoverage, 'the catalog tier actually loaded near Sol').toBeGreaterThan(0);

  expect(pageErrors, 'no uncaught errors during the descent').toHaveLength(0);
});

test('error gate self-test (@inject): a deliberately broken tile turns the gate red', async ({
  page,
}) => {
  await page.goto('/?debug=errorgate&inject=1');
  await page.waitForSelector('canvas');
  await waitReady(page);

  const result = await waitResult(page);

  // The injected fault (root tile permanently fails) must be visible in the SAME
  // counters the clean run asserts are zero — proving the gate would have caught
  // a real BUG-6-class regression, not just always reporting green.
  expect(
    result.errorCounts.total,
    'the injected fault is counted by the central diagnostics sink',
  ).toBeGreaterThan(0);
  expect(
    result.errorCounts.streaming,
    'the injected fault is attributed to the streaming kind',
  ).toBeGreaterThan(0);
});
