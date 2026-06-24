import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * TASK-053 — Phase 4a acceptance gate: the tier-unification budget test
 * (ADR-006 §5.4, the headline M4a measurable).
 *
 * Opens `?debug=flythrough4` (a self-measuring debug mode in apps/web).
 * Flythrough4Probe replays the SAME committed recorded camera path as flythrough3
 * (flythrough3-path.json) but against the M4a composition — the COMBINED HYG + Gaia
 * octree streamed through ONE policy, coverage-faded procgen, gated HYG monolith,
 * overlays + Earth atmosphere. It publishes, on `window.__flythrough4Result`:
 * per-segment streaming peaks (renderedPoints/drawCalls/inFlight/loadedChunks),
 * catalogCoverage/procgenOpacity ranges, frame-time distributions, and (when the
 * span profiler is active — it is under this mode) the `profileSpan` span stats for
 * BUG-4 attribution.
 *
 * PASS rule (ADR-006 §5.4):
 *   - every project (incl. CI): the §5.8 caps hold over the whole descent —
 *     in-flight ≤ 6, rendered points ≤ 2M, draw calls ≤ 300; AND the procgen cloud
 *     fades (procgenOpacity → ~0) where the catalog covers the cut (coverage → ~1).
 *   - the NEAR-SOL drop (the unification win): near-Sol renderedPoints + drawCalls
 *     are ≤ the committed M3 baseline (flythrough4-m3-baseline.json). The baseline
 *     is recorded by the SAME probe with `?baseline=m3` (the M3 tier on the same
 *     path). Until the baseline is recorded (`nearSol` null), this clause logs the
 *     M4a numbers and is skipped, so the harness is runnable before the baseline
 *     exists. The baseline is the M3 tier (`?baseline=m3`), recorded separately and
 *     committed to flythrough4-m3-baseline.json (it must NOT be the m4a numbers).
 *
 * WHY frame time is not a CI gate here: same as flythrough3 — CI runs SwiftShader,
 * where wall-clock measures the runner, not the code. The deterministic work-budget
 * caps + the near-Sol budget DROP are the real regression gate. The p50/p95/max line
 * and the BUG-4 span breakdown are logged every run so the numbers stay visible.
 */

const RESULT_TIMEOUT_MS = 60_000;
const BASELINE_PATH = path.join(
  process.cwd(),
  'apps',
  'web',
  'src',
  'scene',
  'flythrough4-m3-baseline.json',
);

interface SegmentStats {
  frames: number;
  p50: number;
  p95: number;
  maxFrameMs: number;
  longFrames: number;
  peakRenderedPoints: number;
  peakDrawCalls: number;
  peakInFlight: number;
  peakLoadedChunks: number;
  requestsIssued: number;
  minCoverage: number;
  maxCoverage: number;
  minProcgenOpacity: number;
  maxProcgenOpacity: number;
}

interface SpanStat {
  sum: number;
  max: number;
  count: number;
}

interface Flythrough4Result {
  variant: 'm3' | 'm4a';
  frames: number;
  p50: number;
  p95: number;
  maxFrameMs: number;
  longFrames: number;
  heapSamples: number[];
  streamingPeak: { inFlight: number; loadedChunks: number; renderedPoints: number; drawCalls: number };
  segments: Record<'toGalaxy' | 'toSol' | 'toEarth', SegmentStats>;
  finalCoverage: number;
  finalProcgenOpacity: number;
  switches: { from: string; to: string; anchorId: string | null }[];
  finalContext: string;
  profile: {
    spanStats: Record<string, SpanStat>;
    topSpansByMax: { name: string; maxMs: number }[];
  } | null;
}

declare global {
  interface Window {
    __flythrough4Result?: Flythrough4Result;
  }
}

interface BaselineFile {
  _recorded: boolean;
  nearSol: { peakRenderedPoints: number | null; peakDrawCalls: number | null };
  caps: { inFlightMax: number; renderedPointsMax: number; drawCallsMax: number };
}

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__cosmos?.ready === true, undefined, { timeout: 30_000 });
  await page.waitForFunction(
    () => (window.__cosmos?.streaming?.renderedPoints ?? 0) >= 1_000_000,
    undefined,
    { timeout: 120_000 },
  );
}

function logSegments(result: Flythrough4Result): void {
  for (const key of ['toGalaxy', 'toSol', 'toEarth'] as const) {
    const s = result.segments[key];
    console.log(
      `[flythrough4:${key}] frames=${s.frames} p50=${s.p50.toFixed(1)} p95=${s.p95.toFixed(1)} ` +
        `max=${s.maxFrameMs.toFixed(1)} long=${s.longFrames} ` +
        `pts=${s.peakRenderedPoints} draws=${s.peakDrawCalls} inFlight=${s.peakInFlight} ` +
        `req=${s.requestsIssued} cov=${s.minCoverage.toFixed(2)}..${s.maxCoverage.toFixed(2)} ` +
        `procgen=${s.minProcgenOpacity.toFixed(2)}..${s.maxProcgenOpacity.toFixed(2)}`,
    );
  }
}

