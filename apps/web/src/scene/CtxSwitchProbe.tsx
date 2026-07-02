import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { BodyId, UniversePosition } from '@cosmos/core-types';
import type { OriginManager, ScaleFrameTree } from '@cosmos/coords';
import type { CombinedSource } from '@cosmos/data';
import { useFlightController } from '../glue/useFlightController';
import {
  type ContextSwitchEvent,
  type FlightController,
} from '@cosmos/nav';
import { systemFeed } from '../glue/system-feed';

/**
 * TASK-030 — Phase 2 acceptance gate: the context-switch transition probe
 * (`?debug=ctxswitch`). Where TASK-017's jitter probe ISOLATES the coords+render
 * path, this probe deliberately measures the SHIPPED pipeline: it drives the REAL
 * `@cosmos/nav` flight controller (the same `goTo` + automatic galaxy⇄system
 * switch law the HUD uses) through a scripted approach to Sol and out again, and
 * watches the rendered canvas for any frame that "stands out" at the two switches.
 *
 * Script (clock PAUSED throughout so planet motion cannot contaminate the frame
 * deltas — the probe tests CAMERA transitions, not orbits, §12):
 *   1. Camera starts 0.02 pc from Sol on +X, facing it (galaxy context).
 *   2. After 30 warm-up frames: anchor Sol and `goTo` Sol (arrival 5e14 m). The
 *      start is already inside the 7.5e14 m enter gate, so the galaxy→system
 *      switch fires on the first scripted frame — the ENTER event.
 *   3. On arrival, `goTo` Saturn's current (frozen-epoch) position with the
 *      planet-arrival distance.
 *   4. On arrival, `goTo` a far +X galaxy point so the camera crosses the
 *      1.5e15 m exit gate — the EXIT event — and the run ends.
 *
 * Every frame is rendered MANUALLY (this probe registers a `useFrame` at a
 * positive priority, which makes R3F hand over the render loop) so that, in the
 * same rAF, the freshly-rendered canvas can be down-scaled to 160×90 and diffed
 * against the IMMEDIATELY preceding frame WITHOUT needing `preserveDrawingBuffer`.
 * Each frame's mean absolute pixel delta is classified as a switch delta (when a
 * context switch fired that frame) or an ordinary flight delta; a switch delta is
 * thus a true across-switch adjacent-frame measurement, directly comparable to
 * the flight-delta distribution. The two switch deltas, the flight-delta stats,
 * the max raw frame time, and the switch events land on `window.__ctxSwitchResult`.
 *
 * The PASS rule lives in e2e/tests/ctxswitch.spec.ts: each switch delta ≤ the max
 * ordinary flight delta (see the deviation note in TASK-030-phase2-gate.md for why
 * the spec's `3 × median` degenerates on this mostly-empty descent).
 *
 * Zero cost when the flag is absent: App never mounts this probe otherwise.
 */

/** Sol sits at the galaxy origin (systems-sol.json star.positionPc = [0,0,0]). */
const SOL_POS: readonly [number, number, number] = [0, 0, 0];
const SOL_SYSTEM_ID: BodyId = 'sol';
const SATURN_ID: BodyId = 'sol:saturn';

/** Start 0.02 pc from Sol on +X (6.17e14 m — already inside the 7.5e14 enter gate). */
export const CTX_START: UniversePosition = { context: 'galaxy', local: [0.02, 0, 0] };
/** Orientation looking down −X toward Sol (rotate forward [0,0,-1] → [-1,0,0]). */
const FACING_SOL: readonly [number, number, number, number] = [
  0,
  Math.SQRT1_2,
  0,
  Math.SQRT1_2,
];

/** Host arrival (matches glue/goto HOST_ARRIVAL_M) — inside the enter gate. */
const HOST_ARRIVAL_M = 5e14;
/** Far +X galaxy point the reverse leg flies toward; 0.1 pc ≈ 3.09e15 m > exit gate. */
const EXIT_TARGET: UniversePosition = { context: 'galaxy', local: [0.1, 0, 0] };
const EXIT_ARRIVAL_M = 1e13;

/** Frames discarded before measuring, so exposure/layout settle (§ Common Mistakes). */
const WARMUP_FRAMES = 30;
/** Down-sample resolution for the per-frame diff (cheap; cross-platform stable). */
const SAMPLE_W = 160;
const SAMPLE_H = 90;

