import { test, expect } from '@playwright/test';
import { injectFrameStats, readFrameStats, percentile } from './helpers/frame-stats';

test('flythrough — no page errors, rebase counter increases, p95 frame < 50 ms', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // Must inject before goto so the rAF loop starts from first frame
  await injectFrameStats(page);

  await page.goto('/?debug=markers');
  await page.waitForSelector('canvas');

  // Let the scene stabilize before taking the baseline screenshot
  await page.waitForTimeout(1_500);

  // Baseline keyframe at rest — proves the rendered scene matches the committed baseline
  await expect(page).toHaveScreenshot('flythrough-at-rest.png');

  // Record rebase count before input begins
  const getRebaseCount = async () => {
    const text = await page
      .locator('.hud-panel div')
      .filter({ hasText: /rebases:/ })
      .locator('span')
      .textContent();
    return parseInt(text ?? '0', 10);
  };
  const rebaseBefore = await getRebaseCount();

  // Hold W to accelerate forward for 4 s
  await page.keyboard.down('w');
  await page.waitForTimeout(4_000);
  await page.keyboard.up('w');

  // Drag-look: click-drag across the canvas to change heading
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy + 50, { steps: 20 });
    await page.mouse.up();
  }

  // Hold Shift+W for boosted forward flight for 4 s
  await page.keyboard.down('Shift');
  await page.keyboard.down('w');
  await page.waitForTimeout(4_000);
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');

  // Allow one more frame-batch so HUD state settles
  await page.waitForTimeout(300);

  expect(pageErrors, 'no uncaught errors during flythrough').toHaveLength(0);

  const rebaseAfter = await getRebaseCount();
  expect(rebaseAfter, 'rebase counter must increase during flythrough').toBeGreaterThan(
    rebaseBefore,
  );

  // CI-relaxed perf thresholds (strict 60 fps is a TASK-017 reference-machine criterion)
  const stats = await readFrameStats(page);
  // Drop the first sample (time from injection to first rAF, not a real frame)
  const samples = stats.samples.slice(1);
  const p95 = percentile(samples, 95);
  expect(p95, 'p95 frame time must be < 50 ms').toBeLessThan(50);

  const maxFrame = samples.length > 0 ? Math.max(...samples) : 0;
  expect(maxFrame, 'no frame may exceed 250 ms').toBeLessThan(250);
});
