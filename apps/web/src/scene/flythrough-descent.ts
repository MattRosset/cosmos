import type { BodyId, GalaxyRecord, UniversePosition } from '@cosmos/core-types';
import type { ScaleFrameTree } from '@cosmos/coords';
import type { FlightController } from '@cosmos/nav';
import { systemFeed } from '../glue/system-feed';
import rawPath from './flythrough3-path.json';

/**
 * TASK-041 — the recorded-flythrough camera path replayer (§5.8), shared by the
 * `?debug=flythrough3` perf probe and the `?debug=soak3` memory-soak probe.
 *
 * The path lives in the committed `flythrough3-path.json`. It is replayed as
 * discrete per-context `goTo` legs through the REAL `@cosmos/nav` controller and
 * the SHIPPED streaming pipeline (this gate measures the shipped pipeline, like
 * TASK-030/TASK-040 — not an isolated harness). Issuing one leg per scale context
 * (cancel + re-issue on each boundary, anchoring tree FIRST then nav — TASK-037)
 * mirrors M3DescentProbe and avoids depending on cross-context goTo target
 * survival for the forward descent.
 *
 * The clock is paused by the host App, so the legs are deterministic: the camera
 * path is the only thing moving, and orbits cannot contaminate frame deltas.
 *
 * `loops`:
 *   - 0 (perf probe) — descend universe → galaxy → system → Earth once, then DONE.
 *   - N (soak probe) — after Earth, fly the reverse legs back out to the universe
 *     (system → galaxy → universe), then descend again; repeat for N full
 *     down-and-back cycles. Each cycle loads the Milky Way streaming tier on entry
 *     and evicts it on exit, exercising the load↔evict path many times (§5.8 soak).
 */

interface PathLeg {
  readonly phase: string;
  readonly to: string;
  readonly context: string;
  readonly local?: readonly [number, number, number];
  readonly arrivalDistanceM: number | 'planet';
  readonly durationMs: number;
}

interface FlythroughPathJson {
  readonly epochJD: number;
  readonly start: { readonly context: string; readonly local: readonly [number, number, number] };
  readonly legs: readonly PathLeg[];
  readonly reverse: readonly PathLeg[];
  readonly soakLoops: number;
}

const PATH = rawPath as unknown as FlythroughPathJson;

/** Sol sits at the galaxy origin (systems-sol.json star.positionPc = [0,0,0]). */
const SOL_POS: readonly [number, number, number] = [0, 0, 0];
const SOL_SYSTEM_ID: BodyId = 'sol';
const EARTH_ID: BodyId = 'sol:earth';

/** The frozen epoch the host App pins the (paused) clock to — Earth's waypoint. */
export const FLYTHROUGH3_EPOCH_JD = PATH.epochJD;
/** Default soak down-and-back cycle count (CI-relaxed; overridable via ?loops=). */
export const FLYTHROUGH3_SOAK_LOOPS = PATH.soakLoops;

export const FLYTHROUGH3_START: UniversePosition = {
  context: PATH.start.context as UniversePosition['context'],
  local: [PATH.start.local[0], PATH.start.local[1], PATH.start.local[2]],
};

const LEG_TO_GALAXY = PATH.legs[0]!;
const LEG_TO_SOL = PATH.legs[1]!;
const LEG_TO_EARTH = PATH.legs[2]!;
const LEG_OUT_TO_GALAXY = PATH.reverse[0]!;
const LEG_OUT_TO_UNIVERSE = PATH.reverse[1]!;

