import { test, expect, type Page } from '@playwright/test';

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
 *   - the NEAR-SOL drop (the unification win): near-Sol TOTAL scene draw calls + points
 *     (`gl.info.render`) are ≤ the committed M3 baseline (flythrough4-m3-baseline.json).
 *     Scene totals, NOT the streaming-only stats, because the redundant layer M4a removes
 *     is the HYG monolith StarScene draws outside the streaming policy — M3 keeps it, M4a
 *     culls it once the octree covers the cut. The baseline is recorded by the SAME probe
 *     with `?baseline=m3` (the M3 tier on the same path). Until it is recorded (`nearSol`
 *     null), this clause logs the M4a numbers and is skipped, so the harness is runnable
 *     before the baseline exists (it must be the M3 tier, NOT the m4a numbers).
 *
 * WHY frame time is not a CI gate here: same as flythrough3 — CI runs SwiftShader,
 * where wall-clock measures the runner, not the code. The deterministic work-budget
 * caps + the near-Sol budget DROP are the real regression gate. The p50/p95/max line
 * and the BUG-4 span breakdown are logged every run so the numbers stay visible.
 */

const RESULT_TIMEOUT_MS = 60_000;
// Resolve relative to THIS spec file, not process.cwd(): CI runs playwright with cwd =
// the e2e package dir (`pnpm --filter @cosmos/e2e exec …`), so a cwd-based path resolved
// to `e2e/apps/web/…` → ENOENT and the test threw on every browser. __dirname is e2e/tests.

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
  peakSceneDrawCalls: number;
  peakScenePoints: number;
  peakScenePointsBreakdown: { kind: string; points: number }[];
  peakFrustumKept: number;
  peakFrustumCulled: number;
  peakBrightnessCulled: number;
  peakContainmentCandidates: number;
  peakContainmentCandidatePoints: number;
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


/** Run one probe arm end to end and return its published result. */
async function runArm(page: Page, url: string): Promise<Flythrough4Result> {
  await page.goto(url);
  await page.waitForSelector('canvas');
  await waitReady(page);
  await page.waitForFunction(() => window.__flythrough4Result !== undefined, undefined, {
    timeout: RESULT_TIMEOUT_MS,
  });
  return (await page.evaluate(() => window.__flythrough4Result)) as Flythrough4Result;
}

