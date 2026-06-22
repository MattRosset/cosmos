import type { ContextId, QualityTier } from '@cosmos/core-types';
import type { FlightController } from '@cosmos/nav';
import type { StreamingPolicy } from '@cosmos/streaming';
import { useOverlayStore, useTourStore } from '@cosmos/app-state';

/**
 * E2E/dev test hook (TASK-015 → M2 → M3 → M4a). Event-driven mirrors of app
 * state — written only from store subscriptions, goTo/cinematic lifecycle events,
 * context switches, and the ≤ 4 Hz display timer; NEVER from a frame callback.
 * Read by e2e/tests/m1.spec.ts … m4a.spec.ts; harmless in production.
 */
export interface CosmosTestHook {
  ready: boolean;
  goToActive: boolean;
  selectedId: string | null;
  /** Active scale context, mirrored from the flight controller. */
  contextId: ContextId;
  /** System the camera is inside, or null in 'galaxy' context. */
  anchorSystemId: string | null;
  epochJD: number;
  /** Absolute camera position in its current context (snapshot, not live). */
  cameraPosition: {
    readonly context: ContextId;
    readonly local: readonly [number, number, number];
  };
  /** §5.8 streaming instrumentation (TASK-040), mirrored ≤ 4 Hz from `stats`. */
  streaming: {
    inFlight: number;
    loadedChunks: number;
    renderedPoints: number;
    drawCalls: number;
  };
  /** Active adaptive quality tier (TASK-040), mirrored from `qc.onChange`. */
  qualityTier: QualityTier;
  /**
   * ADR-006 §5 render-tier unification (TASK-052), mirrored ≤ 4 Hz:
   *  - `catalogCoverage`: streaming's catalog-covers-cut scalar [0,1]
   *  - `procgenOpacity`: the procgen-cloud opacity GalaxyScene applied (→ 0 as cov → 1)
   *  - `atmosphereMounted`: Earth atmosphere shell currently mounted (quality-gated)
   */
  catalogCoverage: number;
  procgenOpacity: number;
  atmosphereMounted: boolean;
  /** Educational overlays (TASK-052), mirrored from `useOverlayStore`. */
  overlays: {
    constellations: boolean;
    labels: boolean;
  };
  /** Guided tour state (TASK-052), mirrored from `useTourStore`. */
  tour: {
    active: boolean;
    stepIndex: number;
  };
  /** Cinematic playback active (spline or auto-orbit), mirrored from the controller. */
  cinematicActive: boolean;
}

export const testHook: CosmosTestHook = {
  ready: false,
  goToActive: false,
  selectedId: null,
  contextId: 'galaxy',
  anchorSystemId: null,
  epochJD: 2451545.0,
  cameraPosition: { context: 'galaxy', local: [0, 0, 0] },
  streaming: { inFlight: 0, loadedChunks: 0, renderedPoints: 0, drawCalls: 0 },
  qualityTier: 'high',
  catalogCoverage: 0,
  procgenOpacity: 1,
  atmosphereMounted: false,
  overlays: { constellations: false, labels: false },
  tour: { active: false, stepIndex: -1 },
  cinematicActive: false,
};

/**
 * Module-scoped holder for the live streaming policy (created in App once the
 * octree packs load). The ≤ 4 Hz display timer reads `stats` + `catalogCoverage`
 * through it — never a frame callback.
 */
export const streamingHolder: { current: StreamingPolicy | null } = {
  current: null,
};

/**
 * Module-scoped procgen-opacity holder. GalaxyScene writes the coverage-driven
 * cloud opacity it applied each frame (a plain primitive write — zero alloc); the
 * ≤ 4 Hz mirror reads it. Replaces M3's hard-coded floor in the test hook.
 */
export const procgenOpacityHolder: { current: number } = { current: 1 };

/**
 * Module-scoped atmosphere-mounted flag. SystemScene flips it when it mounts /
 * unmounts the Earth shell (an event, not per-frame).
 */
export const atmosphereHolder: { current: boolean } = { current: false };

/** Mirror low-frequency streaming stats + coverage into the test hook (≤ 4 Hz, §5.8). */
export function mirrorStreamingStats(): void {
  const s = streamingHolder.current;
  if (!s) return;
  const st = s.stats;
  testHook.streaming.inFlight = st.inFlight;
  testHook.streaming.loadedChunks = st.loadedChunks;
  testHook.streaming.renderedPoints = st.renderedPoints;
  testHook.streaming.drawCalls = st.drawCalls;
  testHook.catalogCoverage = s.catalogCoverage();
  testHook.procgenOpacity = procgenOpacityHolder.current;
  testHook.atmosphereMounted = atmosphereHolder.current;
}

/** Mirror overlay-store + tour-store state into the test hook (≤ 4 Hz). */
export function mirrorOverlayState(): void {
  const o = useOverlayStore.getState();
  testHook.overlays.constellations = o.constellations;
  testHook.overlays.labels = o.labels;
  const t = useTourStore.getState();
  testHook.tour.active = t.active !== null;
  testHook.tour.stepIndex = t.stepIndex;
}

/**
 * Module-scoped holder for the live flight controller. The controller is created
 * inside the Canvas (NavDriver); the time-glue display timer and event handlers
 * reach it through this holder at low frequency only.
 */
export const controllerHolder: { current: FlightController | null } = {
  current: null,
};

/** Mirror low-frequency controller state into the test hook (≤ 4 Hz / on events). */
export function mirrorControllerState(): void {
  const c = controllerHolder.current;
  if (!c) return;
  testHook.goToActive = c.goToActive;
  testHook.contextId = c.contextId;
  testHook.cinematicActive = c.cinematicActive;
  testHook.anchorSystemId =
    c.contextId === 'system' ? c.systemAnchor?.id ?? null : null;
  const p = c.state.position;
  testHook.cameraPosition = {
    context: p.context,
    local: [p.local[0], p.local[1], p.local[2]],
  };
}

declare global {
  interface Window {
    __cosmos?: CosmosTestHook;
  }
}

if (typeof window !== 'undefined') {
  window.__cosmos = testHook;
}