/** Planet-arrival distance (matches glue/goto + M3DescentProbe planetArrivalM). */
function planetArrivalM(radiusKm: number): number {
  return Math.max(8 * radiusKm * 1000, 5e6);
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

export type DescentPhase =
  | 'idle'
  | 'toGalaxy'
  | 'toSol'
  | 'toEarth'
  | 'outToGalaxy'
  | 'outToUniverse'
  | 'done';

export interface DescentRunner {
  /** Issue the first leg (call once, after warm-up). */
  start(): void;
  /** Advance the state machine. Call once per frame AFTER nav has updated. */
  tick(): void;
  readonly phase: DescentPhase;
  /** Completed down-and-back cycles (soak only). */
  readonly loopsCompleted: number;
  readonly done: boolean;
}

export interface DescentRunnerOptions {
  readonly flight: FlightController;
  readonly tree: ScaleFrameTree;
  readonly milkyWay: GalaxyRecord;
  readonly earthArrivalM: number;
  /** 0 = single descent (perf); N = N down-and-back cycles (soak). */
  readonly loops: number;
}

export function createDescentRunner(opts: DescentRunnerOptions): DescentRunner {
  const { flight, tree, milkyWay, earthArrivalM, loops } = opts;
  let phase: DescentPhase = 'idle';
  let loopsCompleted = 0;

  function anchorGalaxy(): void {
    const p = milkyWay.positionMpc;
    tree.setAnchor('galaxy', [p[0], p[1], p[2]]);
    flight.setGalaxyAnchor({ id: milkyWay.id, positionMpc: [p[0], p[1], p[2]] });
  }

  function anchorSystem(): void {
    tree.setAnchor('system', [SOL_POS[0], SOL_POS[1], SOL_POS[2]]);
    flight.setSystemAnchor({ id: SOL_SYSTEM_ID, positionPc: [SOL_POS[0], SOL_POS[1], SOL_POS[2]] });
  }

  /** Begin (or restart, on a soak loop) the descent toward the Milky Way. */
  function beginDescent(): void {
    anchorGalaxy();
    const p = milkyWay.positionMpc;
    flight.goTo({
      target: { context: 'universe', local: [p[0], p[1], p[2]] },
      arrivalDistanceM: LEG_TO_GALAXY.arrivalDistanceM as number,
      durationMs: LEG_TO_GALAXY.durationMs,
    });
    phase = 'toGalaxy';
  }

  function start(): void {
    beginDescent();
  }

  function tick(): void {
    switch (phase) {
      case 'toGalaxy':
        if (flight.contextId === 'galaxy') {
          flight.cancelGoTo();
          anchorSystem();
          flight.goTo({
            target: { context: 'galaxy', local: [SOL_POS[0], SOL_POS[1], SOL_POS[2]] },
            arrivalDistanceM: LEG_TO_SOL.arrivalDistanceM as number,
            durationMs: LEG_TO_SOL.durationMs,
          });
          phase = 'toSol';
        }
        break;

      case 'toSol':
        if (flight.contextId === 'system') {
          const target = liveEarthPosition();
          if (target !== null) {
            flight.cancelGoTo();
            flight.goTo({
              target,
              arrivalDistanceM: earthArrivalM,
              durationMs: LEG_TO_EARTH.durationMs,
            });
            phase = 'toEarth';
          }
        }
        break;

      case 'toEarth':
        if (!flight.goToActive) {
          if (loops > 0) {
            // Reverse: fly back out to the galaxy (system → galaxy switch).
            flight.cancelGoTo();
            flight.goTo({
              target: { context: 'galaxy', local: [...LEG_OUT_TO_GALAXY.local!] },
              arrivalDistanceM: LEG_OUT_TO_GALAXY.arrivalDistanceM as number,
              durationMs: LEG_OUT_TO_GALAXY.durationMs,
            });
            phase = 'outToGalaxy';
          } else {
            phase = 'done';
          }
        }
        break;

      case 'outToGalaxy':
        if (flight.contextId === 'galaxy') {
          // Fly past the galaxy exit gate (galaxy → universe switch).
          flight.cancelGoTo();
          flight.goTo({
            target: { context: 'galaxy', local: [...LEG_OUT_TO_UNIVERSE.local!] },
            arrivalDistanceM: LEG_OUT_TO_UNIVERSE.arrivalDistanceM as number,
            durationMs: LEG_OUT_TO_UNIVERSE.durationMs,
          });
          phase = 'outToUniverse';
        }
        break;

      case 'outToUniverse':
        if (flight.contextId === 'universe') {
          loopsCompleted += 1;
          if (loopsCompleted >= loops) {
            flight.cancelGoTo();
            phase = 'done';
          } else {
            flight.cancelGoTo();
            beginDescent();
          }
        }
        break;

      case 'idle':
      case 'done':
        break;
    }
  }

  return {
    start,
    tick,
    get phase() {
      return phase;
    },
    get loopsCompleted() {
      return loopsCompleted;
    },
    get done() {
      return phase === 'done';
    },
  };
}

/** Resolve Earth's arrival distance from the combined source's radius (or fallback). */
export function resolveEarthArrivalM(radiusKm: number): number {
  return planetArrivalM(radiusKm);
}

export { EARTH_ID };
