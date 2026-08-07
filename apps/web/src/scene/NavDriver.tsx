import { useEffect, useMemo } from 'react';
import { createBudgetMonitor } from '@cosmos/diagnostics';
import { sampleNavBudget, type NavBudgetCtx } from '../glue/nav-budget';
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
import { computeHygFieldBounds } from '../glue/hyg-field';
import { galaxyFarFieldSurfacePc } from '../glue/nav-speed-law';
import { surfaceFeedHolder } from '../glue/test-hook';

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
 * Hysteresis band (pc) around the HYG point cloud's true boundary — two 25 pc grid
 * cells. Outside `maxRadiusPc + margin` the speed law uses the O(1) distance-to-cloud
 * (large → controllable cruise, no grid walk); inside, it runs the HYG grid nearest-
 * star. The margin keeps the branch from flapping frame-to-frame exactly at the
 * surface (both branches give ~equal scalars there). This replaces the TASK-070
 * magic-500 + `streaming.nearestBodyDistanceM` guard, whose tile-AABB distance
 * collapsed to 0 inside a covered Gaia tile → immobilized flight (the WASD "wall").
 * See docs/research/gaia-park-navigation-open.md §1 and TASK-091.
 */
const HYG_FIELD_MARGIN_PC = 50;
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

/**
 * Nav surface-feed budget (ms) for the always-on tripwire (TASK-090). The feed is
 * pure array math — system (~scene body count), galaxy near-Sol (HYG grid, measured
 * 0.001–0.002 ms in hyg-void-nearest-robust-fix.md). 4 ms is ~1000× headroom over
 * normal even on a slow shared runner, and ~20× under the ~90 ms HYG void cliff this
 * alarm exists to catch. If CI ever false-fires, RAISE this (log the measured spanMs),
 * never delete the alarm. See docs/agent-tasks/TASK-090-nav-frame-budget-tripwire.md.
 */
const NAV_FEED_BUDGET_MS = 4;
/** Consecutive over-budget frames before the alarm fires (~0.5 s at 60 fps). A single
 *  slow frame (GC, tab wakeup, machine hitch) must NOT alarm — the real cliff is
 *  sustained. Do not reduce to 1 (see memory/dont-gate-peak-of-per-frame-sample). */
const NAV_FEED_SUSTAINED_FRAMES = 30;

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
  /** Injected clock for the nav-feed budget bracket (TASK-090). Defaults to
   *  `performance.now`; a test stubs it to drive a deterministic over-budget span
   *  without WebGL/real work. */
  now?: () => number;
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
  now = () => performance.now(),
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

  // True-radius bounds of the HYG point cloud (absolute pc), computed once. The
  // galaxy speed law uses the distance to this cloud to skip the O(rings³) grid
  // nearest-star search when the camera is outside it (TASK-040: the "Milky Way"
  // vantage is ~49 kpc beyond the field; TASK-091: the far Gaia park ~2.8 kpc out).
  // `maxRadiusPc` is the TRUE point radius, NOT the AABB half-diagonal — the diagonal
  // is ~√3× larger and would leave a shell where the grid still walks empty rings.
  const hygBounds = useMemo(() => {
    const { positionsPc, originPc, count } = stars.batch;
    return computeHygFieldBounds(positionsPc, originPc, count);
  }, [stars]);

  // Always-on tripwire for the nav surface feed (TASK-090). ONE monitor + ONE
  // reused scratch context, both created once (never per frame). The monitor stays
  // generic; nav is just its first consumer.
  const navBudget = useMemo(
    () =>
      createBudgetMonitor({
        label: 'nav.surfaceFeed',
        budgetMs: NAV_FEED_BUDGET_MS,
        sustainedFrames: NAV_FEED_SUSTAINED_FRAMES,
      }),
    [],
  );
  const navScratch = useMemo<NavBudgetCtx>(
    () => ({ span: 'nav.surfaceFeed', context: '', distFromSolPc: -1, distToField: -1, spanMs: 0 }),
    [],
  );

  useEffect(() => {
    onController(flight);
  }, [flight, onController]);

  useEffect(() => flight.onContextSwitch(onContextSwitch), [flight, onContextSwitch]);

  // Re-arm the tripwire on context switch: galaxy↔system↔universe have different
  // feed regimes, so a partial breach must not carry a stale consecutiveOver across.
  useEffect(() => flight.onContextSwitch(() => navBudget.reset()), [flight, navBudget]);

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
    // TASK-090: bracket the WHOLE feed (callback ms, not frame interval) so the
    // tripwire measures real work, immune to idle-rAF/occlusion throttling.
    const t0 = now();
    profileSpan('nav.surfaceFeed', () => {
    const [cx, cy, cz] = flight.state.position.local;
    navScratch.context = flight.contextId; // set once; every branch below shares it
    if (flight.contextId === 'system') {
      // Distances are galaxy-frame concepts; not meaningful here.
      navScratch.distFromSolPc = -1;
      navScratch.distToField = -1;
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
      navScratch.distFromSolPc = -1;
      navScratch.distToField = -1;
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

    // Galaxy context — the free-flight speed law's nearest-surface scalar (TASK-091).
    // Outside the HYG point cloud (or during an animated goTo — TASK-040 breadcrumb
    // freeze), feed the O(1) distance-to-cloud: large → controllable cruise, and the
    // grid nearest-star search is skipped so a void never walks empty rings (~90 ms/
    // frame). Inside/near the cloud, run the fast HYG grid nearest-star. This replaces
    // the TASK-070 magic-500 + `streaming.nearestBodyDistanceM` guard (the tile-AABB
    // distance collapsed to 0 inside a covered Gaia tile → WASD "wall"). See
    // docs/research/gaia-park-navigation-open.md §1 and TASK-091.
    const distFromSolPc = Math.hypot(cx, cy, cz);
    const distToCloud =
      Math.hypot(cx - hygBounds.cx, cy - hygBounds.cy, cz - hygBounds.cz) -
      hygBounds.maxRadiusPc;
    // Both galaxy sub-paths share these; set once so whichever branch returns, the
    // tripwire report carries them.
    navScratch.distFromSolPc = distFromSolPc;
    navScratch.distToField = distToCloud;
    const far = galaxyFarFieldSurfacePc(
      cx,
      cy,
      cz,
      hygBounds,
      flight.goToActive,
      HYG_FIELD_MARGIN_PC,
      MIN_SURFACE_DISTANCE_PC,
    );
    if (!Number.isNaN(far)) {
      flight.setDistanceToNearestSurface(far);
      surfaceFeedHolder.current = far;
      return;
    }
    profileSpan('nav.hyg.nearestStarIndex', () => {
      const i = stars.nearestStarIndex(cx, cy, cz);
      if (i < 0) return;
      const { positionsPc, originPc } = stars.batch;
      const dx = originPc[0] + positionsPc[i * 3]! - cx;
      const dy = originPc[1] + positionsPc[i * 3 + 1]! - cy;
      const dz = originPc[2] + positionsPc[i * 3 + 2]! - cz;
      const surfacePc = Math.max(Math.hypot(dx, dy, dz), MIN_SURFACE_DISTANCE_PC);
      flight.setDistanceToNearestSurface(surfacePc);
      surfaceFeedHolder.current = surfacePc;
    });
    });
    // Measure the whole feed and feed the tripwire. Stable-message report on a
    // sustained breach; zero allocation on the normal path (scratch is reused).
    sampleNavBudget(navBudget, navScratch, now() - t0);
  }, PRIORITY_NAV - 1);

  return null;
}
