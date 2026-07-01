import type { BodyId, ContextId, QualityTier } from '@cosmos/core-types';
import type { ErrorCounts } from '@cosmos/diagnostics';
import { getErrorCounts } from '@cosmos/diagnostics';
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
  /** §5.8 streaming instrumentation (TASK-040), mirrored ≤ 4 Hz from `stats`.
   *  cutSize/pendingCount/trackedChunks/evictedThisFrame are the BUG-10 density-wall
   *  diagnostics (docs/research/bug-10-streaming-density-wall.md). */
  streaming: {
    inFlight: number;
    loadedChunks: number;
    renderedPoints: number;
    drawCalls: number;
    cutSize: number;
    pendingCount: number;
    trackedChunks: number;
    evictionsTotal: number;
    phaseMs: { select: number; cancelRequest: number; coverage: number; enforce: number; evictFadeVisible: number; total: number };
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
  /**
   * Diagnostics read surface (TASK-058) — the live failure counters the error gate
   * (TASK-059) and manual debugging assert on. Both are LIVE getters, not ≤ 4 Hz
   * mirrors, so a probe reads the true count at read time:
   *  - `errorCounts`: central `getErrorCounts()` (total + per-kind across the app,
   *     incl. the persistence / invariant reports adopted in TASK-058).
   *  - `failedChunks`: streaming chunks in the terminal `failed` state (TASK-057).
   */
  readonly errorCounts: ErrorCounts;
  readonly failedChunks: number;
  /**
   * Picking query surface (e2e). Both delegate to the SAME closures StarScene wires
   * for real clicks (the live camera + flight controller), so a spec can ask the app
   * "what does this pixel select?" / "where does this position land on screen?" instead
   * of re-deriving the camera projection in test code. Eliminates the m1 parallel
   * camera model (docs/research/e2e-ci-flakiness-rootcause-and-query-hook.md §5).
   *
   * Inert (null result) until StarScene's picking effect has mounted, or in contexts
   * where it does not apply (the projection assumes the position is in the camera's
   * current context frame — galaxy pc near Sol, which is all m1 needs).
   *
   * - `pickAt`: production star/planet pick at CSS px, with NO selection side-effect.
   * - `projectToScreen`: inverse — a position in the camera's context frame → CSS px,
   *    or null if behind the camera / off-screen.
   */
  pickAt(clientX: number, clientY: number): BodyId | null;
  projectToScreen(
    localPos: readonly [number, number, number],
  ): { x: number; y: number } | null;
}

/**
 * Pick/projection closures registered by StarScene's picking effect (where the live
 * `gl.domElement`, `camera`, and flight controller are in scope). The test hook
 * delegates to these so e2e queries the REAL pick path, not a re-derived model.
 */
export interface PickProbe {
  pickAt(clientX: number, clientY: number): BodyId | null;
  projectToScreen(
    localPos: readonly [number, number, number],
  ): { x: number; y: number } | null;
}

export const pickProbeHolder: { current: PickProbe | null } = { current: null };

export const testHook: CosmosTestHook = {
  ready: false,
  goToActive: false,
  selectedId: null,
  contextId: 'galaxy',
  anchorSystemId: null,
  epochJD: 2451545.0,
  cameraPosition: { context: 'galaxy', local: [0, 0, 0] },
  streaming: {
    inFlight: 0,
    loadedChunks: 0,
    renderedPoints: 0,
    drawCalls: 0,
    cutSize: 0,
    pendingCount: 0,
    trackedChunks: 0,
    evictionsTotal: 0,
    phaseMs: { select: 0, cancelRequest: 0, coverage: 0, enforce: 0, evictFadeVisible: 0, total: 0 },
  },
  qualityTier: 'high',
  catalogCoverage: 0,
  procgenOpacity: 1,
  atmosphereMounted: false,
  overlays: { constellations: false, labels: false },
  tour: { active: false, stepIndex: -1 },
  cinematicActive: false,
  // Live getters (TASK-058): read the TRUE value at access time, not a ≤ 4 Hz mirror,
  // so the error gate (TASK-059) and manual probes never see a stale count.
  get errorCounts(): ErrorCounts {
    return getErrorCounts();
  },
  get failedChunks(): number {
    return streamingHolder.current?.stats.failedChunks ?? 0;
  },
  // Delegate to StarScene's live pick closures (null until that effect mounts).
  pickAt(clientX: number, clientY: number): BodyId | null {
    return pickProbeHolder.current?.pickAt(clientX, clientY) ?? null;
  },
  projectToScreen(
    localPos: readonly [number, number, number],
  ): { x: number; y: number } | null {
    return pickProbeHolder.current?.projectToScreen(localPos) ?? null;
  },
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
  testHook.streaming.cutSize = st.cutSize;
  testHook.streaming.pendingCount = st.pendingCount;
  testHook.streaming.trackedChunks = st.trackedChunks;
  testHook.streaming.evictionsTotal = st.evictionsTotal;
  testHook.streaming.phaseMs = s.phaseMs();
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
