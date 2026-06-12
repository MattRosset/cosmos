import { test, expect } from '@playwright/test';

/**
 * TASK-017 — Phase 1 acceptance gate: the RENDERED jitter test.
 *
 * Opens `?debug=jitter` (a self-measuring debug mode in apps/web): a marker 8 kpc
 * from the galactic center, the camera scripted to orbit it at 1 AU for 300 rendered
 * frames, each frame projecting the marker through the live Three.js camera. The mode
 * publishes `window.__jitterResult = { maxDeviationPx, frames }` when done.
 *
 * PASS: maxDeviationPx < 0.5 px at 1280×720 (ADR-001, same threshold as the Phase 0
 * numeric gate). Chromium/swiftshader only — the real GPU f32 vertex path is the point.
 */

const MAX_DEVIATION_PX = 0.5;
const MEASURE_FRAMES = 300;

interface JitterResult {
  maxDeviationPx: number;
  frames: number;
}

declare global {
  interface Window {
    __jitterResult?: JitterResult;
  }
}

test('rendered jitter gate: sub-pixel stable over 300 frames orbiting a marker 8 kpc out', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/?debug=jitter');
  await page.waitForSelector('canvas');

  await page.waitForFunction(() => window.__jitterResult !== undefined, undefined, {
    timeout: 30_000,
  });

  const result = (await page.evaluate(() => window.__jitterResult)) as JitterResult;

  expect(result.frames, 'must measure the full 300-frame orbit').toBe(MEASURE_FRAMES);
  expect(
    result.maxDeviationPx,
    `rendered jitter must stay sub-pixel (< ${MAX_DEVIATION_PX} px); got ${result.maxDeviationPx.toFixed(4)} px`,
  ).toBeLessThan(MAX_DEVIATION_PX);

  expect(pageErrors, 'no uncaught errors during the jitter run').toHaveLength(0);
});