/** Planet-arrival distance (matches glue/goto planetArrivalM). */
function planetArrivalM(radiusKm: number): number {
  return Math.max(8 * radiusKm * 1000, 5e6);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export interface CtxSwitchResult {
  /** Mean abs pixel delta on the galaxy→system switch frame. */
  readonly enterFrameDelta: number;
  /** Mean abs pixel delta on the system→galaxy switch frame. */
  readonly exitFrameDelta: number;
  /** Median of the ordinary (non-switch) flight frame deltas — the yardstick. */
  readonly medianFlightDelta: number;
  /** 99th-percentile flight frame delta (diagnostic: peak ordinary motion). */
  readonly p99FlightDelta: number;
  /** Largest ordinary flight frame delta (diagnostic). */
  readonly maxFlightDelta: number;
  /** Largest raw (unclamped) frame time over the scripted run, ms. */
  readonly maxFrameMs: number;
  readonly switches: readonly ContextSwitchEvent[];
  /** Frames rendered during the measured (post-warm-up) run. */
  readonly frames: number;
}

/** Live progress for the e2e keyframe captures (the result only lands at the end). */
export interface CtxSwitchLive {
  readonly phase: Phase;
  /** Number of context switches fired so far (0, 1, or 2). */
  readonly switchCount: number;
}

declare global {
  interface Window {
    __ctxSwitchResult?: CtxSwitchResult;
    __ctxSwitchLive?: CtxSwitchLive;
  }
}

type Phase = 'warmup' | 'toSol' | 'toSaturn' | 'reverseOut' | 'done';

function publishLive(phase: Phase, switchCount: number): void {
  window.__ctxSwitchLive = { phase, switchCount };
}

interface CtxSwitchProbeProps {
  readonly origin: OriginManager;
  readonly tree: ScaleFrameTree;
  readonly combined: CombinedSource;
  /** Live controller → parent (StarScene picking + SystemScene mount wiring). */
  onController(controller: FlightController): void;
  /** Forwarded context switches → parent (React mount/unmount of the system scene). */
  onContextSwitch(event: ContextSwitchEvent): void;
}

export function CtxSwitchProbe({
  origin,
  tree,
  combined,
  onController,
  onContextSwitch,
}: CtxSwitchProbeProps): null {
  const flight = useFlightController({
    origin,
    initial: { position: CTX_START, orientation: FACING_SOL },
  });

  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  // Saturn's arrival distance is fixed (radius is static); resolve it once.
  const saturnArrivalM = useMemo(() => {
    const body = combined.getBody(SATURN_ID);
    const radiusKm = body !== undefined && body.kind === 'planet' ? body.radiusKm : 58232;
    return planetArrivalM(radiusKm);
  }, [combined]);

  // Offscreen 2D surface the canvas is down-scaled into (reused every sample).
  const sampler = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return { canvas, ctx };
  }, []);

  // All run state lives in a ref — the probe never re-renders on these.
  const run = useRef({
    phase: 'warmup' as Phase,
    frame: 0,
    started: false,
    lastNow: 0,
    maxFrameMs: 0,
    prev: null as Uint8ClampedArray | null,
    flightDeltas: [] as number[],
    switchDeltas: [] as number[],
    switches: [] as ContextSwitchEvent[],
    switchThisFrame: false,
  });

  useEffect(() => {
    onController(flight);
  }, [flight, onController]);

  // One subscription records the switch (for the probe) AND forwards it to the
  // parent (so the system scene mounts). Switches fire inside controller.update
  // at PRIORITY_NAV, i.e. BEFORE the positive-priority sampler below, same frame.
  useEffect(
    () =>
      flight.onContextSwitch((event) => {
        const r = run.current;
        r.switches.push(event);
        r.switchThisFrame = true;
        publishLive(r.phase, r.switches.length);
        onContextSwitch(event);
      }),
    [flight, onContextSwitch],
  );

  // Positive priority ⇒ R3F hands over rendering. We render manually, then read.
  useFrame(() => {
    const r = run.current;
    if (r.phase === 'done') return;

    // 1. Manual render (auto-render is disabled by this positive-priority sub).
    gl.render(scene, camera);

    // 2. Raw (unclamped) frame time.
    const now = performance.now();
    if (r.started && r.lastNow > 0) {
      r.maxFrameMs = Math.max(r.maxFrameMs, now - r.lastNow);
    }
    r.lastNow = now;
    r.frame += 1;

    // 3. Warm-up gate: begin the script + sampling once exposure has settled.
    if (!r.started) {
      if (r.frame < WARMUP_FRAMES) return;
      r.started = true;
      r.frame = 0;
      // Anchor Sol (tree FIRST, then the controller — TASK-027 precondition),
      // then fly in. The start is inside the enter gate, so the switch fires next
      // frame while the goTo is already moving the camera (honest flight motion).
      tree.setAnchor('system', [SOL_POS[0], SOL_POS[1], SOL_POS[2]]);
      flight.setSystemAnchor({ id: SOL_SYSTEM_ID, positionPc: SOL_POS });
      flight.goTo({
        target: { context: 'galaxy', local: [SOL_POS[0], SOL_POS[1], SOL_POS[2]] },
        arrivalDistanceM: HOST_ARRIVAL_M,
      });
      r.phase = 'toSol';
      publishLive(r.phase, r.switches.length);
    }

    // 4. Sample the rendered frame: mean absolute pixel delta vs the IMMEDIATELY
    //    preceding frame. A switch frame is diffed against the frame right before
    //    the switch (a true across-switch delta), so it is directly comparable to
    //    ordinary consecutive-frame flight deltas (the median yardstick).
    const forced = r.switchThisFrame;
    const { ctx } = sampler;
    if (ctx !== null) {
      ctx.drawImage(gl.domElement, 0, 0, SAMPLE_W, SAMPLE_H);
      const data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
      const prev = r.prev;
      if (prev !== null) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += Math.abs(data[i]! - prev[i]!);
        const delta = sum / data.length;
        if (forced) r.switchDeltas.push(delta);
        else r.flightDeltas.push(delta);
      }
      r.prev = new Uint8ClampedArray(data);
    }
    r.switchThisFrame = false;

    // 5. Advance the scripted approach (issued goTo takes effect next frame).
    if (r.phase === 'toSol') {
      if (!flight.goToActive && flight.contextId === 'system') {
        const target = liveSaturnPosition();
        if (target !== null) {
          flight.goTo({ target, arrivalDistanceM: saturnArrivalM });
          r.phase = 'toSaturn';
          publishLive(r.phase, r.switches.length);
        }
      }
    } else if (r.phase === 'toSaturn') {
      if (!flight.goToActive) {
        flight.goTo({ target: EXIT_TARGET, arrivalDistanceM: EXIT_ARRIVAL_M });
        r.phase = 'reverseOut';
        publishLive(r.phase, r.switches.length);
      }
    } else if (r.phase === 'reverseOut') {
      if (!flight.goToActive) {
        finish(r);
        r.phase = 'done';
        publishLive(r.phase, r.switches.length);
      }
    }
  }, 100);

  return null;
}

