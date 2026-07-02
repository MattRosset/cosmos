import { useEffect, useMemo } from 'react';
import type { GalaxyRecord, UniversePosition } from '@cosmos/core-types';
import { CONTEXT_UNIT_METERS } from '@cosmos/core-types';
import type { OriginManager, ScaleFrameTree } from '@cosmos/coords';
import type { StarDataSource, CombinedSource } from '@cosmos/data';
import { PRIORITY_NAV, useFrameContext } from '@cosmos/scene-host';
import type { StreamingPolicy } from '@cosmos/streaming';
import { useFlightController } from '../glue/useFlightController';
import {
  type FlightController,
  type ContextSwitchEvent,
} from '@cosmos/nav';
import { systemFeed } from '../glue/system-feed';
import { startGalaxyAnchorScan } from '../glue/local-group';
import { profileSpan } from '../glue/frame-profiler';

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
/**
 * Reach (pc) of the HYG spatial-grid nearest-star search: 200 rings × 25 pc cells
 * (see `@cosmos/data` grid.ts). Beyond this from the star field, the expanding-shell
 * search finds nothing yet still scans every ring (~2.7 M empty cells) — a multi-
 * hundred-ms-per-frame stall. The "Milky Way" vantage (~49 kpc out, TASK-040) sits
 * far outside the field, so we must short-circuit before calling it (see below).
 */
const HYG_GRID_REACH_PC = 200 * 25;
/** Distance floor (AU) for the system-context surface feed. */
const MIN_SURFACE_DISTANCE_AU = 1e-9;
/** Distance floor (Mpc) for the universe-context streaming surface feed. */
const MIN_SURFACE_DISTANCE_MPC = 1e-9;
/** Anchor scan cadence — ≤ 10 Hz (never per-frame, §5.8). */
const ANCHOR_SCAN_MS = 100;
/**
 * Free-flight base speed cap, context units/s (pc in galaxy, AU in system). The
 * speed law (speed ∝ distance to nearest body) is otherwise unbounded; this keeps
 * cruising controllable and stops void runaway. Shift boosts ×10 over this. Tune
 * to taste — higher = faster traversal, lower = tighter control.
 */
const MAX_FREE_FLIGHT_SPEED = 10;

interface NavDriverProps {
  readonly origin: OriginManager;
  readonly tree: ScaleFrameTree;
  /** HYG source for the galaxy-context speed law (M1 behavior, unchanged). */
  readonly stars: StarDataSource;
  /** Combined source for the host-system anchor scan. */
  readonly combined: CombinedSource;
  /** Streaming policy (M3) — supplies the universe-context nearest-surface scalar. */
  readonly streaming?: StreamingPolicy | undefined;
  /** Milky Way anchor record (M3) — enables the universe⇄galaxy anchor scan. */
  readonly milkyWay?: GalaxyRecord | undefined;
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
  streaming,
  milkyWay,
  onController,
  onContextSwitch,
}: NavDriverProps) {
  const flight = useFlightController({
    origin,
    initial: { position: INITIAL_CAMERA, orientation: [0, 0, 0, 1] },
    // Free-flight speed scales with distance-to-nearest-body (fly faster when far).
    // The frozen default cap (1e7 units/s) is effectively unbounded, so flying into
    // an interstellar void runs away to escape velocity. Cap it to a sane cruise so
    // movement stays controllable; Shift still boosts ×10 for deliberate traversal.
    // (Units are context-relative: pc/s in the galaxy, AU/s inside a system.)
    maxSpeedUnitsPerS: MAX_FREE_FLIGHT_SPEED,
  });

  // Bounding sphere of the HYG field (absolute pc), computed once. Used to skip the
  // O(rings³) grid nearest-star search when the camera is too far out for it to find
  // anything (TASK-040: the "Milky Way" vantage is ~49 kpc beyond the field).
  const hygBounds = useMemo(() => {
    const { positionsPc, originPc, count } = stars.batch;
    if (count === 0) return { cx: originPc[0], cy: originPc[1], cz: originPc[2], radius: 0 };
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = positionsPc[i * 3]!, y = positionsPc[i * 3 + 1]!, z = positionsPc[i * 3 + 2]!;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const hx = (maxX - minX) / 2, hy = (maxY - minY) / 2, hz = (maxZ - minZ) / 2;
    return {
      cx: originPc[0] + (minX + maxX) / 2,
      cy: originPc[1] + (minY + maxY) / 2,
      cz: originPc[2] + (minZ + maxZ) / 2,
      radius: Math.hypot(hx, hy, hz),
    };
  }, [stars]);

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

  // Universe⇄galaxy anchor scan (M3) — sets the frame-tree 'galaxy' anchor FIRST,
  // then the nav galaxy anchor (TASK-037 order). One-time once the Milky Way is
  // anchored; safe in any context since the Milky Way sits at the galaxy frame's
  // default origin (no positional shift). Only wired when streaming is present.
  useEffect(() => {
    if (milkyWay === undefined) return;
    return startGalaxyAnchorScan(flight, tree, milkyWay);
  }, [flight, tree, milkyWay]);

  useFrameContext(() => {
    profileSpan('nav.surfaceFeed', () => {
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

    if (flight.contextId === 'universe') {
      // Universe context (M3) — streaming's nearest loaded-chunk distance, meters
      // → Mpc. The galaxy/system feeds below stay exactly as M2 (the streaming
      // scalar is tile-bounds based and collapses to ~0 inside the galaxy octree,
      // so it must NOT drive the galaxy speed law — §5.8 nearest is for universe).
      const dM = streaming?.nearestBodyDistanceM ?? Infinity;
      const units = Number.isFinite(dM) ? dM / CONTEXT_UNIT_METERS.universe : Infinity;
      if (units !== Infinity) {
        flight.setDistanceToNearestSurface(Math.max(units, MIN_SURFACE_DISTANCE_MPC));
      }
      return;
    }

    // Galaxy context — HYG nearest-star distance (M1 unchanged near the field).
    // Short-circuit when the camera is beyond the grid's reach from the field, OR
    // during an animated goTo (breadcrumbs): both cases skip nearestStarIndex.
    // The expanding-shell search scans up to 200 empty rings (~1.7 s/frame) when
    // the camera is in the inter-arm void (3–20 kpc) where HYG has no cells — see
    // docs/research/TASK-040-breadcrumb-freeze.md.
    const ddx = cx - hygBounds.cx;
    const ddy = cy - hygBounds.cy;
    const ddz = cz - hygBounds.cz;
    const distToField = Math.hypot(ddx, ddy, ddz) - hygBounds.radius;
    if (flight.goToActive || distToField > HYG_GRID_REACH_PC) {
      flight.setDistanceToNearestSurface(Math.max(distToField, MIN_SURFACE_DISTANCE_PC));
      return;
    }
    profileSpan('nav.hyg.nearestStarIndex', () => {
      const i = stars.nearestStarIndex(cx, cy, cz);
      if (i < 0) return;
      const { positionsPc, originPc } = stars.batch;
      const dx = originPc[0] + positionsPc[i * 3]! - cx;
      const dy = originPc[1] + positionsPc[i * 3 + 1]! - cy;
      const dz = originPc[2] + positionsPc[i * 3 + 2]! - cz;
      flight.setDistanceToNearestSurface(
        Math.max(Math.hypot(dx, dy, dz), MIN_SURFACE_DISTANCE_PC),
      );
    });
    });
  }, PRIORITY_NAV - 1);

  return null;
}
