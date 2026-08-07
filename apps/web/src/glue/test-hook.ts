import {
  CONTEXT_UNIT_METERS,
  type BodyId,
  type ContextId,
  type QualityTier,
  type UniversePosition,
} from '@cosmos/core-types';
import type { ErrorCounts } from '@cosmos/diagnostics';
import { getErrorCounts } from '@cosmos/diagnostics';
import type { FlightController } from '@cosmos/nav';
import type { GoToCoordinator } from './goto';
import type { StreamingPolicy } from '@cosmos/streaming';
import { useOverlayStore, useSettingsStore, useTourStore } from '@cosmos/app-state';
import { systemFeed, systemPickGroup } from './system-feed';

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
  /** Meters per context unit (TASK-084), the app's real constant table — read this
   *  instead of hardcoding a duplicate in a test (CLAUDE.md testing rule 1). */
  readonly contextUnitMeters: Readonly<Record<ContextId, number>>;
  /** System the camera is inside, or null in 'galaxy' context. */
  anchorSystemId: string | null;
  epochJD: number;
  /** Absolute camera position in its current context (snapshot, not live). */
  cameraPosition: {
    readonly context: ContextId;
    readonly local: readonly [number, number, number];
  };
  /**
   * TASK-070: the LAST goTo/fly target (written synchronously by the coordinator's `flyTo`,
   * before any animation), so the search-by-source_id e2e can assert the palette actually
   * flew to the resolved star position — the guard against the "flew via onGoTo(bodyId) =
   * silent no-op" trap. Live getter off the same holder the Jump HUD reads. Null before the
   * first fly.
   */
  readonly flightTarget: {
    readonly context: ContextId;
    readonly local: readonly [number, number, number];
  } | null;
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
  /** Star-field exposure (TASK-068 View drawer gate), mirrored ≤ 4 Hz from
   *  `useSettingsStore` alongside the overlay mirror. */
  exposure: number;
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
  /**
   * TASK-091 — the last galaxy-context nearest-surface scalar NavDriver fed the speed
   * law (pc). Mirrors `surfaceFeedHolder`, a zero-alloc primitive NavDriver writes each
   * frame (the `FlightController` exposes only the SETTER, so there is no controller
   * getter to read). The gaia-park speed-law gate asserts this is a cruising distance
   * (> 100 pc) at a far park — the WASD-unstuck proof (the old streaming-AABB feed made
   * it ~0). 1 before the first galaxy frame (the controller's own default).
   */
  readonly distanceToNearestSurfacePc: number;
  /**
   * TASK-091 — fly to a raw galaxy-frame position (parsecs, Sol-origin), the same path
   * search fly-to uses. Delegates to the live `goto` coordinator via `gotoHolder`; a
   * safe no-op before StarApp wires it. Lets the speed-law e2e park at arbitrary coords
   * without a UI drive.
   */
  goToPosition(positionPc: readonly [number, number, number]): void;
  /**
   * One-shot framebuffer statistic for scale-regression gates (TASK-085). Reads the live
   * drawing buffer from a rAF registered OUTSIDE three's loop, so it runs after three's
   * render in the same turn and is valid despite `preserveDrawingBuffer: false` (pattern:
   * ShaderJitterProbe.tsx:154-156). Resolves `null` if no WebGL canvas is present.
   */
  readFrameStats(): Promise<FrameStats | null>;
  /**
   * TASK-084 — live read of a mounted system body's size + placement, for the
   * context-scale e2e gate. `meshScaleX` is read directly off the THREE object
   * (`mesh.object.scale.x`) via `systemPickGroup`, not recomputed — the actual
   * value SystemScene applied this frame (D2), independent of the formula
   * (`radiusAu`/`renderOffsetContextUnits` mirror `systemFeed`, also app-computed).
   * `null` if no system is mounted or the body id is not tracked.
   */
  systemBody(bodyId: BodyId): {
    radiusAu: number;
    renderOffsetContextUnits: readonly [number, number, number];
    meshScaleX: number;
  } | null;
}

/** Frame-luminance statistic returned by `readFrameStats` (TASK-085). */
export interface FrameStats {
  width: number;
  height: number;
  /** Mean Rec.709 luminance, 0–255. Clear colour alone is ≈ 3.3. */
  meanLuma: number;
  /** Fraction of pixels with luminance > 8. */
  litFrac: number;
  /** Fraction of pixels with luminance > 200. */
  hotFrac: number;
}

/**
 * Read the live drawing buffer after three has rendered. The read happens on the FOURTH
 * rAF callback: one is sufficient for buffer validity (a callback registered outside
 * three's loop runs after three's render in the same turn, F10), the extra two are slack
 * so a uniform written this turn is definitely on screen. Never throws and never
 * fabricates zeros — no canvas / no context resolves `null`.
 */