function logProfile(result: Flythrough4Result): void {
  if (result.profile === null) {
    console.log('[flythrough4] no span profile captured');
    return;
  }
  console.log('[flythrough4] === BUG-4 span profile — top spans by total time ===');
  const byTotal = Object.entries(result.profile.spanStats)
    .map(([name, s]) => ({ name, ...s, avg: s.sum / Math.max(1, s.count) }))
    .sort((a, b) => b.sum - a.sum)
    .slice(0, 12);
  for (const s of byTotal) {
    console.log(
      `  ${s.name.padEnd(28)} total=${s.sum.toFixed(0)}ms max=${s.max.toFixed(1)}ms ` +
        `avg=${s.avg.toFixed(2)}ms n=${s.count}`,
    );
  }
}

test('flythrough4: near-Sol budgets drop vs M3 baseline; procgen fades where catalog covers', async ({
  page,
  browserName,
}) => {
  test.setTimeout(180_000);

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/?debug=flythrough4');
  await page.waitForSelector('canvas');
  await waitReady(page);

  await page.waitForFunction(() => window.__flythrough4Result !== undefined, undefined, {
    timeout: RESULT_TIMEOUT_MS,
  });
  const result = (await page.evaluate(() => window.__flythrough4Result)) as Flythrough4Result;

  console.log(
    `[flythrough4:${browserName}] variant=${result.variant} frames=${result.frames} ` +
      `p50=${result.p50.toFixed(1)} p95=${result.p95.toFixed(1)} max=${result.maxFrameMs.toFixed(1)} ` +
      `peak(pts=${result.streamingPeak.renderedPoints} draws=${result.streamingPeak.drawCalls} ` +
      `inFlight=${result.streamingPeak.inFlight}) ` +
      `finalCov=${result.finalCoverage.toFixed(3)} finalProcgen=${result.finalProcgenOpacity.toFixed(3)} ` +
      `final=${result.finalContext}`,
  );
  logSegments(result);
  logProfile(result);

  // The descent completed the full universe → galaxy → system path.
  expect(result.switches.map((s) => `${s.from}->${s.to}`)).toEqual([
    'universe->galaxy',
    'galaxy->system',
  ]);
  expect(result.finalContext, 'descent ends in the Sol system').toBe('system');

  // §5.8 hard caps (never relax — TASK-053 forbidden actions), whole-descent.
  expect(result.streamingPeak.inFlight, 'in-flight ≤ 6 (§5.8 cap)').toBeLessThanOrEqual(6);
  expect(
    result.streamingPeak.renderedPoints,
    'rendered points within the high-tier 2M cap',
  ).toBeLessThanOrEqual(2_000_000);
  expect(result.streamingPeak.drawCalls, 'draw calls within the 300 budget').toBeLessThanOrEqual(300);

  // ADR-006 §5.1: procgen fades where the catalog covers the cut. The combined
  // HYG+Gaia octree covers part of the cut → procgen opacity drops below the
  // retired M3 floor (0.5) in the inner segments.
  const innerProcgenMin = Math.min(
    result.segments.toSol.minProcgenOpacity,
    result.segments.toEarth.minProcgenOpacity,
  );
  const innerCovMax = Math.max(result.segments.toSol.maxCoverage, result.segments.toEarth.maxCoverage);
  expect(innerCovMax, 'catalog covers part of the inner cut').toBeGreaterThan(0);
  expect(
    innerProcgenMin,
    'procgen opacity fades below the retired M3 floor where the catalog covers',
  ).toBeLessThan(0.5);

  // The NEAR-SOL drop (the unification win) — near-Sol = max over toSol + toEarth.
  const nearSolPoints = Math.max(
    result.segments.toSol.peakRenderedPoints,
    result.segments.toEarth.peakRenderedPoints,
  );
  const nearSolDraws = Math.max(
    result.segments.toSol.peakDrawCalls,
    result.segments.toEarth.peakDrawCalls,
  );

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as BaselineFile;
  if (
    baseline._recorded &&
    baseline.nearSol.peakRenderedPoints !== null &&
    baseline.nearSol.peakDrawCalls !== null
  ) {
    console.log(
      `[flythrough4] near-Sol M4a pts=${nearSolPoints} draws=${nearSolDraws} ` +
        `vs M3 baseline pts=${baseline.nearSol.peakRenderedPoints} draws=${baseline.nearSol.peakDrawCalls}`,
    );
    expect(
      nearSolPoints,
      'near-Sol rendered points ≤ M3 baseline (ADR-006 §5.4 drop)',
    ).toBeLessThanOrEqual(baseline.nearSol.peakRenderedPoints);
    expect(
      nearSolDraws,
      'near-Sol draw calls ≤ M3 baseline (ADR-006 §5.4 drop)',
    ).toBeLessThanOrEqual(baseline.nearSol.peakDrawCalls);
  } else {
    console.log(
      `[flythrough4] M3 baseline NOT recorded — near-Sol drop clause SKIPPED. ` +
        `M4a near-Sol pts=${nearSolPoints} draws=${nearSolDraws}. ` +
        `Record the baseline: open ?debug=flythrough4&baseline=m3, copy max(toSol,toEarth) ` +
        `peakRenderedPoints/peakDrawCalls into flythrough4-m3-baseline.json, set _recorded=true.`,
    );
  }

  expect(pageErrors, 'no uncaught errors during the flythrough').toHaveLength(0);
});
