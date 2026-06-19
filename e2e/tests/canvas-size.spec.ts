import { test, expect } from '@playwright/test';

test('canvas fills the viewport', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 60_000,
  });

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
