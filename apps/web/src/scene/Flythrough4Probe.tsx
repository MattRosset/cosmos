import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { GalaxyRecord } from '@cosmos/core-types';
import type { OriginManager, ScaleFrameTree } from '@cosmos/coords';
import type { CombinedSource } from '@cosmos/data';
import {
  useFlightController,
  type ContextSwitchEvent,
  type FlightController,
} from '@cosmos/nav';
import type { StreamingPolicy } from '@cosmos/streaming';
import {
  createDescentRunner,
  resolveEarthArrivalM,
  EARTH_ID,
  FLYTHROUGH3_START,
  type DescentPhase,
} from './flythrough-descent';
import { procgenOpacityHolder } from '../glue/test-hook';
import { buildProfileResult, type BreadcrumbProfileResult } from '../glue/frame-profiler';

/**
 * TASK-053 — the tier-unification budget probe (`?debug=flythrough4`, ADR-006 §5.4).
 *
 * The headline M4a acceptance measurement. It replays the SAME committed recorded
 * camera path as `?debug=flythrough3` (flythrough3-path.json: outside the Milky Way
 * → spiral arms → star field → Sol → Earth) but against the M4a composition — the
 * COMBINED HYG + Gaia octree streamed through ONE policy, the coverage-driven
 * procgen fade, the gated HYG monolith, the overlays + Earth atmosphere. Because
 * the path is byte-identical to the M3 baseline (flythrough4-m3-baseline.json,
 * recorded by the same probe with `?baseline=m3`), the near-Sol segment is a
 * like-for-like comparison.
 *
 * Per descent PHASE (toGalaxy / toSol / toEarth — the path's coarse segments) it
 * records the streaming peak (renderedPoints, drawCalls, inFlight, loadedChunks),
 * the catalogCoverage / procgenOpacity range, and the frame-time distribution.
 * The "near Sol" segment for the §5.4 gate is `toSol` + `toEarth` (the inner path,
 * where M3 overlapped three star layers). The result lands on
 * `window.__flythrough4Result`.
 *
 * BUG-4 (universe-view lag): the probe additionally captures the per-segment frame
 * timings (so the universe / far-out `toGalaxy` segment is isolated) and, when the
 * breadcrumb span profiler is active (it is, under this debug mode — see App.tsx
 * FLYTHROUGH4_PROFILE), folds the `profileSpan` span stats onto the result so the
 * dominant span in each segment is visible without a second run.
 *
 * Manual render: a positive-priority useFrame makes R3F hand over the loop (all
 * PRIORITY_* ≤ 0 subscribers — nav, coords, streaming, the render mounts — have run
 * by then), so the measured delta is the true frame cost of the shipped pipeline.
 */

const WARMUP_FRAMES = 90;
const MEASURE_START_FRAME = 30;
const LONG_FRAME_MS = 50;
const SAMPLE_INTERVAL_MS = 1000;
const FRAME_CAPACITY = 8192;

/** The path's coarse segments. "near Sol" (the §5.4 gate) = toSol + toEarth. */
export type SegmentKey = 'toGalaxy' | 'toSol' | 'toEarth';
const SEGMENT_KEYS: readonly SegmentKey[] = ['toGalaxy', 'toSol', 'toEarth'];

/** Map the descent runner's phase to a recorded segment (null = not measuring). */
function segmentForPhase(phase: DescentPhase): SegmentKey | null {
  if (phase === 'toGalaxy' || phase === 'toSol' || phase === 'toEarth') return phase;
  return null;
}

