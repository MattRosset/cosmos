import { test, expect } from '@playwright/test';

test('app loads, canvas present, WebGL2 context created, no errors in 5 s', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/');
  await page.waitForSelector('canvas');

  const hasWebGL2 = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return false;
    const ctx = canvas.getContext('webgl2');
    return ctx !== null;
  });
  expect(hasWebGL2, 'WebGL2 context must be available').toBe(true);

  // 5 s idle — any render-loop error surfaces here
  await page.waitForTimeout(5_000);

  expect(consoleErrors, 'no console.error during idle').toHaveLength(0);
  expect(pageErrors, 'no uncaught page errors during idle').toHaveLength(0);
});
