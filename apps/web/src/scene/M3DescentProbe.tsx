import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { BodyId, UniversePosition } from '@cosmos/core-types';
import type { OriginManager, ScaleFrameTree } from '@cosmos/coords';
import type { CombinedSource } from '@cosmos/data';
import type { GalaxyRecord } from '@cosmos/core-types';
import {
  useFlightController,
  type ContextSwitchEvent,
  type FlightController,
} from '@cosmos/nav';
import { systemFeed } from '../glue/system-feed';

/**
 * TASK-040 — M3 acceptance probe (`?debug=m3`): the signature continuous zoom.
 * Like the TASK-030 ctxswitch probe, it drives the REAL nav controller through the
 * SHIPPED pipeline — but one scale up and end to end: from outside the Milky Way
 * (universe context) down to an Earth-surface approach, crossing universe→galaxy
 * and galaxy→system with NO loading screen.
 *
 * Script (clock PAUSED so orbits cannot contaminate the frame deltas):
 *   1. Start ~0.6 Mpc from the Milky Way (universe), facing it.
 *   2. After warm-up: anchor the Milky Way (tree FIRST, then nav — TASK-037) and
 *      `goTo` its centre with an arrival inside the 50 kpc enter gate → the
 *      universe→galaxy switch fires.
 *   3. On reaching galaxy context: cancel + anchor Sol (galaxy origin) and `goTo`
 *      Sol with an arrival inside the 5,000 AU enter gate → the galaxy→system switch.
 *   4. On reaching system context: `goTo` Earth's live position (surface-ish arrival).
 *   5. On arrival: finish.
 *
 * The descent is issued as discrete per-context legs (cancel + re-issue on each
 * switch) rather than one goTo spanning two boundaries, so it does not depend on
 * cross-context goTo target survival.
 *
 * Every frame is rendered MANUALLY (positive-priority useFrame ⇒ R3F hands over the
 * loop) and then sampled at 160×90: the mean abs delta vs the previous frame (the
 * TASK-030 switch-invisibility yardstick), and whether the frame is uniformly the
 * background colour (the "no blank frame at any boundary" gate). Results land on
 * `window.__m3Result`; live phase/switch progress on `window.__m3Live`.
 */

const SOL_POS: readonly [number, number, number] = [0, 0, 0];
const SOL_SYSTEM_ID: BodyId = 'sol';
const EARTH_ID: BodyId = 'sol:earth';

/** Start ~0.6 Mpc from the Milky Way on +Z, identity orientation looks down −Z. */
export const M3_START: UniversePosition = { context: 'universe', local: [0, 0, 0.6] };

/** Galaxy arrival ≈ 32 kpc (1e21 m) — inside the 50 kpc (1.543e21 m) enter gate. */
const GALAXY_ARRIVAL_M = 1e21;
/** Host arrival (matches glue/goto HOST_ARRIVAL_M) — inside the 5,000 AU enter gate. */
const HOST_ARRIVAL_M = 5e14;

const WARMUP_FRAMES = 90;
/** Frames after goTo starts before perf samples count (shader/GPU settle). */
const MEASURE_START_FRAME = 30;
const SAMPLE_W = 160;
const SAMPLE_H = 90;
/** Per-channel deviation above which a pixel counts as "not background" (0–255). */
const BLANK_CHANNEL_EPS = 10;
/** Mean abs channel delta below which a uniform frame counts as a static blank hold. */
const STATIC_BLANK_DELTA = 0.02;

/** Scene background colour (App `<color>` '#02030a'), 0–255 per channel. */
const BG_R = 0x02;
const BG_G = 0x03;
const BG_B = 0x0a;

