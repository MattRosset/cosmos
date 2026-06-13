import { useEffect } from 'react';
import type { UniversePosition } from '@cosmos/core-types';
import type { OriginManager, ScaleFrameTree } from '@cosmos/coords';
import type { StarDataSource, CombinedSource } from '@cosmos/data';
import { PRIORITY_NAV, useFrameContext } from '@cosmos/scene-host';
import {
  useFlightController,
  type FlightController,
  type ContextSwitchEvent,
} from '@cosmos/nav';
import { systemFeed } from '../glue/system-feed';

/**
 * Initial camera: in the galaxy star field, ~0.06 pc from Sol — just OUTSIDE the
 * system exit radius (1.5e15 m ≈ 0.0486 pc) so the app boots firmly in the galaxy
 * context. M2 "zooms from the star field into Sol" rather than spawning inside it;
 * the M1 2 AU start (1e-5 pc) is inside the 7.5e14 m enter threshold and would
 * auto-descend the moment the anchor scan locks Sol (TASK-027 / TASK-029).
 */
export const INITIAL_CAMERA: UniversePosition = {
  context: 'galaxy',
  local: [0, 0, 0.06],
};

/** Distance floor (pc): avoids the Sol-at-zero-distance trap (TASK-015). */
const MIN_SURFACE_DISTANCE_PC = 1e-7;
/** Distance floor (AU) for the system-context surface feed. */
const MIN_SURFACE_DISTANCE_AU = 1e-9;
/** Anchor scan cadence — ≤ 10 Hz (never per-frame, §5.8). */
const ANCHOR_SCAN_MS = 100;

interface NavDriverProps {
  readonly origin: OriginManager;
  readonly tree: ScaleFrameTree;
  /** HYG source for the galaxy-context speed law (M1 behavior, unchanged). */
  readonly stars: StarDataSource;
  /** Combined source for the host-system anchor scan. */
  readonly combined: CombinedSource;
  /** Called once with the live controller so the HUD can issue goTo at event time. */
  onController(controller: FlightController): void;
  /** Forwarded galaxy⇄system context switches (mounts/unmounts the system scene). */
  onContextSwitch(event: ContextSwitchEvent): void;
}

/**
 * Wires scale-aware free flight into the catalog. Three jobs:
 *  1. Anchor scan (≤ 10 Hz): when the camera nears a host system in the galaxy
 *     context, set the frame-tree 'system' anchor FIRST, then the nav anchor
 *     (TASK-027 precondition order) so the automatic context switch can fire.
 *  2. Dual nearest-surface feed (one step before nav integrates): the HYG star
 *     distance in galaxy context, the nearest mounted-body surface in system
 *     context.
 *  3. Forward context switches to the app (React mount of the system scene).
 */
export function NavDriver({
  origin,
  tree,
  stars,
  combined,
  onController,
  onContextSwitch,
}: NavDriverProps) {
  const flight = useFlightController({
    origin,
    initial: { position: INITIAL_CAMERA, orientation: [0, 0, 0, 1] },
  });

  useEffect(() => {
    onController(flight);
  }, [flight, onController]);

  useEffect(() => flight.onContextSwitch(onContextSwitch), [flight, onContextSwitch]);

  // Anchor scan — galaxy context only (the guard that prevents evicting the
  // system the camera is inside, §5.8).
  useEffect(() => {
    const id = setInterval(() => {
      if (flight.contextId !== 'galaxy') return;
      const [cx, cy, cz] = flight.state.position.local;
      const hit = combined.nearestHostSystem(cx, cy, cz);
      if (hit === null || hit.systemId === flight.systemAnchor?.id) return;
      const pos = combined.hostPositionPc(hit.systemId);
      if (pos === undefined) return;
      tree.setAnchor('system', [pos[0], pos[1], pos[2]]); // FIRST (TASK-027)
      flight.setSystemAnchor({ id: hit.systemId, positionPc: pos }); // THEN
    }, ANCHOR_SCAN_MS);
    return () => clearInterval(id);
  }, [flight, tree, combined]);

  useFrameContext(() => {
    const [cx, cy, cz] = flight.state.position.local;
    if (flight.contextId === 'system') {
      if (!systemFeed.active) return; // scene not built yet — keep last value
      let best = Infinity;
      const n = systemFeed.count;
      for (let i = 0; i < n; i++) {
        const dx = systemFeed.positionsAu[i * 3]! - cx;
        const dy = systemFeed.positionsAu[i * 3 + 1]! - cy;
        const dz = systemFeed.positionsAu[i * 3 + 2]! - cz;
        const d = Math.hypot(dx, dy, dz) - systemFeed.radiiUnits[i]!;
        if (d < best) best = d;
      }
      flight.setDistanceToNearestSurface(Math.max(best, MIN_SURFACE_DISTANCE_AU));
      return;
    }

    // Galaxy context — HYG nearest-star distance (M1 unchanged).
    const i = stars.nearestStarIndex(cx, cy, cz);
    if (i < 0) return;
    const { positionsPc, originPc } = stars.batch;
    const dx = originPc[0] + positionsPc[i * 3]! - cx;
    const dy = originPc[1] + positionsPc[i * 3 + 1]! - cy;
    const dz = originPc[2] + positionsPc[i * 3 + 2]! - cz;
    flight.setDistanceToNearestSurface(
      Math.max(Math.hypot(dx, dy, dz), MIN_SURFACE_DISTANCE_PC),
    );
  }, PRIORITY_NAV - 1);

  return null;
}
