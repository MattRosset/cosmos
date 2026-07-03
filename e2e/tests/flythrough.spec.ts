import { test, expect } from '@playwright/test';
import { injectFrameStats, readFrameStats, percentile } from './helpers/frame-stats';

test('flythrough — no page errors, rebase counter increases, frame perf logged', async ({
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

  // Visual baseline — reference-machine only (testing-conventions §1.4; TASK-063).
  // Canvas only — HUD fps/backdrop-filter vary by runner; scene pixels are the signal.
  if (!process.env['CI']) {
    await expect(page.locator('canvas')).toHaveScreenshot('flythrough-at-rest.png');
  }

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

  // Frame-time perf. Strict frame budgets are a REFERENCE-MACHINE criterion
  // (TASK-014/017 §6 M1: "60 fps on the reference desktop"; Lighthouse + the manual
  // milestone checklist are the real perf gates). On a shared CI runner, software-GL
  // (swiftshader) wall-clock frame time is dominated by CPU contention and the
  // fill-rate cost of flying the camera through full-screen marker cubes — it swings
  // ~10x vs a dev machine and is not a reliable regression signal. So we MEASURE and
  // LOG every run (a real regression still shows in CI output), but GATE only locally
  // on a consistent machine. Signed-off environment exception per TASK-017's
  // "flaky-runner exception needs human sign-off" clause — see this commit.
  const stats = await readFrameStats(page);
  // Drop the first sample (time from injection to first rAF, not a real frame)
  const samples = stats.samples.slice(1);
  const p95 = percentile(samples, 95);
  const maxFrame = samples.length > 0 ? Math.max(...samples) : 0;
  console.log(
    `[flythrough perf] p95=${p95.toFixed(1)}ms max=${maxFrame.toFixed(1)}ms over ${samples.length} frames`,
  );

  if (!process.env['CI']) {
    expect(p95, 'p95 frame time must be < 75 ms (reference machine)').toBeLessThan(75);
  }
});
