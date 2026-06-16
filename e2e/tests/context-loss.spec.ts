import { test, expect } from '@playwright/test';

test('WebGL context loss shows reload overlay', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('canvas');

  // Wait for the pack to load so the SceneHost with onContextLost is mounted.
  await page.waitForFunction(() => (window as { __cosmos?: { ready: boolean } }).__cosmos?.ready === true, {
    timeout: 20_000,
  });

  // Force context loss via the WEBGL_lose_context extension, then also
  // dispatch a synthetic webglcontextlost event as a fallback: SwiftShader /
  // headless Chromium accepts the extension but doesn't always fire the DOM
  // event from loseContext(). The handler is idempotent so double-firing is safe.
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) throw new Error('canvas not found');
    const gl = canvas.getContext('webgl2');
    if (!gl) throw new Error('webgl2 context not found');
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('WEBGL_lose_context extension not available');
    ext.loseContext();
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });

  // The overlay must appear.
  await expect(page.locator('.context-lost-overlay')).toBeVisible({ timeout: 3_000 });
  await expect(page.locator('.context-lost-box p')).toContainText('Graphics context lost');
  await expect(page.locator('.context-lost-box button')).toBeVisible();
});
