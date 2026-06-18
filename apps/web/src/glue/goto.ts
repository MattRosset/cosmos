import {
  CONTEXT_UNIT_METERS,
  type BodyId,
  type BookmarkRecord,
  type StarSystemRecord,
  type UniversePosition,
} from '@cosmos/core-types';
import type { ScaleFrameTree } from '@cosmos/coords';
import type { CombinedSource, SystemsSource } from '@cosmos/data';
import type { SimClock } from '@cosmos/sim-time';
import { DEFAULT_CONTEXT_SWITCH_POLICY, type FlightController } from '@cosmos/nav';
import { systemFeed } from './system-feed';

/** Host/star arrival — inside the 7.5e14 enter threshold so the context flips. */
const HOST_ARRIVAL_M = 5e14;
/**
 * Where "exit system" lands in the galaxy: 0.07 pc from the host — clear of the
 * exitSystemAtM gap (1.5e15 m ≈ 0.0486 pc) AND the re-enter threshold (7.5e14 m
 * ≈ 0.0243 pc), so the camera pops to the galaxy and the anchor scan does not
 * immediately drag it back in. Matches the boot vantage (NavDriver INITIAL_CAMERA).
 */
const EXIT_DISTANCE_PC = 0.07;
/** pc per AU — converts the camera's system-frame offset to a galaxy-frame one. */
const PC_PER_AU = CONTEXT_UNIT_METERS.system / CONTEXT_UNIT_METERS.galaxy;
/** Arrival tolerance for the exit flight (≈ 6.7 AU); small vs the 0.07 pc travel. */
const EXIT_ARRIVAL_M = 1e12;
/** Bookmark restore arrival — crosses contexts safely (TASK-013/027). */
const BOOKMARK_ARRIVAL_M = 1e3;
/**
 * "View galaxy" vantage: a galaxy-context point ~55 kpc out along +Z, so the camera
 * pulls well clear of the disc (≈ 15 kpc radius) and the GalaxyScene spiral fades
 * fully in (it's beyond the §GalaxyScene fade band). Stays in the galaxy context —
 * the controller only exits to universe when it ENTERED from universe (controller.ts
 * ownGalaxyContext), so a galaxy vantage is the reliable "see the whole Milky Way"
 * from the booted galaxy app. A bounded duration keeps the long pull-back snappy.
 */
const GALAXY_VIEW_VANTAGE_PC = 55_000;
const GALAXY_VIEW_ARRIVAL_M = 6_000 * CONTEXT_UNIT_METERS.galaxy; // ≈ ends ~49 kpc out
const GALAXY_VIEW_DURATION_MS = 5_000;
/** "Enter galaxy" vantage: the boot position in the galaxy star field, ~0.06 pc
 *  from Sol (matches NavDriver INITIAL_CAMERA). Used to descend back from the
 *  whole-galaxy view to the Sol neighbourhood. */
const GALAXY_FIELD_VANTAGE_PC = 0.06;
const GALAXY_FIELD_ARRIVAL_M = 1e13;
const GALAXY_FIELD_DURATION_MS = 5_000;
/** Pending-leg poll cadence while waiting for the system scene to build. */
const PENDING_POLL_MS = 100;

/** Enter vantage = this × the outermost orbit, so the whole system frames up. */
const ENTER_FRAME_FACTOR = 2.5;
/** Floor for ultra-compact systems (≈ 0.033 AU) so we never fly into the star. */
const MIN_ENTER_ARRIVAL_M = 5e9;
/**
 * Ceiling kept well inside the enter threshold (7.5e14 m) so the context ALWAYS
 * flips before arrival — otherwise a large system would strand the camera in the
 * galaxy context just short of the gate.
 */
const MAX_ENTER_ARRIVAL_M = 0.6 * DEFAULT_CONTEXT_SWITCH_POLICY.enterSystemAtM;

function planetArrivalM(radiusKm: number): number {
  return Math.max(8 * radiusKm * 1000, 5e6);
}

/**
 * Arrival distance for entering a host's system: scale-aware so Sol (Neptune at
 * ~30 AU → ~75 AU vantage) and a compact exo system (planets at ~0.05 AU → ~0.13
 * AU vantage) both frame nicely instead of the old fixed 3,340-AU stand-off.
 */
