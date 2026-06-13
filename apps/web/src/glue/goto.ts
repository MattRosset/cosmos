import type {
  BodyId,
  BookmarkRecord,
  StarSystemRecord,
  UniversePosition,
} from '@cosmos/core-types';
import type { ScaleFrameTree } from '@cosmos/coords';
import type { CombinedSource, SystemsSource } from '@cosmos/data';
import type { SimClock } from '@cosmos/sim-time';
import type { FlightController } from '@cosmos/nav';
import { systemFeed } from './system-feed';

/** Host/star arrival — inside the 7.5e14 enter threshold so the context flips. */
const HOST_ARRIVAL_M = 5e14;
/** Bookmark restore arrival — crosses contexts safely (TASK-013/027). */
const BOOKMARK_ARRIVAL_M = 1e3;
/** Pending-leg poll cadence while waiting for the system scene to build. */
const PENDING_POLL_MS = 100;

function planetArrivalM(radiusKm: number): number {
  return Math.max(8 * radiusKm * 1000, 5e6);
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
      controller.goTo({
        target: { context: 'galaxy', local: [record.positionPc[0], record.positionPc[1], record.positionPc[2]] },
        arrivalDistanceM: HOST_ARRIVAL_M,
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

  return { goTo, goToBookmark, capture, start };
}
