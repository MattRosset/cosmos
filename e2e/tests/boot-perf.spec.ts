/**
 * Cold-load main-thread budget (replaces the Lighthouse `interactive`/
 * `categories:performance` CI gate — see docs/research/ci-lighthouse-boot-perf.md).
 *
 * Lighthouse's own trace/audit collection turned out to be the broken part: in a
 * CI-equivalent sandbox (2 vCPU, no GPU, software rendering) it reported TTI ≈ 44s
 * and sometimes crashed the renderer tab outright, while driving the SAME build
 * with a plain Playwright `longtask` PerformanceObserver showed zero frames over
 * 50ms and sub-2ms average frame cost. Lighthouse's simulated-throttling model
 * doesn't compose with an already CPU-capped host; this gate measures the real
 * page directly instead.
 */
import { test, expect, type Page } from '@playwright/test';
import { injectFrameStats, readFrameStats } from './helpers/frame-stats';

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 30_000,
  });
}

test('cold boot has no long main-thread tasks (galaxy-context start)', async ({ page }) => {
  await injectFrameStats(page);
  await page.goto('/');
  await waitReady(page);
  // Settle past the initial mount burst (octree + procgen galaxy cloud), matching
  // the cold-load window the old Lighthouse `maxNumericValue: 4000` gate intended.
  await page.waitForTimeout(4_000);

  const stats = await readFrameStats(page);
  const maxFrame = Math.max(...stats.samples);
  console.log(
    `[boot perf] frames=${stats.samples.length} max=${maxFrame.toFixed(1)}ms longTasks=${stats.longTasks}`,
  );

  // A couple of >50ms tasks at the very first mount (shader compile, texture/
  // buffer upload) are a real one-time cost, not a regression — same doctrine
  // as m1/m2 perf smoke: don't chase zero on a shared/throttled runner, chase
  // "still bounded". The old Lighthouse gate's 4000ms budget (and the 44s/0.46
  // score failure it threw under no-GPU CI) is the regression this replaces.
  expect(stats.longTasks, 'cold boot must not spray long tasks').toBeLessThan(10);
  expect(maxFrame, 'no single frame over 1000ms during cold boot').toBeLessThan(1_000);
});