function systemArrivalM(sys: StarSystemRecord): number {
  let maxAu = 0;
  for (const b of sys.bodies) {
    const a = b.elements?.semiMajorAxisAu;
    if (a !== undefined && a > maxAu) maxAu = a;
  }
  if (maxAu <= 0) maxAu = 1; // no orbital elements — default to a 1 AU framing
  const m = ENTER_FRAME_FACTOR * maxAu * CONTEXT_UNIT_METERS.system;
  return Math.min(Math.max(m, MIN_ENTER_ARRIVAL_M), MAX_ENTER_ARRIVAL_M);
}

export interface GoToDeps {
  /** Live flight controller (created inside the Canvas; reached at event time). */
  readonly controllerRef: { current: FlightController | null };
  readonly tree: ScaleFrameTree;
  readonly combined: CombinedSource;
  readonly sources: readonly SystemsSource[];
  readonly clock: SimClock;
}

export interface GoToCoordinator {
  /** Select-and-fly to any id: star/host (one leg) or planet (live or two-leg). */
  goTo(id: BodyId): void;
  /** Fly out of the current system back to a galaxy vantage. No-op in galaxy. */
  exitSystem(): void;
  /** Fly all the way out to a universe vantage where the Milky Way reads as a
   *  spiral galaxy (exits the system first if needed). */
  viewGalaxy(): void;
  /** Descend from the universe view back into the galaxy star field near Sol. */
  enterGalaxy(): void;
  /** Zoom-to-fit the current system: pull back to a framing vantage that keeps
   *  the whole system in view, facing the host. No-op in galaxy. */
  frameSystem(): void;
  /** Restore a bookmarked view (epoch + anchor + position + orientation). */
  goToBookmark(bookmark: BookmarkRecord): void;
  /** Build a BookmarkRecord for the current view, or null if not possible. */
  capture(name: string): BookmarkRecord | null;
  /** Start the pending two-leg poll. Returns a disposer. */
  start(): () => void;
}