/** Saturn's live (frozen-epoch) absolute system position, or null if not built. */
function liveSaturnPosition(): UniversePosition | null {
  if (!systemFeed.active) return null;
  const idx = systemFeed.indexById.get(SATURN_ID);
  if (idx === undefined) return null;
  return {
    context: 'system',
    local: [
      systemFeed.positionsAu[idx * 3]!,
      systemFeed.positionsAu[idx * 3 + 1]!,
      systemFeed.positionsAu[idx * 3 + 2]!,
    ],
  };
}

function finish(r: {
  frame: number;
  maxFrameMs: number;
  flightDeltas: number[];
  switchDeltas: number[];
  switches: ContextSwitchEvent[];
}): void {
  const sorted = [...r.flightDeltas].sort((a, b) => a - b);
  const pct = (p: number): number =>
    sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
  window.__ctxSwitchResult = {
    enterFrameDelta: r.switchDeltas[0] ?? Number.NaN,
    exitFrameDelta: r.switchDeltas[1] ?? Number.NaN,
    medianFlightDelta: median(r.flightDeltas),
    p99FlightDelta: pct(99),
    maxFlightDelta: sorted[sorted.length - 1] ?? 0,
    maxFrameMs: r.maxFrameMs,
    switches: r.switches.slice(),
    frames: r.frame,
  };
}
