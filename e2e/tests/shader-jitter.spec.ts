import { test, expect } from '@playwright/test';

/**
 * TASK-077 — compiled-shader jitter gate.
 *
 * Opens `?debug=shaderjitter`: the REAL render-stars vertex shader on one synthetic
 * star, the camera scripted to orbit it at 1 AU for 300 rendered frames while the
 * probe reads the star's on-screen centroid straight out of the drawing buffer. The
 * mode publishes `window.__shaderJitterResult = { maxDeviationPx, frames, lostFrames,
 * renderer }` when done.
 *
 * Unlike `jitter.spec.ts` (CPU `Vector3.project`), this exercises the driver-COMPILED
 * GPU hi/lo sum — the only local guard that can catch a fast-math backend reassociating
 * the split (docs/research/jitter-apple-mobile.md). PASS: maxDeviationPx < 1.5 px, all
 * 300 frames measured, zero lost frames. Chromium/swiftshader only — the compiled GPU
 * path is the point.
 */

const MAX_DEVIATION_PX = 1.5;
const MEASURE_FRAMES = 300;

interface ShaderJitterResult {
  maxDeviationPx: number;
  frames: number;
  lostFrames: number;
  renderer: string;
}

declare global {
  interface Window {
    __shaderJitterResult?: ShaderJitterResult;
  }
}

test('compiled-shader jitter gate: sub-pixel stable over 300 frames orbiting one star at 1 AU', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/?debug=shaderjitter');
  await page.waitForSelector('canvas');

  await page.waitForFunction(() => window.__shaderJitterResult !== undefined, undefined, {
    timeout: 30_000,
  });

  const result = (await page.evaluate(() => window.__shaderJitterResult)) as ShaderJitterResult;

  // Rule 6: a CI-only failure must be triagable from logs alone — carry the measured
  // value AND the backend string into every assertion message.
  const tag = `renderer=${result.renderer}`;

  expect(result.frames, `must measure the full 300-frame orbit; ${tag}`).toBe(MEASURE_FRAMES);
  expect(
    result.lostFrames,
    `star must be visible every measured frame (0 lost); got ${result.lostFrames}; ${tag}`,
  ).toBe(0);
  expect(
    result.maxDeviationPx,
    `compiled-shader jitter must stay sub-pixel (< ${MAX_DEVIATION_PX} px); got ${result.maxDeviationPx.toFixed(4)} px; ${tag}`,
  ).toBeLessThan(MAX_DEVIATION_PX);

  expect(pageErrors, `no uncaught errors during the shader-jitter run; ${tag}`).toHaveLength(0);
});
