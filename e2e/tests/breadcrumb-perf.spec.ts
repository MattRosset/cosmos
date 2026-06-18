/**
 * In-page rAF frame timing during breadcrumbs (no screenshot overhead).
 * Baseline captured pre/post HYG grid fix — see docs/research/TASK-040-breadcrumb-freeze.md.
 * Run: pnpm exec playwright test breadcrumb-perf --config e2e/playwright.dev.config.ts
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'e2e', 'transition-capture');
const MILKY_WAY_STAR_COUNT = 1_000_000;
/** Pre-fix spikes reached ~1761 ms; post-fix gate ensures the HYG stall stays gone. */
const MAX_FRAME_MS = 150;

interface PerfResult {
  readonly label: string;
  readonly frameMs: number[];
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly longFrames: number;
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 60_000,
  });
  await page.waitForFunction(
    (min) => (window.__cosmos?.streaming?.renderedPoints ?? 0) >= min,
    MILKY_WAY_STAR_COUNT,
    { timeout: 120_000 },
  );
}

async function startFrameProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as Window & { __frameProbe?: number[]; __probeLast?: number };
    w.__frameProbe = [];
    w.__probeLast = performance.now();
    const tick = (): void => {
      const now = performance.now();
      w.__frameProbe!.push(now - w.__probeLast!);
      w.__probeLast = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopFrameProbe(page: Page, label: string): Promise<PerfResult> {
  return page.evaluate((lbl) => {
    const w = window as Window & { __frameProbe?: number[] };
    const frameMs = w.__frameProbe ?? [];
    w.__frameProbe = [];
    const sorted = [...frameMs].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const longFrames = frameMs.filter((t) => t > 50).length;
    return { label: lbl, frameMs, p50, p95, max, longFrames };
  }, label);
}

function summarize(r: PerfResult): void {
  console.log(
    `[${r.label}] frames=${r.frameMs.length} p50=${r.p50.toFixed(1)}ms p95=${r.p95.toFixed(1)}ms max=${r.max.toFixed(1)}ms long(>50ms)=${r.longFrames}`,
  );
}

test('rAF frame timing during Milky Way breadcrumbs @ 1M', async ({ page }) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await page.goto('/');
  await page.waitForSelector('canvas');
  await waitReady(page);
  await startFrameProbe(page);

  await page.waitForTimeout(1500);
  const idle = await stopFrameProbe(page, 'idle');
  summarize(idle);

  await startFrameProbe(page);
  await page.getByRole('button', { name: /Milky Way/i }).click();
  await page.waitForFunction(() => window.__cosmos?.goToActive === false, undefined, {
    timeout: 30_000,
  });
  await page.waitForTimeout(300);
  const exit = await stopFrameProbe(page, 'exit-to-milkyway');
  summarize(exit);

  await startFrameProbe(page);
  await page.getByRole('button', { name: /^◂ Galaxy$/i }).click();
  await page.waitForFunction(() => window.__cosmos?.goToActive === false, undefined, {
    timeout: 30_000,
  });
  await page.waitForTimeout(300);
  const entry = await stopFrameProbe(page, 'entry-to-galaxy');
  summarize(entry);

  const report = { idle, exit, entry };
  fs.writeFileSync(path.join(OUT_DIR, 'frame-timing.json'), JSON.stringify(report, null, 2));

  expect(exit.max, 'exit max frame (HYG stall regression gate)').toBeLessThan(MAX_FRAME_MS);
  expect(entry.max, 'entry max frame (HYG stall regression gate)').toBeLessThan(MAX_FRAME_MS);
});