export interface SegmentStats {
  readonly frames: number;
  readonly p50: number;
  readonly p95: number;
  readonly maxFrameMs: number;
  readonly longFrames: number;
  /** Peak streaming work observed while in this segment. */
  readonly peakRenderedPoints: number;
  readonly peakDrawCalls: number;
  readonly peakInFlight: number;
  readonly peakLoadedChunks: number;
  /**
   * Peak TOTAL scene draw calls / points (`gl.info.render`) while in this segment —
   * the WHOLE composition, incl. the HYG monolith that StarScene draws outside the
   * streaming stats. This is the metric the §5.4 near-Sol drop compares (BUG-4 gate
   * fix): M3 always draws the monolith (+1 call, +~109k pts), M4a culls it once the
   * octree covers the cut, so M4a's near-Sol scene totals come in BELOW M3's. The
   * streaming-only peakRenderedPoints/peakDrawCalls above cannot see the monolith.
   */
  readonly peakSceneDrawCalls: number;
  readonly peakScenePoints: number;
  /** Total tile requests issued while in this segment (streaming churn). */
  readonly requestsIssued: number;
  /** catalogCoverage range over the segment. */
  readonly minCoverage: number;
  readonly maxCoverage: number;
  /** procgen-cloud opacity range over the segment (→ 0 as coverage → 1). */
  readonly minProcgenOpacity: number;
  readonly maxProcgenOpacity: number;
}

export interface StreamingPeak {
  readonly inFlight: number;
  readonly loadedChunks: number;
  readonly renderedPoints: number;
  readonly drawCalls: number;
}

export interface Flythrough4Result {
  /** 'm3' (HYG-only baseline composition) or 'm4a' (combined HYG+Gaia). */
  readonly variant: 'm3' | 'm4a';
  readonly frames: number;
  readonly p50: number;
  readonly p95: number;
  readonly maxFrameMs: number;
  readonly longFrames: number;
  readonly heapSamples: readonly number[];
  /** Whole-run streaming peak (the §5.8 caps gate). */
  readonly streamingPeak: StreamingPeak;
  /** Per-segment breakdown (the §5.4 near-Sol gate + BUG-4 universe segment). */
  readonly segments: Readonly<Record<SegmentKey, SegmentStats>>;
  /** Coverage/opacity at the END of the descent (near Sol → coverage high, procgen ~0). */
  readonly finalCoverage: number;
  readonly finalProcgenOpacity: number;
  readonly switches: readonly ContextSwitchEvent[];
  readonly finalContext: string;
  /**
   * Breadcrumb span profile, if the span profiler was active for this run
   * (BUG-4 attribution: which `profileSpan` dominates frame time). Null otherwise.
   */
  readonly profile: BreadcrumbProfileResult | null;
}

declare global {
  interface Window {
    __flythrough4Result?: Flythrough4Result;
    __flythrough4Live?: { phase: string; segment: string; switchCount: number };
  }
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))] ?? 0;
}

function usedJSHeapSize(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize : null;
}

/** Mutable per-segment accumulator (pre-allocated; no per-frame realloc). */
interface SegmentAccum {
  frameTimesMs: Float64Array;
  frameCount: number;
  maxFrameMs: number;
  longFrames: number;
  peakRenderedPoints: number;
  peakDrawCalls: number;
  peakInFlight: number;
  peakLoadedChunks: number;
  peakSceneDrawCalls: number;
  peakScenePoints: number;
  requestsIssued: number;
  minCoverage: number;
  maxCoverage: number;
  minProcgenOpacity: number;
  maxProcgenOpacity: number;
}

function newSegmentAccum(): SegmentAccum {
  return {
    frameTimesMs: new Float64Array(FRAME_CAPACITY),
    frameCount: 0,
    maxFrameMs: 0,
    longFrames: 0,
    peakRenderedPoints: 0,
    peakDrawCalls: 0,
    peakInFlight: 0,
    peakLoadedChunks: 0,
    peakSceneDrawCalls: 0,
    peakScenePoints: 0,
    requestsIssued: 0,
    minCoverage: Infinity,
    maxCoverage: 0,
    minProcgenOpacity: Infinity,
    maxProcgenOpacity: 0,
  };
}

function finalizeSegment(a: SegmentAccum): SegmentStats {
  const frames = Array.from(a.frameTimesMs.subarray(0, a.frameCount));
  const sorted = [...frames].sort((x, y) => x - y);
  return {
    frames: frames.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    maxFrameMs: a.maxFrameMs,
    longFrames: a.longFrames,
    peakRenderedPoints: a.peakRenderedPoints,
    peakDrawCalls: a.peakDrawCalls,
    peakInFlight: a.peakInFlight,
    peakLoadedChunks: a.peakLoadedChunks,
    peakSceneDrawCalls: a.peakSceneDrawCalls,
    peakScenePoints: a.peakScenePoints,
    requestsIssued: a.requestsIssued,
    minCoverage: a.minCoverage === Infinity ? 0 : a.minCoverage,
    maxCoverage: a.maxCoverage,
    minProcgenOpacity: a.minProcgenOpacity === Infinity ? 0 : a.minProcgenOpacity,
    maxProcgenOpacity: a.maxProcgenOpacity,
  };
}

