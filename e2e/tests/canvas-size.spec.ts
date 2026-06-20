import { test, expect } from '@playwright/test';

test('canvas fills the viewport', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 60_000,
  });

  // `ready` (app logic) can fire a frame or two before R3F's ResizeObserver styles
  // the canvas to fill its container — until then the canvas reports its intrinsic
  // HTML default (300×150). Poll until it has actually filled the viewport instead
  // of sampling once on that layout race; a genuine sizing bug still fails by timeout.
  await page.waitForFunction(
    () => {
      const c = document.querySelector('canvas');
      return (
        !!c &&
        c.clientHeight > window.innerHeight * 0.9 &&
        c.clientWidth > window.innerWidth * 0.9
      );
    },
    undefined,
    { timeout: 10_000 },
  );

  const dims = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const main = document.getElementById('main');
    return {
      canvas: canvas
        ? {
            clientW: canvas.clientWidth,
            clientH: canvas.clientHeight,
            width: canvas.width,
            height: canvas.height,
          }
        : null,
      main: main ? { clientW: main.clientWidth, clientH: main.clientHeight } : null,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  });

  expect(dims.canvas, 'canvas must exist').not.toBeNull();
  expect(dims.canvas!.clientH).toBeGreaterThan(dims.viewport.h * 0.9);
  expect(dims.canvas!.clientW).toBeGreaterThan(dims.viewport.w * 0.9);
});