function readFrameStats(): Promise<FrameStats | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof requestAnimationFrame !== 'function') {
      resolve(null);
      return;
    }
    const canvas = document.querySelector('canvas');
    if (!canvas) {
      resolve(null);
      return;
    }
    const gl: WebGLRenderingContext | WebGL2RenderingContext | null =
      canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) {
      resolve(null);
      return;
    }
    let frames = 0;
    const tick = (): void => {
      if (++frames < 4) {
        requestAnimationFrame(tick);
        return;
      }
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const buf = new Uint8Array(width * height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      let sum = 0;
      let lit = 0;
      let hot = 0;
      const n = width * height;
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const lum = 0.2126 * buf[p]! + 0.7152 * buf[p + 1]! + 0.0722 * buf[p + 2]!;
        sum += lum;
        if (lum > 8) lit++;
        if (lum > 200) hot++;
      }
      resolve({ width, height, meanLuma: sum / n, litFrac: lit / n, hotFrac: hot / n });
    };
    requestAnimationFrame(tick);
  });
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
  contextUnitMeters: CONTEXT_UNIT_METERS,
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
  exposure: 0,
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
  get flightTarget(): { context: ContextId; local: readonly [number, number, number] } | null {
    const t = jumpDistancePcHolder.target;
    return t === null ? null : { context: t.context, local: t.local };
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
  get distanceToNearestSurfacePc(): number {
    return surfaceFeedHolder.current;
  },
  goToPosition(positionPc: readonly [number, number, number]): void {
    gotoHolder.current?.goToPosition(positionPc);
  },
  readFrameStats,
  systemBody(bodyId: BodyId) {
    if (!systemFeed.active) return null;
    const i = systemFeed.indexById.get(bodyId);
    if (i === undefined) return null;
    const group = systemPickGroup.current;
    const mesh = group?.children.find((c) => c.userData['bodyId'] === bodyId);
    if (!mesh) return null;
    return {
      radiusAu: systemFeed.radiiUnits[i]!,
      renderOffsetContextUnits: [
        systemFeed.renderOffsetsContextUnits[i * 3]!,
        systemFeed.renderOffsetsContextUnits[i * 3 + 1]!,
        systemFeed.renderOffsetsContextUnits[i * 3 + 2]!,
      ],
      meshScaleX: mesh.scale.x,
    };
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
 * Last goTo's snapshot, written by the goTo coordinator at flight start (via
 * `tree.distanceMeters`, never re-derived from mid-flight camera state):
 *  - `current`: straight-line distance in PARSECS (unit contract: the mode
 *    badge, TASK-066, reads it alongside `goToActive` to tell a threshold-gated
 *    scale jump from a short hop — do not change its units).
 *  - `target`: the goTo target position (TASK-067), so the Jump HUD can compute
 *    the LIVE distance remaining as `tree.distanceMeters(state.position, target)`
 *    — the controller exposes no progress/remaining scalar.
 */
export const jumpDistancePcHolder: {
  current: number;
  target: UniversePosition | null;
} = { current: 0, target: null };

/**
 * Module-scoped procgen-opacity holder. GalaxyScene writes the coverage-driven
 * cloud opacity it applied each frame (a plain primitive write — zero alloc); the
 * ≤ 4 Hz mirror reads it. Replaces M3's hard-coded floor in the test hook.
 */
export const procgenOpacityHolder: { current: number } = { current: 1 };

/**
 * Is the HYG `stars.bin` monolith currently DRAWING? StarScene writes its live
 * `object.visible` here every frame. Exists so the ADR-006 §5.4 gate can assert the
 * redundant layer is actually gone at the frame it measures, instead of inferring it
 * from a hard-coded catalog point count (testing-conventions rule 1: ask the app).
 */
export const monolithVisibleHolder: { current: boolean } = { current: true };

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

/** Mirror overlay/settings/tour-store state into the test hook (≤ 4 Hz). */
export function mirrorOverlayState(): void {
  const o = useOverlayStore.getState();
  testHook.overlays.constellations = o.constellations;
  testHook.overlays.labels = o.labels;
  testHook.exposure = useSettingsStore.getState().exposure;
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

/**
 * TASK-091 — last galaxy nearest-surface scalar NavDriver fed the speed law (pc). A
 * zero-alloc primitive written each galaxy frame (same pattern as `procgenOpacityHolder`);
 * the `distanceToNearestSurfacePc` hook getter reads it. Init 1 = the controller's own
 * `distanceToNearestSurface` default before the first frame feeds it.
 */
export const surfaceFeedHolder: { current: number } = { current: 1 };

/**
 * TASK-091 — live `goToPosition` command for the speed-law e2e park. Set in StarApp
 * where the goto coordinator is created; the `goToPosition` hook command delegates to it
 * (a safe no-op before wiring). Only the one method the hook needs is exposed.
 */
export const gotoHolder: { current: Pick<GoToCoordinator, 'goToPosition'> | null } = {
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