function planetArrivalM(radiusKm: number): number {
  return Math.max(8 * radiusKm * 1000, 5e6);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export interface M3Result {
  /** Context switches in order — expect ['universe->galaxy', 'galaxy->system']. */
  readonly switches: readonly ContextSwitchEvent[];
  /** Mean abs pixel delta on the universe→galaxy / galaxy→system switch frames. */
  readonly enterGalaxyDelta: number;
  readonly enterSystemDelta: number;
  readonly medianFlightDelta: number;
  readonly maxFlightDelta: number;
  readonly maxFrameMs: number;
  /** Per-frame wall times during the descent (ms), for the CI perf smoke. */
  readonly frameTimesMs: readonly number[];
  /** Static blank holds on context-switch frames — must be 0 (loading screens). */
  readonly blankFrames: number;
  readonly frames: number;
  readonly finalContext: string;
  readonly finalAnchor: string | null;
}

export interface M3Live {
  readonly phase: Phase;
  readonly switchCount: number;
}

declare global {
  interface Window {
    __m3Result?: M3Result;
    __m3Live?: M3Live;
  }
}

type Phase = 'warmup' | 'toGalaxy' | 'toSol' | 'toEarth' | 'done';

function publishLive(phase: Phase, switchCount: number): void {
  window.__m3Live = { phase, switchCount };
}

interface M3DescentProbeProps {
  readonly origin: OriginManager;
  readonly tree: ScaleFrameTree;
  readonly combined: CombinedSource;
  readonly milkyWay: GalaxyRecord;
  onController(controller: FlightController): void;
  onContextSwitch(event: ContextSwitchEvent): void;
}

export function M3DescentProbe({
  origin,
  tree,
  combined,
  milkyWay,
  onController,
  onContextSwitch,
}: M3DescentProbeProps): null {
  const flight = useFlightController({
    origin,
    initial: { position: M3_START, orientation: [0, 0, 0, 1] },
  });

  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  const earthArrivalM = useMemo(() => {
    const body = combined.getBody(EARTH_ID);
    const radiusKm = body !== undefined && body.kind === 'planet' ? body.radiusKm : 6371;
    return planetArrivalM(radiusKm);
  }, [combined]);

  const sampler = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_W;
    canvas.height = SAMPLE_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return { canvas, ctx };
  }, []);

  const run = useRef({
    phase: 'warmup' as Phase,
    frame: 0,
    started: false,
    lastNow: 0,
    maxFrameMs: 0,
    frameTimesMs: [] as number[],
    prev: null as Uint8ClampedArray | null,
    flightDeltas: [] as number[],
    switchDeltas: [] as number[],
    switches: [] as ContextSwitchEvent[],
    switchThisFrame: false,
    blankFrames: 0,
  });

  useEffect(() => {
    onController(flight);
  }, [flight, onController]);

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

  useFrame(() => {
    const r = run.current;
    if (r.phase === 'done') return;

    // 1. Manual render (positive-priority useFrame disabled R3F auto-render).
    gl.render(scene, camera);

    // 2. Raw frame time.
    const now = performance.now();
    if (r.started && r.lastNow > 0 && r.frame >= MEASURE_START_FRAME) {
      const dt = now - r.lastNow;
      r.maxFrameMs = Math.max(r.maxFrameMs, dt);
      r.frameTimesMs.push(dt);
    }
    r.lastNow = now;
    r.frame += 1;

    // 3. Warm-up gate: begin the script + sampling once exposure has settled.
    if (!r.started) {
      if (r.frame < WARMUP_FRAMES) return;
      r.started = true;
      r.frame = 0;
      // Anchor the Milky Way (tree FIRST, then nav — TASK-037) and fly toward it.
      const p = milkyWay.positionMpc;
      tree.setAnchor('galaxy', [p[0], p[1], p[2]]);
      flight.setGalaxyAnchor({ id: milkyWay.id, positionMpc: p });
      flight.goTo({
        target: { context: 'universe', local: [p[0], p[1], p[2]] },
        arrivalDistanceM: GALAXY_ARRIVAL_M,
      });
      r.phase = 'toGalaxy';
      publishLive(r.phase, r.switches.length);
    }

    // 4. Sample the rendered frame: delta vs the previous frame + blank detection.
    const forced = r.switchThisFrame;
    const { ctx } = sampler;
    if (ctx !== null) {
      ctx.drawImage(gl.domElement, 0, 0, SAMPLE_W, SAMPLE_H);
      const data = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
      const prev = r.prev;
      let nonBg = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i]! - BG_R) > BLANK_CHANNEL_EPS ||
          Math.abs(data[i + 1]! - BG_G) > BLANK_CHANNEL_EPS ||
          Math.abs(data[i + 2]! - BG_B) > BLANK_CHANNEL_EPS
        ) {
          nonBg++;
          break;
        }
      }
      if (prev !== null) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += Math.abs(data[i]! - prev[i]!);
        const delta = sum / data.length;
        if (forced) r.switchDeltas.push(delta);
        else r.flightDeltas.push(delta);
        // Loading screens freeze on a static full-background frame at a boundary.
        if (forced && nonBg === 0 && delta < STATIC_BLANK_DELTA) r.blankFrames += 1;
      }
      r.prev = new Uint8ClampedArray(data);
    }
    r.switchThisFrame = false;

    // 5. Advance the scripted descent — discrete per-context legs.
    if (r.phase === 'toGalaxy') {
      if (flight.contextId === 'galaxy') {
        flight.cancelGoTo();
        tree.setAnchor('system', [SOL_POS[0], SOL_POS[1], SOL_POS[2]]);
        flight.setSystemAnchor({ id: SOL_SYSTEM_ID, positionPc: SOL_POS });
        flight.goTo({
          target: { context: 'galaxy', local: [SOL_POS[0], SOL_POS[1], SOL_POS[2]] },
          arrivalDistanceM: HOST_ARRIVAL_M,
        });
        r.phase = 'toSol';
        publishLive(r.phase, r.switches.length);
      }
    } else if (r.phase === 'toSol') {
      if (flight.contextId === 'system') {
        const target = liveEarthPosition();
        if (target !== null) {
          flight.cancelGoTo();
          flight.goTo({ target, arrivalDistanceM: earthArrivalM });
          r.phase = 'toEarth';
          publishLive(r.phase, r.switches.length);
        }
      }
    } else if (r.phase === 'toEarth') {
      if (!flight.goToActive) {
        finish(r, flight);
        r.phase = 'done';
        publishLive(r.phase, r.switches.length);
      }
    }
  }, 100);

  return null;
}

/** Earth's live (frozen-epoch) absolute system position, or null if not built. */
function liveEarthPosition(): UniversePosition | null {
  if (!systemFeed.active) return null;
  const idx = systemFeed.indexById.get(EARTH_ID);
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

function finish(
  r: {
    frame: number;
    maxFrameMs: number;
    frameTimesMs: number[];
    flightDeltas: number[];
    switchDeltas: number[];
    switches: ContextSwitchEvent[];
    blankFrames: number;
  },
  flight: FlightController,
): void {
  const sorted = [...r.flightDeltas].sort((a, b) => a - b);
  window.__m3Result = {
    switches: r.switches.slice(),
    enterGalaxyDelta: r.switchDeltas[0] ?? Number.NaN,
    enterSystemDelta: r.switchDeltas[1] ?? Number.NaN,
    medianFlightDelta: median(r.flightDeltas),
    maxFlightDelta: sorted[sorted.length - 1] ?? 0,
    maxFrameMs: r.maxFrameMs,
    frameTimesMs: r.frameTimesMs.slice(),
    blankFrames: r.blankFrames,
    frames: r.frame,
    finalContext: flight.contextId,
    finalAnchor: flight.systemAnchor?.id ?? null,
  };
}