export function createGoToCoordinator(deps: GoToDeps): GoToCoordinator {
  let pendingPlanetId: BodyId | null = null;
  let firstLegUnsub: (() => void) | null = null;
  let restoreUnsub: (() => void) | null = null;

  function systemOfBody(id: BodyId): StarSystemRecord | undefined {
    for (const s of deps.sources) {
      const sys = s.systemOfBody(id);
      if (sys !== undefined) return sys;
    }
    return undefined;
  }

  /** Live (propagated) absolute position of a body in the mounted system, or null. */
  function livePosition(id: BodyId): UniversePosition | null {
    if (!systemFeed.active) return null;
    const idx = systemFeed.indexById.get(id);
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

  function clearPending(): void {
    pendingPlanetId = null;
    firstLegUnsub?.();
    firstLegUnsub = null;
  }

  function goToPlanet(
    controller: FlightController,
    planetId: BodyId,
    radiusKm: number,
    systemId: BodyId,
  ): void {
    const anchoredHere =
      controller.contextId === 'system' && controller.systemAnchor?.id === systemId;
    const live = anchoredHere ? livePosition(planetId) : null;
    if (live !== null) {
      controller.goTo({ target: live, arrivalDistanceM: planetArrivalM(radiusKm) });
      return;
    }

    // Two-leg: fly to the HOST first, then to the planet once the scene is live.
    clearPending();
    const hostPos =
      deps.combined.hostPositionPc(systemId) ?? systemOfBody(planetId)?.star.positionPc;
    if (hostPos === undefined) return;
    pendingPlanetId = planetId;
    controller.goTo({
      target: { context: 'galaxy', local: [hostPos[0], hostPos[1], hostPos[2]] },
      arrivalDistanceM: HOST_ARRIVAL_M,
    });
    firstLegUnsub = controller.onGoToEnd((completed) => {
      if (!completed) clearPending(); // user cancel clears the pending second leg
    });
  }

  function goTo(id: BodyId): void {
    const controller = deps.controllerRef.current;
    if (controller === null) return;
    const record = deps.combined.getBody(id);
    if (record === undefined) return;

    if (record.kind === 'planet') {
      const sys = systemOfBody(record.id);
      if (sys === undefined) return;
      goToPlanet(controller, record.id, record.radiusKm, sys.id);
    } else if (record.kind === 'star') {
      // Host stars descend into their system at a framing distance; lone stars
      // keep the default close-approach (no system to frame).
      const sys = systemOfBody(record.id);
      controller.goTo({
        target: { context: 'galaxy', local: [record.positionPc[0], record.positionPc[1], record.positionPc[2]] },
        arrivalDistanceM: sys !== undefined ? systemArrivalM(sys) : HOST_ARRIVAL_M,
      });
    }
  }

  /** Issue the pending second leg once the system is anchored AND built. */
  function attemptPendingLeg(): void {
    if (pendingPlanetId === null) return;
    const controller = deps.controllerRef.current;
    if (controller === null || controller.contextId !== 'system') return;
    const planet = deps.combined.getBody(pendingPlanetId);
    if (planet === undefined || planet.kind !== 'planet') {
      clearPending();
      return;
    }
    const sys = systemOfBody(planet.id);
    if (sys === undefined || controller.systemAnchor?.id !== sys.id) return;
    const target = livePosition(planet.id);
    if (target === null) return; // scene not built yet
    controller.goTo({ target, arrivalDistanceM: planetArrivalM(planet.radiusKm) });
    clearPending();
  }

  /**
   * Exit the mounted system: fly straight out along the host→camera direction to
   * a galaxy point EXIT_DISTANCE_PC away. The controller auto-switches galaxy as
   * the camera crosses exitSystemAtM mid-flight (no manual context juggling). We
   * never clear the anchor ourselves — doing so at the host would let the anchor
   * scan re-enter instantly (flapping); flying past the gap is the stable move.
   */
  function exitSystem(): void {
    const controller = deps.controllerRef.current;
    if (controller === null || controller.contextId !== 'system') return;
    const anchor = controller.systemAnchor;
    if (anchor === null) return;
    const host = anchor.positionPc;

    // Camera's system-frame local IS its offset from the host (host at system
    // origin). Convert AU→pc to get the outward direction in the galaxy frame.
    const cam = controller.state.position.local;
    let dx = cam[0] * PC_PER_AU;
    let dy = cam[1] * PC_PER_AU;
    let dz = cam[2] * PC_PER_AU;
    let len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) {
      dx = 0;
      dy = 0;
      dz = 1;
      len = 1; // camera sitting on the host — pick an arbitrary outward axis
    }
    const s = EXIT_DISTANCE_PC / len;
    controller.goTo({
      target: {
        context: 'galaxy',
        local: [host[0] + dx * s, host[1] + dy * s, host[2] + dz * s],
      },
      arrivalDistanceM: EXIT_ARRIVAL_M,
    });
  }

  /**
   * Fly out to a galaxy vantage where the whole Milky Way reads as a spiral. Exits
   * the system first if needed (the controller crosses system→galaxy mid-flight,
   * TASK-027). The target is in the galaxy context (the Milky Way centre is the
   * galaxy-frame origin), facing the centre, so GalaxyScene's spiral fades fully in.
   */
  function viewGalaxy(): void {
    const controller = deps.controllerRef.current;
    if (controller === null) return;
    controller.goTo({
      target: { context: 'galaxy', local: [0, 0, GALAXY_VIEW_VANTAGE_PC] },
      arrivalDistanceM: GALAXY_VIEW_ARRIVAL_M,
      durationMs: GALAXY_VIEW_DURATION_MS,
      lookAtTarget: { context: 'galaxy', local: [0, 0, 0] },
    });
  }

  /** Descend from the Milky Way view back to the Sol star field. Faces the galactic
   *  centre during the flight (same as viewGalaxy) so the first frames are not empty. */
  function enterGalaxy(): void {
    const controller = deps.controllerRef.current;
    if (controller === null) return;
    controller.goTo({
      target: { context: 'galaxy', local: [0, 0, GALAXY_FIELD_VANTAGE_PC] },
      arrivalDistanceM: GALAXY_FIELD_ARRIVAL_M,
      durationMs: GALAXY_FIELD_DURATION_MS,
      lookAtTarget: { context: 'galaxy', local: [0, 0, 0] },
    });
  }

  function systemById(id: BodyId): StarSystemRecord | undefined {
    for (const s of deps.sources) {
      const sys = s.getSystem(id);
      if (sys !== undefined) return sys;
    }
    return undefined;
  }

  /**
   * Frame the mounted system: fly to a point at the system's framing distance
   * (same scale law as entry) along the current host→camera direction, while
   * FACING the host. Unlike a plain goTo (which only ever approaches its target),
   * the lookAt split lets this pull the camera BACK out when it's zoomed in deep,
   * so it works from anywhere inside the system.
   */
  function frameSystem(): void {
    const controller = deps.controllerRef.current;
    if (controller === null || controller.contextId !== 'system') return;
    const anchor = controller.systemAnchor;
    if (anchor === null) return;
    const sys = systemById(anchor.id);
    const frameAu =
      (sys !== undefined ? systemArrivalM(sys) : HOST_ARRIVAL_M) / CONTEXT_UNIT_METERS.system;

    // Host sits at the system origin; camera local IS the host→camera offset (AU).
    const cam = controller.state.position.local;
    let dx = cam[0];
    let dy = cam[1];
    let dz = cam[2];
    let len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) {
      dx = 0;
      dy = 0;
      dz = 1;
      len = 1; // camera on the star — pick an arbitrary framing axis
    }
    const s = frameAu / len;
    controller.goTo({
      target: { context: 'system', local: [dx * s, dy * s, dz * s] },
      arrivalDistanceM: Math.max(frameAu * 0.02 * CONTEXT_UNIT_METERS.system, 1e6),
      lookAtTarget: { context: 'system', local: [0, 0, 0] },
    });
  }

  function goToBookmark(bookmark: BookmarkRecord): void {
    const controller = deps.controllerRef.current;
    if (controller === null) return;
    deps.clock.setEpochJD(bookmark.epochJD);

    if (bookmark.anchorSystemId !== undefined) {
      const hostPos = deps.combined.hostPositionPc(bookmark.anchorSystemId);
      if (hostPos !== undefined) {
        deps.tree.setAnchor('system', [hostPos[0], hostPos[1], hostPos[2]]);
        controller.setSystemAnchor({ id: bookmark.anchorSystemId, positionPc: hostPos });
      }
    }

    controller.goTo({ target: bookmark.position, arrivalDistanceM: BOOKMARK_ARRIVAL_M });

    // Orientation is applied on arrival via a one-shot onGoToEnd (TASK-029).
    restoreUnsub?.();
    const q = bookmark.orientation;
    restoreUnsub = controller.onGoToEnd((completed) => {
      restoreUnsub?.();
      restoreUnsub = null;
      if (!completed) return;
      const o = controller.state.orientation as [number, number, number, number];
      o[0] = q[0];
      o[1] = q[1];
      o[2] = q[2];
      o[3] = q[3];
    });
  }

  function capture(name: string): BookmarkRecord | null {
    const controller = deps.controllerRef.current;
    if (controller === null) return null;
    const pos = controller.state.position;
    const o = controller.state.orientation;
    const anchorSystemId =
      controller.contextId === 'system' ? controller.systemAnchor?.id : undefined;
    return {
      id: crypto.randomUUID(),
      name,
      createdAtIso: new Date().toISOString(),
      position: { context: pos.context, local: [pos.local[0], pos.local[1], pos.local[2]] },
      orientation: [o[0], o[1], o[2], o[3]],
      epochJD: deps.clock.epochJD,
      // Omit (not set undefined) when in galaxy context — exactOptionalPropertyTypes.
      ...(anchorSystemId !== undefined ? { anchorSystemId } : {}),
    };
  }

  function start(): () => void {
    const id = setInterval(attemptPendingLeg, PENDING_POLL_MS);
    return () => {
      clearInterval(id);
      firstLegUnsub?.();
      restoreUnsub?.();
    };
  }

  return { goTo, exitSystem, viewGalaxy, enterGalaxy, frameSystem, goToBookmark, capture, start };
}
