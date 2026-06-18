/**
 * Main-thread span profiler during breadcrumb flights.
 * Run: pnpm exec playwright test breadcrumb-profile --config e2e/playwright.dev.config.ts
 */
import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'e2e', 'transition-capture');
const MILKY_WAY_STAR_COUNT = 1_000_000;

interface SpanStat {
  readonly sum: number;
  readonly max: number;
  readonly count: number;
}

interface ProfileResult {
  readonly longFrames: readonly {
    readonly totalMs: number;
    readonly goToActive: boolean;
    readonly distPc: number;
    readonly spans: Readonly<Record<string, number>>;
  }[];
  readonly spanStats: Readonly<Record<string, SpanStat>>;
  readonly topSpansByMax: readonly { readonly name: string; readonly maxMs: number }[];
}

async function waitReady(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, {
    timeout: 60_000,
  });
  await page.waitForFunction(
    (min) => (window.__cosmos?.streaming?.renderedPoints ?? 0) >= min,
    MILKY_WAY_STAR_COUNT,
    { timeout: 120_000 },
  );
}

test('profile main-thread spans during breadcrumbs @ 1M', async ({ page }) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await page.goto('/?debug=breadcrumb-profile');
  await page.waitForSelector('canvas');
  await waitReady(page);

  await page.getByRole('button', { name: /Milky Way/i }).click();
  await page.waitForFunction(() => window.__cosmos?.goToActive === false, undefined, {
    timeout: 30_000,
  });
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: /^◂ Galaxy$/i }).click();
  await page.waitForFunction(() => window.__cosmos?.goToActive === false, undefined, {
    timeout: 30_000,
  });
  await page.waitForTimeout(500);

  const profile = await page.evaluate(() => {
    const w = window as Window & {
      __breadcrumbProfile?: ProfileResult;
      __breadcrumbProfileBuild?: () => ProfileResult;
    };
    return w.__breadcrumbProfileBuild?.() ?? w.__breadcrumbProfile ?? null;
  });

  if (profile === null) {
    throw new Error('__breadcrumbProfile not available — is ?debug=breadcrumb-profile active?');
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'main-thread-profile.json'),
    JSON.stringify(profile, null, 2),
  );

  console.log('\n=== Top spans by max (ms) ===');
  for (const s of profile.topSpansByMax.slice(0, 12)) {
    const st = profile.spanStats[s.name];
    console.log(
      `  ${s.name.padEnd(28)} max=${s.maxMs.toFixed(1)}ms avg=${((st?.sum ?? 0) / (st?.count ?? 1)).toFixed(2)}ms n=${st?.count ?? 0}`,
    );
  }

  console.log('\n=== Long frames (>50ms) ===');
  for (const f of profile.longFrames.slice(-8)) {
    const top = Object.entries(f.spans)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${k}=${v.toFixed(0)}ms`)
      .join(' ');
    console.log(
      `  total=${f.totalMs.toFixed(0)}ms goTo=${f.goToActive} dist=${f.distPc.toFixed(0)}pc | ${top}`,
    );
  }

  console.log('\nWrote', path.join(OUT_DIR, 'main-thread-profile.json'));

  const hyg = profile.spanStats['nav.hyg.nearestStarIndex'];
  expect(hyg?.max ?? 0, 'nearestStarIndex must not stall during breadcrumbs').toBeLessThan(50);
});