/** Log a near-Sol peak with its per-object attribution (log-only). */
function logNearSol(label: string, r: Flythrough4Result): void {
  const s = r.segments.toSol;
  console.log(
    `[flythrough4] ${label} (variant=${r.variant}) near-Sol draws=${s.peakSceneDrawCalls} ` +
      `pts=${s.peakScenePoints} :: ` +
      (s.peakScenePointsBreakdown ?? [])
        .filter((x) => x.kind === 'Points')
        .map((x) => x.points)
        .join(' '),
  );
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
        `streamPts=${s.peakRenderedPoints} streamDraws=${s.peakDrawCalls} ` +
        `scenePts=${s.peakScenePoints} sceneDraws=${s.peakSceneDrawCalls} inFlight=${s.peakInFlight} ` +
        `frustumKept=${s.peakFrustumKept} frustumCulled=${s.peakFrustumCulled} ` +
        `brightnessCulled=${s.peakBrightnessCulled} ` +
        `containmentCandidates=${s.peakContainmentCandidates} ` +
        `containmentCandidatePts=${s.peakContainmentCandidatePoints} ` +
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

  // The M3 CONTROL, measured live in this same run (see the near-Sol assertion below for
  // why the committed baseline was retired). Runs first so a boot failure fails fast.
  const control = await runArm(page, '/?debug=flythrough4&baseline=m3');
  logNearSol('M3 control', control);

  const result = await runArm(page, '/?debug=flythrough4');

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

  // The NEAR-SOL drop (the unification win) — measured on the `toSol` segment only.
  // Compared on TOTAL scene work (gl.info.render), NOT the streaming-only stats: the
  // redundant layer M4a removes is the HYG monolith, which StarScene draws outside the
  // streaming policy. M3 keeps it always; M4a culls it once the octree covers the cut
  // (StarScene MONOLITH_COVERAGE_GATE). That gate fires in GALAXY context — i.e. the
  // `toSol` approach segment. `toEarth` is SYSTEM context, where the monolith renders as
  // the background field in BOTH tiers, so folding it in via max() would wash the win out
  // (measured: m3 toSol scenePts 109,971 → m4a toSol 572, a clean cull; m4a toEarth
  // re-draws ~109,970 in both). So the drop is asserted on toSol, where it is unambiguous.
  const nearSolSceneDraws = result.segments.toSol.peakSceneDrawCalls;
  const nearSolScenePoints = result.segments.toSol.peakScenePoints;

  logNearSol('M4a', result);

  // ADR-006 §5.4 — the unification must not draw MORE near Sol than the tier it replaces.
  //
  // This used to compare against `flythrough4-m3-baseline.json`, an ABSOLUTE recorded on
  // 2026-06-24. That baseline was measured, 2026-08-05, to no longer describe M3: the same
  // probe in the same mode on the production pack reports 44 draws / 309,369 points against
  // the recorded 40 / 109,971 — the control fails its own threshold by 2.8x. Composition
  // drifted underneath it (procgen's LOD rework, the combined HYG+Gaia octree) and nothing
  // caught it, because a recorded control is never re-run.
  //
  // The relation is what §5.4 actually claims, so the relation is what is asserted, with both
  // arms measured in THIS run. That costs a second traversal of the path and cannot go stale.
  // Evidence: docs/research/near-sol-gate-stale-baseline-and-real-gap.md.
  //
  // Measured when this was written (production pack, chromium): M3 44 / 309,369 vs M4a
  // 43 / 200,105 — the monolith (109,399) is culled in M4a and drawn in M3, which is the
  // whole point of §5.4. The margin on draws is thin (1); on points it is 35%.
  const controlSol = control.segments.toSol;
  expect(control.variant, 'the control arm really is M3').toBe('m3');
  expect(
    nearSolSceneDraws,
    `near-Sol scene draw calls <= the M3 control measured in this run ` +
      `(M4a ${nearSolSceneDraws} vs M3 ${controlSol.peakSceneDrawCalls})`,
  ).toBeLessThanOrEqual(controlSol.peakSceneDrawCalls);
  expect(
    nearSolScenePoints,
    `near-Sol scene points <= the M3 control measured in this run ` +
      `(M4a ${nearSolScenePoints} vs M3 ${controlSol.peakScenePoints})`,
  ).toBeLessThanOrEqual(controlSol.peakScenePoints);

  // The redundant layer is genuinely gone, not merely quieter: the HYG monolith draws in the
  // control's peak frame and must NOT draw in M4a's. Without this, both totals could fall for
  // an unrelated reason and the relation would still hold vacuously.
  const monolithRow = (controlSol.peakScenePointsBreakdown ?? []).some((x) => x.points === 109_399);
  const m4aHasMonolith = (result.segments.toSol.peakScenePointsBreakdown ?? []).some(
    (x) => x.points === 109_399,
  );
  expect(monolithRow, 'M3 control draws the HYG monolith near Sol').toBe(true);
  expect(m4aHasMonolith, 'M4a culls the HYG monolith near Sol (ADR-006 SS5.2)').toBe(false);

  // TASK-093 acceptance #2: the drop must come from CULLING off-frustum tiles, not from
  // blanking the field. In-view tiles the camera faces must still draw.
  expect(
    nearSolScenePoints,
    'near-Sol scene points > 0 (in-frustum tiles still draw — not an empty-field win)',
  ).toBeGreaterThan(0);

  expect(pageErrors, 'no uncaught errors during the flythrough').toHaveLength(0);
});
