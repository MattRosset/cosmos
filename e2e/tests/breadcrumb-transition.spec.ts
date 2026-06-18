/**
 * Diagnostic: capture frames + brightness during Milky Way ↔ Galaxy breadcrumbs.
 * Run: pnpm exec playwright test breadcrumb-transition --config e2e/playwright.dev.config.ts
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'e2e', 'transition-capture');
const SAMPLE_MS = 250;
const MILKY_WAY_STAR_COUNT = 1_000_000;

async function waitGalaxyNavReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 60_000,
  });
  await page.waitForFunction(
    (min) => (window.__cosmos?.streaming?.renderedPoints ?? 0) >= min,
    MILKY_WAY_STAR_COUNT,
    { timeout: 120_000 },
  );
}

/** Mean non-background luminance of canvas (0 = black, higher = content). */
async function canvasBrightness(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return 0;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      // WebGL — sample via readPixels hack: draw canvas to offscreen 160×90
      const w = 160;
      const h = 90;
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d')!;
      octx.drawImage(canvas, 0, 0, w, h);
      const data = octx.getImageData(0, 0, w, h).data;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        // Skip near-background #02030a
        if (r + g + b < 18) continue;
        sum += (r + g + b) / 3;
        n++;
      }
      return n > 0 ? sum / n : 0;
    }
    return 0;
  });
}

interface Sample {
  readonly tMs: number;
  readonly brightness: number;
  readonly goToActive: boolean;
  readonly renderedPoints: number;
  readonly distPc: number;
}

async function sampleDuring(
  page: Page,
  label: string,
  durationMs: number,
): Promise<Sample[]> {
  const samples: Sample[] = [];
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < durationMs) {
    const tMs = Date.now() - t0;
    const state = await page.evaluate(() => ({
      goToActive: window.__cosmos?.goToActive ?? false,
      renderedPoints: window.__cosmos?.streaming?.renderedPoints ?? 0,
      distPc: Math.hypot(
        window.__cosmos?.cameraPosition.local[0] ?? 0,
        window.__cosmos?.cameraPosition.local[1] ?? 0,
        window.__cosmos?.cameraPosition.local[2] ?? 0,
      ),
    }));
    const brightness = await canvasBrightness(page);
    samples.push({ tMs, brightness, ...state });
    await page.screenshot({
      path: path.join(OUT_DIR, `${label}-${String(i).padStart(3, '0')}.png`),
    });
    i++;
    await page.waitForTimeout(SAMPLE_MS);
  }
  return samples;
}

function writeReport(name: string, samples: Sample[]): void {
  const blank = samples.filter((s) => s.brightness < 8);
  const report = {
    label: name,
    frames: samples.length,
    blankFrames: blank.length,
    blankAtMs: blank.map((s) => s.tMs),
    minBrightness: Math.min(...samples.map((s) => s.brightness)),
    maxBrightness: Math.max(...samples.map((s) => s.brightness)),
    samples,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, `${name}-report.json`),
    JSON.stringify(report, null, 2),
  );
}

test('capture Milky Way exit + Galaxy entry transitions', async ({ page }) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await page.goto('/');
  await page.waitForSelector('canvas');
  await waitGalaxyNavReady(page);

  await page.screenshot({ path: path.join(OUT_DIR, '00-boot-ready.png') });

  // Exit: Galaxy field → Milky Way
  const milkyBtn = page.getByRole('button', { name: /Milky Way/i });
  await expect(milkyBtn).toBeEnabled({ timeout: 5_000 });
  await milkyBtn.click();

  const exitSamples = await sampleDuring(page, 'exit-to-milkyway', 6_500);
  writeReport('exit-to-milkyway', exitSamples);

  await page.waitForFunction(() => window.__cosmos?.goToActive === false, undefined, {
    timeout: 30_000,
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, '01-at-milkyway.png') });

  // Entry: Milky Way → Galaxy field
  const galaxyBtn = page.getByRole('button', { name: /^◂ Galaxy$/i });
  await galaxyBtn.click();

  const entrySamples = await sampleDuring(page, 'entry-to-galaxy', 6_500);
  writeReport('entry-to-galaxy', entrySamples);

  await page.waitForFunction(() => window.__cosmos?.goToActive === false, undefined, {
    timeout: 30_000,
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT_DIR, '02-at-galaxy-field.png') });

  // Fail only on sustained blank at start (first 2 s after click)
  const exitStartBlank = exitSamples.filter((s) => s.tMs < 2000 && s.brightness < 8);
  const entryStartBlank = entrySamples.filter((s) => s.tMs < 2000 && s.brightness < 8);

  console.log('exit start blank frames (0-2s):', exitStartBlank.length);
  console.log('entry start blank frames (0-2s):', entryStartBlank.length);
  console.log('Output:', OUT_DIR);

  expect(exitStartBlank.length, 'exit should not stay black >2s at start').toBeLessThan(4);
  expect(entryStartBlank.length, 'entry should not stay black >2s at start').toBeLessThan(4);
});
