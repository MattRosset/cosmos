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
  FLYTHROUGH3_SOAK_LOOPS,
} from './flythrough-descent';

/**
 * TASK-041 — the memory-soak probe (`?debug=soak3`, §5.8 / §6).
 *
 * Loops the committed recorded flythrough path back and forth (universe → galaxy
 * → system → Earth, then back out) for `loops` full down-and-back cycles — each
 * cycle loads the Milky Way streaming tier on entry and evicts it on exit, so a
 * leak would compound over many load↔evict cycles. The 10-min soak is the
 * reference run on the MANUAL matrix; CI runs a shorter, documented loop count
 * (FLYTHROUGH3_SOAK_LOOPS, overridable via `?loops=`) that still exercises the
 * load↔evict path many times.
 *
 * Every ~5 s it samples `performance.memory.usedJSHeapSize` (Chromium) and the
 * live `streaming.stats.loadedChunks` onto `window.__soak3Result`; every frame it
 * folds the streaming counters into a `churn` summary. The PASS rule lives in
 * e2e/tests/soak3.spec.ts: a linear regression over the SECOND HALF of the heap
 * samples stays flat (the heap plateaus, no monotonic growth), AND the tier
 * actively loads/releases — `requestsIssued` is large and `inFlight` oscillates
 * while the ready set stays bounded (eviction keeps pace; §5.8 "not just growing").
 */

const WARMUP_FRAMES = 90;
/** Heap + loadedChunks sampling cadence. */
const SAMPLE_INTERVAL_MS = 5000;
/** Hard wall-clock safety cap so a stuck run cannot hang the page forever. */
const MAX_WALL_MS = 12 * 60 * 1000;

/** Per-frame streaming-churn summary — the signal that proves active load↔evict. */
export interface SoakChurn {
  /** Min/max in-flight requests over the soak (oscillates ⇒ active streaming). */
  readonly inFlightMin: number;
  readonly inFlightMax: number;
  /** Min/max ready-chunk count (stays bounded ⇒ not accumulating). */
  readonly loadedMin: number;
  readonly loadedMax: number;
  /** Peak rendered points (bounded by the point budget). */
  readonly renderedMax: number;
  /** Total tile requests issued — large ⇒ the tier is loading, not idle. */
  readonly requestsIssued: number;
}

export interface Soak3Result {
  readonly heapSamples: readonly number[];
  readonly loadedChunksSamples: readonly number[];
  readonly churn: SoakChurn;
  readonly loops: number;
  readonly durationMs: number;
  /** True once the run finished (all loops, or the wall-clock safety cap). */
  readonly done: boolean;
}

declare global {
  interface Window {
    __soak3Result?: Soak3Result;
    __soak3Live?: { loopsCompleted: number; samples: number };
  }
}

function usedJSHeapSize(): number | null {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return mem ? mem.usedJSHeapSize : null;
}

interface SoakProbeProps {
  readonly origin: OriginManager;
  readonly tree: ScaleFrameTree;
  readonly combined: CombinedSource;
  readonly milkyWay: GalaxyRecord;
  readonly streaming: StreamingPolicy;
  /** Down-and-back cycle count (default FLYTHROUGH3_SOAK_LOOPS). */
  readonly loops?: number;
  onController(controller: FlightController): void;
  onContextSwitch(event: ContextSwitchEvent): void;
}

export function SoakProbe({
  origin,
  tree,
  combined,
  milkyWay,
  streaming,
  loops,
  onController,
  onContextSwitch,
}: SoakProbeProps): null {
  const flight = useFlightController({
    origin,
    initial: { position: FLYTHROUGH3_START, orientation: [0, 0, 0, 1] },
  });

  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  const loopTarget = loops ?? FLYTHROUGH3_SOAK_LOOPS;

  const earthArrivalM = useMemo(() => {
    const body = combined.getBody(EARTH_ID);
    const radiusKm = body !== undefined && body.kind === 'planet' ? body.radiusKm : 6371;
    return resolveEarthArrivalM(radiusKm);
  }, [combined]);

  const runner = useMemo(
    () => createDescentRunner({ flight, tree, milkyWay, earthArrivalM, loops: loopTarget }),
    [flight, tree, milkyWay, earthArrivalM, loopTarget],
  );

  const run = useRef({
    frame: 0,
    started: false,
    startedAt: 0,
    lastSampleAt: 0,
    heapSamples: [] as number[],
    loadedChunksSamples: [] as number[],
    published: false,
    churn: {
      inFlightMin: Infinity,
      inFlightMax: 0,
      loadedMin: Infinity,
      loadedMax: 0,
      renderedMax: 0,
      requestsIssued: 0,
    },
  });

  useEffect(() => {
    onController(flight);
  }, [flight, onController]);

  useEffect(
    () =>
      flight.onContextSwitch((event) => {
        onContextSwitch(event);
      }),
    [flight, onContextSwitch],
  );

  useFrame(() => {
    const r = run.current;
    if (r.published) return;

    // Manual render (positive-priority useFrame disabled R3F auto-render).
    gl.render(scene, camera);

    const now = performance.now();
    r.frame += 1;

    // Warm-up gate before the loop begins (exposure + first chunk settle).
    if (!r.started) {
      if (r.frame < WARMUP_FRAMES) return;
      r.started = true;
      r.startedAt = now;
      r.lastSampleAt = now;
      runner.start();
      return;
    }

    runner.tick();

    // Fold the per-frame streaming counters into the churn summary.
    {
      const s = streaming.stats;
      const c = r.churn;
      c.inFlightMin = Math.min(c.inFlightMin, s.inFlight);
      c.inFlightMax = Math.max(c.inFlightMax, s.inFlight);
      c.loadedMin = Math.min(c.loadedMin, s.loadedChunks);
      c.loadedMax = Math.max(c.loadedMax, s.loadedChunks);
      c.renderedMax = Math.max(c.renderedMax, s.renderedPoints);
      c.requestsIssued += s.requestsThisFrame;
    }

    // Sample heap + loadedChunks every ~5 s.
    if (now - r.lastSampleAt >= SAMPLE_INTERVAL_MS) {
      r.lastSampleAt = now;
      const heap = usedJSHeapSize();
      if (heap !== null) r.heapSamples.push(heap);
      r.loadedChunksSamples.push(streaming.stats.loadedChunks);
      window.__soak3Live = {
        loopsCompleted: runner.loopsCompleted,
        samples: r.loadedChunksSamples.length,
      };
    }

    // Finish on completion or the wall-clock safety cap.
    if (runner.done || now - r.startedAt >= MAX_WALL_MS) {
      window.__soak3Result = {
        heapSamples: r.heapSamples.slice(),
        loadedChunksSamples: r.loadedChunksSamples.slice(),
        churn: { ...r.churn },
        loops: runner.loopsCompleted,
        durationMs: now - r.startedAt,
        done: true,
      };
      r.published = true;
    }
  }, 100);

  return null;
}