interface Flythrough4ProbeProps {
  readonly origin: OriginManager;
  readonly tree: ScaleFrameTree;
  readonly combined: CombinedSource;
  readonly milkyWay: GalaxyRecord;
  readonly streaming: StreamingPolicy;
  /** 'm3' records the baseline (HYG-only); 'm4a' is the unified composition. */
  readonly variant: 'm3' | 'm4a';
  /** Whether the breadcrumb span profiler is active (folds spans onto the result). */
  readonly profileActive: boolean;
  onController(controller: FlightController): void;
  onContextSwitch(event: ContextSwitchEvent): void;
}

export function Flythrough4Probe({
  origin,
  tree,
  combined,
  milkyWay,
  streaming,
  variant,
  profileActive,
  onController,
  onContextSwitch,
}: Flythrough4ProbeProps): null {
  const flight = useFlightController({
    origin,
    initial: { position: FLYTHROUGH3_START, orientation: [0, 0, 0, 1] },
  });

  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  const earthArrivalM = useMemo(() => {
    const body = combined.getBody(EARTH_ID);
    const radiusKm = body !== undefined && body.kind === 'planet' ? body.radiusKm : 6371;
    return resolveEarthArrivalM(radiusKm);
  }, [combined]);

  const runner = useMemo(
    () => createDescentRunner({ flight, tree, milkyWay, earthArrivalM, loops: 0 }),
    [flight, tree, milkyWay, earthArrivalM],
  );

  const run = useRef({
    frame: 0,
    started: false,
    lastNow: 0,
    maxFrameMs: 0,
    longFrames: 0,
    frameTimesMs: new Float64Array(FRAME_CAPACITY),
    frameCount: 0,
    heapSamples: [] as number[],
    lastSampleAt: 0,
    peak: { inFlight: 0, loadedChunks: 0, renderedPoints: 0, drawCalls: 0 },
    segments: {
      toGalaxy: newSegmentAccum(),
      toSol: newSegmentAccum(),
      toEarth: newSegmentAccum(),
    } as Record<SegmentKey, SegmentAccum>,
    finalCoverage: 0,
    finalProcgenOpacity: 1,
    switches: [] as ContextSwitchEvent[],
    published: false,
  });

  useEffect(() => {
    onController(flight);
  }, [flight, onController]);

  useEffect(
    () =>
      flight.onContextSwitch((event) => {
        const r = run.current;
        r.switches.push(event);
        window.__flythrough4Live = {
          phase: runner.phase,
          segment: segmentForPhase(runner.phase) ?? '-',
          switchCount: r.switches.length,
        };
        onContextSwitch(event);
      }),
    [flight, onContextSwitch, runner],
  );

  useFrame(() => {
    const r = run.current;
    if (r.published) return;

    // 1. Manual render (positive-priority useFrame disabled R3F auto-render).
    gl.render(scene, camera);
    // TOTAL scene draw work for THIS frame (gl.info.render auto-resets per render()).
    // Captures the whole composition — incl. the HYG monolith StarScene draws outside
    // the streaming stats — so the §5.4 near-Sol drop can see the unification (BUG-4).
    const sceneDrawCalls = gl.info.render.calls;
    const scenePoints = gl.info.render.points;

    // 2. Raw frame time (whole run).
    const now = performance.now();
    let dt = 0;
    let measuring = false;
    if (r.started && r.lastNow > 0 && r.frame >= MEASURE_START_FRAME) {
      dt = now - r.lastNow;
      measuring = true;
      r.maxFrameMs = Math.max(r.maxFrameMs, dt);
      if (r.frameCount < FRAME_CAPACITY) r.frameTimesMs[r.frameCount++] = dt;
      if (dt > LONG_FRAME_MS) r.longFrames += 1;
    }
    r.lastNow = now;
    r.frame += 1;

    // 3. Warm-up gate.
    if (!r.started) {
      if (r.frame < WARMUP_FRAMES) return;
      r.started = true;
      r.frame = 0;
      r.lastSampleAt = now;
      runner.start();
      window.__flythrough4Live = {
        phase: runner.phase,
        segment: segmentForPhase(runner.phase) ?? '-',
        switchCount: r.switches.length,
      };
      return;
    }

    // 4. Advance the descent.
    runner.tick();

    // 5. Whole-run streaming peak + heap sampling.
    const st = streaming.stats;
    r.peak.inFlight = Math.max(r.peak.inFlight, st.inFlight);
    r.peak.loadedChunks = Math.max(r.peak.loadedChunks, st.loadedChunks);
    r.peak.renderedPoints = Math.max(r.peak.renderedPoints, st.renderedPoints);
    r.peak.drawCalls = Math.max(r.peak.drawCalls, st.drawCalls);

    const coverage = streaming.catalogCoverage();
    const procgenOpacity = procgenOpacityHolder.current;
    r.finalCoverage = coverage;
    r.finalProcgenOpacity = procgenOpacity;

    if (now - r.lastSampleAt >= SAMPLE_INTERVAL_MS) {
      r.lastSampleAt = now;
      const heap = usedJSHeapSize();
      if (heap !== null) r.heapSamples.push(heap);
    }

    // 6. Per-segment accumulation (the §5.4 near-Sol gate + BUG-4 universe segment).
    const seg = segmentForPhase(runner.phase);
    if (seg !== null) {
      const a = r.segments[seg];
      if (measuring && a.frameCount < FRAME_CAPACITY) {
        a.frameTimesMs[a.frameCount++] = dt;
        a.maxFrameMs = Math.max(a.maxFrameMs, dt);
        if (dt > LONG_FRAME_MS) a.longFrames += 1;
      }
      a.peakRenderedPoints = Math.max(a.peakRenderedPoints, st.renderedPoints);
      a.peakDrawCalls = Math.max(a.peakDrawCalls, st.drawCalls);
      a.peakInFlight = Math.max(a.peakInFlight, st.inFlight);
      a.peakLoadedChunks = Math.max(a.peakLoadedChunks, st.loadedChunks);
      a.peakSceneDrawCalls = Math.max(a.peakSceneDrawCalls, sceneDrawCalls);
      a.peakScenePoints = Math.max(a.peakScenePoints, scenePoints);
      a.requestsIssued += st.requestsThisFrame;
      a.minCoverage = Math.min(a.minCoverage, coverage);
      a.maxCoverage = Math.max(a.maxCoverage, coverage);
      a.minProcgenOpacity = Math.min(a.minProcgenOpacity, procgenOpacity);
      a.maxProcgenOpacity = Math.max(a.maxProcgenOpacity, procgenOpacity);
    }

    window.__flythrough4Live = {
      phase: runner.phase,
      segment: seg ?? '-',
      switchCount: r.switches.length,
    };

    // 7. Publish on completion.
    if (runner.done) {
      const frames = Array.from(r.frameTimesMs.subarray(0, r.frameCount));
      const sorted = [...frames].sort((x, y) => x - y);
      const segments = {} as Record<SegmentKey, SegmentStats>;
      for (const key of SEGMENT_KEYS) segments[key] = finalizeSegment(r.segments[key]);
      window.__flythrough4Result = {
        variant,
        frames: frames.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        maxFrameMs: r.maxFrameMs,
        longFrames: r.longFrames,
        heapSamples: r.heapSamples.slice(),
        streamingPeak: { ...r.peak },
        segments,
        finalCoverage: r.finalCoverage,
        finalProcgenOpacity: r.finalProcgenOpacity,
        switches: r.switches.slice(),
        finalContext: flight.contextId,
        profile: profileActive ? buildProfileResult() : null,
      };
      window.__flythrough4Live = { phase: 'done', segment: '-', switchCount: r.switches.length };
      r.published = true;
    }
  }, 100);

  return null;
}
