import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { BodyId, GalaxyRecord, UniversePosition } from '@cosmos/core-types';
import type { OriginManager, ScaleFrameTree } from '@cosmos/coords';
import type { CombinedSource } from '@cosmos/data';
import { useFlightController } from '../glue/useFlightController';
import {
  type ContextSwitchEvent,
  type FlightController,
} from '@cosmos/nav';
import type { StreamingPolicy } from '@cosmos/streaming';
import type { ErrorCounts } from '@cosmos/diagnostics';
import { getErrorCounts } from '@cosmos/diagnostics';
import { systemFeed } from '../glue/system-feed';

/**
 * TASK-059 — error gate probe (`?debug=errorgate`). Drives the SAME scripted
 * universe → galaxy → Sol → Earth descent as `M3DescentProbe`, against the SHIPPED
 * M4a composition (combined HYG+Gaia octree, full packs), but measures none of the
 * M3 perf/pixel machinery — only the diagnostics counters TASK-058 exposed:
 *
 *   1. `getErrorCounts().total` — no silent error anywhere during the run.
 *   2. `streaming.stats.failedChunks` — no chunk backed off to terminal `failed`.
 *   3. `streaming.catalogCoverage()` — the catalog tier actually loaded near Sol.
 *
 * Settle discipline: after the Earth leg's `goTo` completes, the probe waits for
 * `SETTLE_FRAMES` consecutive frames with zero in-flight loads before snapshotting
 * — sampling mid-flight would catch a transient pending/inFlight gap, not a real
 * miss (Common Mistakes in docs/agent-tasks/TASK-059-error-gate.md). Results land
 * on `window.__errorGateResult`.
 */

const SOL_POS: readonly [number, number, number] = [0, 0, 0];
const SOL_SYSTEM_ID: BodyId = 'sol';
const EARTH_ID: BodyId = 'sol:earth';

/** Start ~0.6 Mpc from the Milky Way on +Z, identity orientation looks down −Z. */
export const ERRORGATE_START: UniversePosition = { context: 'universe', local: [0, 0, 0.6] };

/** Galaxy arrival ≈ 32 kpc (1e21 m) — inside the 50 kpc (1.543e21 m) enter gate. */
const GALAXY_ARRIVAL_M = 1e21;
/** Host arrival (matches glue/goto HOST_ARRIVAL_M) — inside the 5,000 AU enter gate. */
const HOST_ARRIVAL_M = 5e14;

const WARMUP_FRAMES = 90;
/** Consecutive zero-inFlight frames required before the post-descent snapshot is
 *  trusted — a pending/inFlight gap mid-settle would otherwise read as a false 0. */
const SETTLE_FRAMES = 30;

function planetArrivalM(radiusKm: number): number {
  return Math.max(8 * radiusKm * 1000, 5e6);
}

export interface ErrorGateResult {
  readonly errorCounts: ErrorCounts;
  readonly failedChunks: number;
  readonly catalogCoverage: number;
  readonly switches: readonly ContextSwitchEvent[];
  readonly finalContext: string;
  readonly finalAnchor: string | null;
  readonly frames: number;
}

export interface ErrorGateLive {
  readonly phase: Phase;
  readonly switchCount: number;
}

declare global {
  interface Window {
    __errorGateResult?: ErrorGateResult;
    __errorGateLive?: ErrorGateLive;
  }
}

type Phase = 'warmup' | 'toGalaxy' | 'toSol' | 'toEarth' | 'settle' | 'done';

function publishLive(phase: Phase, switchCount: number): void {
  window.__errorGateLive = { phase, switchCount };
}

interface ErrorGateProbeProps {
  readonly origin: OriginManager;
  readonly tree: ScaleFrameTree;
  readonly combined: CombinedSource;
  readonly milkyWay: GalaxyRecord;
  readonly streaming: StreamingPolicy;
  onController(controller: FlightController): void;
  onContextSwitch(event: ContextSwitchEvent): void;
}

export function ErrorGateProbe({
  origin,
  tree,
  combined,
  milkyWay,
  streaming,
  onController,
  onContextSwitch,
}: ErrorGateProbeProps): null {
  const flight = useFlightController({
    origin,
    initial: { position: ERRORGATE_START, orientation: [0, 0, 0, 1] },
  });

  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  const earthArrivalM = useMemo(() => {
    const body = combined.getBody(EARTH_ID);
    const radiusKm = body !== undefined && body.kind === 'planet' ? body.radiusKm : 6371;
    return planetArrivalM(radiusKm);
  }, [combined]);

  const run = useRef({
    phase: 'warmup' as Phase,
    frame: 0,
    started: false,
    settleStreak: 0,
    switches: [] as ContextSwitchEvent[],
  });

  useEffect(() => {
    onController(flight);
  }, [flight, onController]);

  useEffect(
    () =>
      flight.onContextSwitch((event) => {
        const r = run.current;
        r.switches.push(event);
        publishLive(r.phase, r.switches.length);
        onContextSwitch(event);
      }),
    [flight, onContextSwitch],
  );

  useFrame(() => {
    const r = run.current;
    if (r.phase === 'done') return;

    // Manual render (positive-priority useFrame ⇒ R3F hands over the loop), so the
    // gate measures the actually-rendered shipped pipeline, not a headless update.
    gl.render(scene, camera);
    r.frame += 1;

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
      return;
    }

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
        r.phase = 'settle';
        r.settleStreak = 0;
        publishLive(r.phase, r.switches.length);
      }
    } else if (r.phase === 'settle') {
      if (streaming.stats.inFlight === 0) {
        r.settleStreak += 1;
        if (r.settleStreak >= SETTLE_FRAMES) {
          finish(r, flight, streaming);
          r.phase = 'done';
          publishLive(r.phase, r.switches.length);
        }
      } else {
        r.settleStreak = 0;
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
  r: { frame: number; switches: ContextSwitchEvent[] },
  flight: FlightController,
  streaming: StreamingPolicy,
): void {
  window.__errorGateResult = {
    errorCounts: getErrorCounts(),
    failedChunks: streaming.stats.failedChunks,
    catalogCoverage: streaming.catalogCoverage(),
    switches: r.switches.slice(),
    finalContext: flight.contextId,
    finalAnchor: flight.systemAnchor?.id ?? null,
    frames: r.frame,
  };
}
