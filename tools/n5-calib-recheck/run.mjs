/**
 * Reference-machine N5 recheck — headed Chromium / Metal (NOT SwiftShader).
 *
 * ?debug=flythrough4&hold=1&tier=medium — probe flies universe→galaxy, then to a
 * HYG field star with no solar system (stays in starfield), settles, measures GPU.
 *
 * Usage (vite on :5174 with dense Gaia pack):
 *   PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" \
 *   N5_BASE_URL=http://localhost:5174 N5_TIER=medium N5_PACK_LABEL=dense53m \
 *   node tools/n5-calib-recheck/run.mjs
 */
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(
  path.join(__dirname, '..', '..', 'e2e', 'package.json'),
);
const { chromium } = require('@playwright/test');

const BASE = process.env.N5_BASE_URL ?? 'http://localhost:5174';
const OUT = path.join(__dirname, 'results');
const TIER = process.env.N5_TIER ?? 'medium';
const TIMEOUT_MS = Number(process.env.N5_TIMEOUT_MS ?? '420000');

fs.mkdirSync(OUT, { recursive: true });

const url = `${BASE}/?debug=flythrough4&hold=1&tier=${TIER}`;
console.log(`[n5-recheck] flythrough4 field-star hold tier=${TIER} url=${url}`);

const browser = await chromium.launch({
  headless: false,
  channel: process.env.N5_CHANNEL || undefined,
  args: ['--ignore-gpu-blocklist', '--enable-webgl', '--use-angle=metal'],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') console.error('[page]', msg.text());
});

await page.goto(url, { waitUntil: 'domcontentloaded' });

console.log(`[n5-recheck] waiting up to ${TIMEOUT_MS}ms for __flythrough4Hold…`);
// Callbacks below run in the page; eslint sees them as Node (no-undef on window/document).
await page.waitForFunction(
  // eslint-disable-next-line no-undef -- browser context
  () => window.__flythrough4Hold !== undefined,
  undefined,
  { timeout: TIMEOUT_MS },
);

const dump = await page.evaluate(() => {
  /* eslint-disable no-undef -- browser context */
  const canvas = document.querySelector('canvas');
  return {
    href: location.href,
    buffer: canvas ? [canvas.width, canvas.height] : null,
    dpr: devicePixelRatio,
    live: window.__flythrough4Live ?? null,
    hold: window.__flythrough4Hold ?? null,
    gpu: window.__flythrough4Gpu ?? null,
  };
  /* eslint-enable no-undef */
});

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const pack = process.env.N5_PACK_LABEL ?? 'unknown';
const outFile = path.join(OUT, `${stamp}_${pack}_${TIER}_fieldstar.json`);
fs.writeFileSync(outFile, JSON.stringify(dump, null, 2));
console.log(`[n5-recheck] wrote ${outFile}`);

// Full-frame proof: this window was sized at launch (never resized), so the render
// fills the whole 2880×1800 buffer — unlike the in-app pane's post-mount resize crop.
const shotFile = path.join(OUT, `${stamp}_${pack}_${TIER}_fieldstar.png`);
await page.screenshot({ path: shotFile });
console.log(`[n5-recheck] wrote ${shotFile}`);
console.log(JSON.stringify(dump.hold, null, 2));

await browser.close();
