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
} from './flythrough-descent';

/**
 * TASK-041 — the recorded-flythrough perf probe (`?debug=flythrough3`, §5.8).
 *
 * Like the TASK-017 jitter probe and the TASK-030 ctxswitch probe, this is a
 * self-measuring debug mode so Playwright stays simple. It replays the committed
 * recorded camera path (flythrough3-path.json) once — outside the Milky Way →
 * spiral arms → star field → Sol → Earth — through the REAL nav controller +
 * SHIPPED streaming pipeline. Per frame it records the raw frame time
 * (`performance.now()` deltas); every ~1 s it samples `performance.memory`
 * (Chromium only) and the live `streaming.stats`. The result lands on
 * `window.__flythrough3Result`.
 *
 * Manual render: registering a positive-priority `useFrame` makes R3F hand over
 * the render loop (all PRIORITY_* ≤ 0 subscribers — nav, coords, streaming, the
 * render mounts — have run by then), so the measured delta is the true frame cost
 * of the shipped pipeline.
 *
 * PASS rule (asserted in e2e/tests/flythrough3.spec.ts, with the documented CI ↔
 * reference-machine split): p95 ≤ the CI-relaxed 40 ms bound AND in-flight ≤ 6
 * AND no frame past the CI software-renderer ceiling. The strict §5.8 clause
 * (≥ 55 fps, zero frame > 50 ms) is the MANUAL reference-GPU checklist item — see
 * that spec's WHY note. `longFrames` (> 50 ms) is recorded for the reference run.
 */

const WARMUP_FRAMES = 90;
/** Frames after the descent starts before perf samples count (shader/GPU settle). */
const MEASURE_START_FRAME = 30;
/**
 * §5.8 strict clause: a frame longer than this is a hitch. `longFrames` counts
 * them so the reference-GPU expectation (zero) is visible; the CI gate uses a
 * software-renderer ceiling instead, with the strict 50 ms verified on the manual
 * reference run (see e2e/tests/flythrough3.spec.ts WHY note — TASK-041 split).
 */
const LONG_FRAME_MS = 50;
/** Heap + streaming-stat sampling cadence. */
const SAMPLE_INTERVAL_MS = 1000;
/**
 * Pre-allocated frame-time capacity. The buffer is sized once and written by
 * index so the measurement loop never reallocates a growing array mid-flight —
 * a `[].push` past V8's internal capacity boundaries (≈256/512/…) injects a GC
 * hitch into the very frame being timed (observed as a lone ~50 ms spike). At
 * ~60 fps the recorded descent is ≪ this; overflow simply stops recording.
 */
const FRAME_CAPACITY = 8192;

export interface StreamingPeak {
  readonly inFlight: number;
  readonly loadedChunks: number;
  readonly renderedPoints: number;
  readonly drawCalls: number;
}

export interface Flythrough3Result {
  readonly frames: number;
  readonly frameTimesMs: readonly number[];
  readonly p50: number;
  readonly p95: number;
  readonly maxFrameMs: number;
  /** Count of frames longer than 50 ms (the §5.8 zero-tolerance clause). */
  readonly longFrames: number;
  /** `usedJSHeapSize` samples (Chromium only; empty on WebKit/Firefox). */
  readonly heapSamples: readonly number[];
  readonly streamingPeak: StreamingPeak;
  readonly switches: readonly ContextSwitchEvent[];
  readonly finalContext: string;
}

declare global {
  interface Window {
    __flythrough3Result?: Flythrough3Result;
    __flythrough3Live?: { phase: string; switchCount: number };
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

interface Flythrough3ProbeProps {
  readonly origin: OriginManager;
  readonly tree: ScaleFrameTree;
  readonly combined: CombinedSource;
  readonly milkyWay: GalaxyRecord;
  readonly streaming: StreamingPolicy;
  onController(controller: FlightController): void;
  onContextSwitch(event: ContextSwitchEvent): void;
}

export function Flythrough3Probe({
  origin,
  tree,
  combined,
  milkyWay,
  streaming,
  onController,
  onContextSwitch,
}: Flythrough3ProbeProps): null {
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
    /** Pre-allocated (no per-frame reallocation jank) — see FRAME_CAPACITY. */
    frameTimesMs: new Float64Array(FRAME_CAPACITY),
    frameCount: 0,
    heapSamples: [] as number[],
    lastSampleAt: 0,
    peak: { inFlight: 0, loadedChunks: 0, renderedPoints: 0, drawCalls: 0 } as {
      inFlight: number;
      loadedChunks: number;
      renderedPoints: number;
      drawCalls: number;
    },
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
        window.__flythrough3Live = { phase: runner.phase, switchCount: r.switches.length };
        onContextSwitch(event);
      }),
    [flight, onContextSwitch, runner],
  );

  useFrame(() => {
    const r = run.current;
    if (r.published) return;

    // 1. Manual render (positive-priority useFrame disabled R3F auto-render).
    gl.render(scene, camera);

    // 2. Raw frame time.
    const now = performance.now();
    if (r.started && r.lastNow > 0 && r.frame >= MEASURE_START_FRAME) {
      const dt = now - r.lastNow;
      r.maxFrameMs = Math.max(r.maxFrameMs, dt);
      if (r.frameCount < FRAME_CAPACITY) r.frameTimesMs[r.frameCount++] = dt;
      if (dt > LONG_FRAME_MS) r.longFrames += 1;
    }
    r.lastNow = now;
    r.frame += 1;

    // 3. Warm-up gate: begin the scripted descent once exposure has settled.
    if (!r.started) {
      if (r.frame < WARMUP_FRAMES) return;
      r.started = true;
      r.frame = 0;
      r.lastSampleAt = now;
      runner.start();
      window.__flythrough3Live = { phase: runner.phase, switchCount: r.switches.length };
      return;
    }

    // 4. Advance the descent (per-context goTo legs).
    runner.tick();

    // 5. Track the streaming peak every frame (cheap ints) + heap every ~1 s.
    const st = streaming.stats;
    r.peak.inFlight = Math.max(r.peak.inFlight, st.inFlight);
    r.peak.loadedChunks = Math.max(r.peak.loadedChunks, st.loadedChunks);
    r.peak.renderedPoints = Math.max(r.peak.renderedPoints, st.renderedPoints);
    r.peak.drawCalls = Math.max(r.peak.drawCalls, st.drawCalls);
    if (now - r.lastSampleAt >= SAMPLE_INTERVAL_MS) {
      r.lastSampleAt = now;
      const heap = usedJSHeapSize();
      if (heap !== null) r.heapSamples.push(heap);
    }

    // 6. Publish on completion.
    if (runner.done) {
      const frames = Array.from(r.frameTimesMs.subarray(0, r.frameCount));
      const sorted = [...frames].sort((a, b) => a - b);
      window.__flythrough3Result = {
        frames: frames.length,
        frameTimesMs: frames,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        maxFrameMs: r.maxFrameMs,
        longFrames: r.longFrames,
        heapSamples: r.heapSamples.slice(),
        streamingPeak: { ...r.peak },
        switches: r.switches.slice(),
        finalContext: flight.contextId,
      };
      window.__flythrough3Live = { phase: 'done', switchCount: r.switches.length };
      r.published = true;
    }
  }, 100);

  return null;
}
