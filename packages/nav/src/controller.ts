import {
  CONTEXT_UNIT_METERS,
  type BodyId,
  type CameraSpline,
  type ContextId,
  type UniversePosition,
} from '@cosmos/core-types';
import type { OriginManager, RebaseEvent } from '@cosmos/coords';
import { createInputHandler, type InputHandler } from './input.js';
import { computeGoToK } from './goto.js';
import { catmullRomCentripetal, DEFAULT_ORBIT_RATE_PER_SEC } from './cinematic.js';
import {
  resolveContextSwitchPolicy,
  shouldEnterSystem,
  shouldExitSystem,
  type ContextSwitchEvent,
  type ContextSwitchPolicy,
  type SystemAnchor,
} from './context-switch.js';
import {
  resolveGalaxySwitchPolicy,
  shouldEnterGalaxy,
  shouldExitGalaxy,
  type GalaxyAnchor,
  type GalaxySwitchPolicy,
} from './galaxy-switch.js';

export interface FlightState {
  readonly position: UniversePosition;
  readonly orientation: readonly [number, number, number, number];
  readonly speedUnitsPerS: number;
}

export interface FlightControllerOptions {
  readonly origin: OriginManager;
  readonly initial: Pick<FlightState, 'position' | 'orientation'>;
  readonly speedScale?: number;
  readonly minSpeedUnitsPerS?: number;
  readonly maxSpeedUnitsPerS?: number;
  readonly dampingHalfLifeMs?: number;
  /** Hysteresis thresholds for auto galaxy⇄system switching (TASK-027). */
  readonly contextSwitchPolicy?: Partial<ContextSwitchPolicy>;
  /** Hysteresis thresholds for auto universe⇄galaxy switching (TASK-037). */
  readonly galaxySwitchPolicy?: Partial<GalaxySwitchPolicy>;
}

export interface GoToOptions {
  readonly target: UniversePosition;
  /** Stop when camera-to-target distance reaches this, METERS. */
  readonly arrivalDistanceM: number;
  /** Total flight duration target. Default 6000. Clamped to [1000, 20000]. */
  readonly durationMs?: number;
  /**
   * Point the camera should FACE during/after the flight, if different from the
   * travel target. Default: face the travel target (the usual fly-to behavior).
   * Lets a flight dolly AWAY from a point while still looking AT it — e.g.
   * "frame system" pulls back to a vantage while keeping the star centered.
   */
  readonly lookAtTarget?: UniversePosition;
}

export interface FlightController {
  readonly state: FlightState;
  attach(el: HTMLElement): () => void;
  setDistanceToNearestSurface(units: number): void;
  update(dtMs: number): void;
  applyRebase(event: RebaseEvent): void;
  /** Begin an animated flight. Replaces any in-flight goTo. */
  goTo(opts: GoToOptions): void;
  /** Abort (also triggered internally by any user movement/look input). */
  cancelGoTo(): void;
  /** True while a goTo is animating. */
  readonly goToActive: boolean;
  /** Fires with true on arrival, false on cancel. Returns an unsubscribe fn. */
  onGoToEnd(cb: (completed: boolean) => void): () => void;

  // ── Context switching (TASK-027) ───────────────────────────────────────────
  /**
   * Set/replace the candidate system anchor. PRECONDITION (documented, asserted
   * in dev): the caller has ALREADY set the frame tree's 'system' anchor to
   * positionPc (tree.setAnchor) — the controller never touches the tree.
   * While context === 'system', a call with a DIFFERENT anchor id is IGNORED
   * (the glue must wait for exit). null clears.
   */
  setSystemAnchor(anchor: SystemAnchor | null): void;
  readonly systemAnchor: SystemAnchor | null;
  /** Mirrors origin.context. */
  readonly contextId: ContextId;
  /** Fires AFTER a completed switch, same frame. Returns unsubscribe. */
  onContextSwitch(cb: (e: ContextSwitchEvent) => void): () => void;

  // ── Galaxy context switching (TASK-037) ────────────────────────────────────
  /**
   * Set/replace the candidate galaxy anchor. PRECONDITION (documented, asserted
   * in dev): the caller has ALREADY set the frame tree's 'galaxy' anchor to
   * positionMpc-in-universe-units (tree.setAnchor('galaxy', …)) before the
   * camera enters. While context is 'galaxy' or deeper, a call with a DIFFERENT
   * galaxy id is IGNORED until the camera exits back to 'universe'. null clears.
   */
  setGalaxyAnchor(anchor: GalaxyAnchor | null): void;
  readonly galaxyAnchor: GalaxyAnchor | null;

  // ── Cinematic camera mode (v5 — TASK-051) ──────────────────────────────────
  /** Start cinematic spline playback. Behaves like goTo: damped, cancels on input. */
  playSpline(spline: CameraSpline, opts?: { onEnd?(completed: boolean): void }): void;
  /** Auto-orbit the given world point at a fixed radius/rate (the §5.3 sub-mode). */
  orbitBody(opts: { center: UniversePosition; radiusM: number; ratePerSec?: number }): void;
  /** Freeze cinematic playback in place (resumable). */
  pauseCinematic(): void;
  /** Resume from the frozen path parameter. */
  resumeCinematic(): void;
  /** Stop cinematic playback and return to free flight (like cancelGoTo). */
  cancelCinematic(): void;
  /** True while a spline or auto-orbit is playing. */
  readonly cinematicActive: boolean;
  /** True while a spline with `letterbox` is playing (the chrome reads this). */
  readonly letterboxActive: boolean;
}

// ── Internal state ──────────────────────────────────────────────────────────

interface GoToState {
  readonly target: UniversePosition;
  readonly arrivalDistanceM: number;
  readonly k: number;
  readonly durationMs: number;
  /** Facing point, or null to face the travel target (default). */
  readonly lookAtTarget: UniversePosition | null;
  endCallbacks: Array<(completed: boolean) => void>;
}

// ── Cinematic state (TASK-051) ────────────────────────────────────────────────

interface SplineState {
  readonly kind: 'spline';
  readonly spline: CameraSpline;
  /** Path clock, ms from start. Frozen while paused. */
  tMs: number;
  paused: boolean;
  readonly letterbox: boolean;
  onEnd: ((completed: boolean) => void) | null;
}

interface OrbitState {
  readonly kind: 'orbit';
  readonly center: UniversePosition;
  readonly radiusM: number;
  readonly ratePerSec: number;
  /** Accumulated orbit angle, radians. Frozen while paused. */
  angle: number;
  paused: boolean;
  onEnd: ((completed: boolean) => void) | null;
}

type CinematicState = SplineState | OrbitState;

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SPEED_SCALE = 1.0;
const DEFAULT_MIN_SPEED = 1e-7;
const DEFAULT_MAX_SPEED = 1e7;
const DEFAULT_DAMPING_HALF_LIFE_MS = 90;
const LOOK_SENSITIVITY = 0.002;
const MAX_PITCH = Math.PI / 2 - 1e-4;
/** Orientation slew time constant for cinematic look-at (ms) — fast but smooth. */
const CINEMATIC_LOOK_TC_MS = 200;

// ── Module-scoped scratch (free-flight path) ─────────────────────────────────

const posScratch: [number, number, number] = [0, 0, 0];
const velScratch: [number, number, number] = [0, 0, 0];
const wishScratch: [number, number, number] = [0, 0, 0];
const forwardScratch: [number, number, number] = [0, 0, 0];
const rightScratch: [number, number, number] = [0, 0, 0];
const upScratch: [number, number, number] = [0, 0, 1];
const qYawScratch: [number, number, number, number] = [0, 0, 0, 1];
const qPitchScratch: [number, number, number, number] = [0, 0, 0, 1];

// ── Module-scoped scratch (goTo path — no allocations in update during goTo) ──

const gotoRenderScratch: [number, number, number] = [0, 0, 0];
/** Render-space vector to the lookAt point (facing target), when one is set. */
const gotoLookScratch: [number, number, number] = [0, 0, 0];
/** Local forward direction in camera space — used as a readonly constant. */
const FORWARD_LOCAL: readonly [number, number, number] = [0, 0, -1];

// ── Module-scoped scratch (context-switch measurement — no allocations) ──────
// The anchor is always expressed in the galaxy frame; toRenderSpace converts it
// into whatever context the origin is currently in (the only sanctioned
// cross-context measurement, ADR-001). `anchorMeasure` is a stable wrapper so
// no UniversePosition object is allocated per frame.
const anchorLocalScratch: [number, number, number] = [0, 0, 0];
const anchorMeasureScratch: UniversePosition = {
  context: 'galaxy',
  local: anchorLocalScratch,
};
const ctxRenderScratch: [number, number, number] = [0, 0, 0];

// ── Module-scoped scratch (galaxy-anchor measurement — no allocations) ────────
// Galaxy anchors are expressed in universe frame (Mpc); toRenderSpace converts
// into the current context. Separate from the system-anchor scratch so both can
// coexist without aliasing (switches are serialised — one per update — but the
// dev check for galaxy entry runs in doSwitch before the event is fired).
const galAnchorLocalScratch: [number, number, number] = [0, 0, 0];
const galAnchorMeasureScratch: UniversePosition = {
  context: 'universe',
  local: galAnchorLocalScratch,
};
const galCtxRenderScratch: [number, number, number] = [0, 0, 0];

// ── Module-scoped scratch (cinematic path — no allocations in update) ─────────
// The four Catmull-Rom control points (and look-at controls) are reconverted to
// render space every frame via toRenderSpace, so the path always animates in the
// active context's frame and survives a rebase/context switch (§5.3).
const cineP0: [number, number, number] = [0, 0, 0];
const cineP1: [number, number, number] = [0, 0, 0];
const cineP2: [number, number, number] = [0, 0, 0];
const cineP3: [number, number, number] = [0, 0, 0];
const cineL0: [number, number, number] = [0, 0, 0];
const cineL1: [number, number, number] = [0, 0, 0];
const cineL2: [number, number, number] = [0, 0, 0];
const cineL3: [number, number, number] = [0, 0, 0];
/** Interpolated camera point, render-space relative to the current camera. */
const cinePosScratch: [number, number, number] = [0, 0, 0];
/** Interpolated look-at point, render-space relative to the current camera. */
const cineLookScratch: [number, number, number] = [0, 0, 0];
/** Auto-orbit center, render-space relative to the current camera. */
const cineCenterScratch: [number, number, number] = [0, 0, 0];

/** Test hook: module-scoped scratch used by update() — same identity every frame. */
export const UPDATE_SCRATCH = {
  pos: posScratch,
  vel: velScratch,
  wish: wishScratch,
  gotoRender: gotoRenderScratch,
  ctxAnchor: anchorLocalScratch,
  ctxRender: ctxRenderScratch,
  galAnchor: galAnchorLocalScratch,
  galRender: galCtxRenderScratch,
  cinePos: cinePosScratch,
  cineLook: cineLookScratch,
  cineP1,
} as const;

// Dev-only precondition guard (architecture §5.3). Bundlers set
// `process.env.NODE_ENV === 'production'` for release builds; vitest leaves it
// 'test', so the guard runs (and is covered) under test.
const NAV_DEV =
  (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV !==
  'production';

// ── Math helpers ─────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function quatNormalize(q: [number, number, number, number]): void {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len < 1e-20) {
    q[0] = 0;
    q[1] = 0;
    q[2] = 0;
    q[3] = 1;
    return;
  }
  const inv = 1 / len;
  q[0] *= inv;
  q[1] *= inv;
  q[2] *= inv;
  q[3] *= inv;
}

function quatMultiply(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
  out: [number, number, number, number],
): void {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const aw = a[3];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  const bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

function quatFromAxisAngle(
  axis: readonly [number, number, number],
  angle: number,
  out: [number, number, number, number],
): void {
  const half = angle * 0.5;
  const s = Math.sin(half);
  out[0] = axis[0] * s;
  out[1] = axis[1] * s;
  out[2] = axis[2] * s;
  out[3] = Math.cos(half);
}

function rotateVecByQuat(
  q: readonly [number, number, number, number],
  v: readonly [number, number, number],
  out: [number, number, number],
): void {
  const qx = q[0];
  const qy = q[1];
  const qz = q[2];
  const qw = q[3];
  const vx = v[0];
  const vy = v[1];
  const vz = v[2];

  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
}

/** Rotation axes for yaw (world Y) / pitch (local X, applied after yaw). */
const AXIS_Y: readonly [number, number, number] = [0, 1, 0];
const AXIS_X: readonly [number, number, number] = [1, 0, 0];

const TWO_PI = Math.PI * 2;

/** Wraps an angle difference into [-π, π] — yaw is circular, shortest-path blend. */
function wrapAngleDiff(diff: number): number {
  let d = diff % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d < -Math.PI) d += TWO_PI;
  return d;
}

/** Reused output of yawPitchFromDir — single-controller-instance scratch (§ pattern). */
const yawPitchScratch = { yaw: 0, pitch: 0 };

/**
 * Decomposes a (not necessarily normalized) direction vector into the yaw/pitch
 * that produce it under `forward = Ry(yaw)·Rx(pitch)·(0,0,-1)` — the exact
 * inverse of syncOrientationFromYawPitch's composition. Writes into
 * `yawPitchScratch` (no allocation).
 */
function yawPitchFromDir(dx: number, dy: number, dz: number): void {
  const len = Math.hypot(dx, dy, dz);
  const ny = len > 1e-30 ? dy / len : 0;
  yawPitchScratch.yaw = Math.atan2(-dx, -dz);
  yawPitchScratch.pitch = Math.asin(clamp(ny, -1, 1));
}

/** Test hook: pure yaw/pitch helpers, exercised directly in unit tests. */
export const YAW_PITCH_TEST_HOOK = {
  yawPitchFromDir,
  yawPitchScratch,
  wrapAngleDiff,
};

// ── Factory ──────────────────────────────────────────────────────────────────

export function createFlightController(opts: FlightControllerOptions): FlightController {
  const speedScale = opts.speedScale ?? DEFAULT_SPEED_SCALE;
  const minSpeed = opts.minSpeedUnitsPerS ?? DEFAULT_MIN_SPEED;
  const maxSpeed = opts.maxSpeedUnitsPerS ?? DEFAULT_MAX_SPEED;
  const dampingHalfLifeMs = opts.dampingHalfLifeMs ?? DEFAULT_DAMPING_HALF_LIFE_MS;

  const origin = opts.origin;
  const orientation: [number, number, number, number] = [
    opts.initial.orientation[0],
    opts.initial.orientation[1],
    opts.initial.orientation[2],
    opts.initial.orientation[3],
  ];
  quatNormalize(orientation);

  // Primary mutable orientation state: yaw/pitch scalars, not the quaternion —
  // roll is then not representable at all (no degenerate-axis case anywhere a
  // reorientation happens). `orientation` becomes a derived cache, recomputed by
  // syncOrientationFromYawPitch whenever yaw/pitch change. Decompose whatever
  // quaternion the caller passed in once at construction (dropping any roll it
  // may have had baked in is fine — see docs/research/nav-camera-roll-and-ci-deploy-findings.md).
  let yaw = 0;
  let pitch = 0;

  function syncOrientationFromYawPitch(): void {
    quatFromAxisAngle(AXIS_Y, yaw, qYawScratch);
    quatFromAxisAngle(AXIS_X, pitch, qPitchScratch);
    quatMultiply(qYawScratch, qPitchScratch, orientation);
  }

  rotateVecByQuat(orientation, FORWARD_LOCAL, forwardScratch);
  yawPitchFromDir(forwardScratch[0], forwardScratch[1], forwardScratch[2]);
  yaw = yawPitchScratch.yaw;
  pitch = clamp(yawPitchScratch.pitch, -MAX_PITCH, MAX_PITCH);
  syncOrientationFromYawPitch();

  function applyLook(deltaX: number, deltaY: number): void {
    if (deltaX === 0 && deltaY === 0) return;
    if (deltaX !== 0) yaw -= deltaX * LOOK_SENSITIVITY;
    if (deltaY !== 0) pitch = clamp(pitch - deltaY * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
    syncOrientationFromYawPitch();
  }

  posScratch[0] = opts.initial.position.local[0];
  posScratch[1] = opts.initial.position.local[1];
  posScratch[2] = opts.initial.position.local[2];

  velScratch[0] = 0;
  velScratch[1] = 0;
  velScratch[2] = 0;

  let distanceToNearestSurface = 1;
  let speedUnitsPerS = 0;
  let activeGoTo: GoToState | null = null;
  let cinematic: CinematicState | null = null;

  // Context switching (TASK-027)
  const policy = resolveContextSwitchPolicy(opts.contextSwitchPolicy);
  let systemAnchor: SystemAnchor | null = null;
  const contextSwitchCallbacks: Array<(e: ContextSwitchEvent) => void> = [];

  // Galaxy context switching (TASK-037)
  const galaxyPolicy = resolveGalaxySwitchPolicy(opts.galaxySwitchPolicy);
  let galaxyAnchor: GalaxyAnchor | null = null;
  // true only when we entered 'galaxy' from 'universe' via the switch law;
  // false when the controller starts in galaxy context (TASK-027 scenario)
  // so those tests never accidentally trigger a universe exit.
  let ownGalaxyContext = false;

  const input: InputHandler = createInputHandler();

  const flightState: FlightState = {
    get position(): UniversePosition {
      return {
        context: origin.context,
        local: [posScratch[0], posScratch[1], posScratch[2]],
      };
    },
    get orientation(): readonly [number, number, number, number] {
      return orientation;
    },
    get speedUnitsPerS() {
      return speedUnitsPerS;
    },
  };

  function applyRebase(event: RebaseEvent): void {
    // Velocity and position are tracked in absolute context-local f64; rebasing
    // only shifts the render origin inside coords — no patch required (ADR-001).
    void event;
  }

  function fireGoToEnd(state: GoToState, completed: boolean): void {
    const cbs = state.endCallbacks.slice();
    for (const cb of cbs) cb(completed);
  }

  function doArrive(state: GoToState): void {
    activeGoTo = null;
    velScratch[0] = 0;
    velScratch[1] = 0;
    velScratch[2] = 0;
    speedUnitsPerS = 0;
    fireGoToEnd(state, true);
  }

  function cancelGoTo(): void {
    if (activeGoTo === null) return;
    const state = activeGoTo;
    activeGoTo = null;
    fireGoToEnd(state, false);
  }

  function goTo(opts: GoToOptions): void {
    const durationMs = clamp(opts.durationMs ?? 6000, 1000, 20000);

    // Measure initial camera-relative distance to target (meters)
    origin.toRenderSpace(opts.target, gotoRenderScratch);
    const dUnits = Math.hypot(
      gotoRenderScratch[0],
      gotoRenderScratch[1],
      gotoRenderScratch[2],
    );
    const d0M = dUnits * CONTEXT_UNIT_METERS[origin.context];

    // Cancel any in-flight goTo before starting the new one
    if (activeGoTo !== null) {
      const prev = activeGoTo;
      activeGoTo = null;
      fireGoToEnd(prev, false);
    }

    if (d0M <= opts.arrivalDistanceM) {
      return;
    }

    const k = computeGoToK(d0M, opts.arrivalDistanceM, durationMs);

    velScratch[0] = 0;
    velScratch[1] = 0;
    velScratch[2] = 0;
    speedUnitsPerS = 0;

    activeGoTo = {
      target: opts.target,
      arrivalDistanceM: opts.arrivalDistanceM,
      k,
      durationMs,
      lookAtTarget: opts.lookAtTarget ?? null,
      endCallbacks: [],
    };
  }

  function onGoToEnd(cb: (completed: boolean) => void): () => void {
    if (activeGoTo === null) return () => {};
    const state = activeGoTo;
    state.endCallbacks.push(cb);
    return () => {
      const idx = state.endCallbacks.indexOf(cb);
      if (idx !== -1) state.endCallbacks.splice(idx, 1);
    };
  }

  /** Single goTo animation tick — called from update() when activeGoTo !== null. */
  function updateGoToFrame(dtMs: number, dt: number): void {
    const state = activeGoTo!;
    const { target, arrivalDistanceM, k, durationMs } = state;

    // 1. Camera-relative target position (context units)
    origin.toRenderSpace(target, gotoRenderScratch);
    const dUnits = Math.hypot(
      gotoRenderScratch[0],
      gotoRenderScratch[1],
      gotoRenderScratch[2],
    );
    const metersPerUnit = CONTEXT_UNIT_METERS[origin.context];
    const dM = dUnits * metersPerUnit;

    // Already at or past arrival (degenerate frame)
    if (dM <= arrivalDistanceM || dUnits < 1e-30) {
      doArrive(state);
      return;
    }

    // 2. Exponential decay step
    const natural = dM * Math.exp(-k * dtMs);
    const dNextM = natural <= arrivalDistanceM ? arrivalDistanceM : natural;
    const stepM = dM - dNextM;
    const stepUnits = stepM / metersPerUnit;
    const arrived = dNextM <= arrivalDistanceM;

    // 3. Orientation slew toward the FACING direction: the lookAt point when one
    //    is set (dolly-back framing), else the travel direction (normal fly-to).
    //    Blends the yaw/pitch SCALARS rather than slerping a quaternion — roll is
    //    not representable in this state, so there is no degenerate-axis case (the
    //    old antipodal cross-product fallback no longer exists, and no rotation can
    //    introduce roll regardless of how much pitch the camera currently has).
    const invDUnits = 1 / dUnits;
    let tDirX = gotoRenderScratch[0] * invDUnits;
    let tDirY = gotoRenderScratch[1] * invDUnits;
    let tDirZ = gotoRenderScratch[2] * invDUnits;
    if (state.lookAtTarget !== null) {
      origin.toRenderSpace(state.lookAtTarget, gotoLookScratch);
      const lLen = Math.hypot(gotoLookScratch[0], gotoLookScratch[1], gotoLookScratch[2]);
      if (lLen > 1e-30) {
        const invL = 1 / lLen;
        tDirX = gotoLookScratch[0] * invL;
        tDirY = gotoLookScratch[1] * invL;
        tDirZ = gotoLookScratch[2] * invL;
      }
    }
    yawPitchFromDir(tDirX, tDirY, tDirZ);
    const T = durationMs / 5;
    const alpha = 1 - Math.exp(-dtMs / T);
    yaw += wrapAngleDiff(yawPitchScratch.yaw - yaw) * alpha;
    pitch = clamp(pitch + (yawPitchScratch.pitch - pitch) * alpha, -MAX_PITCH, MAX_PITCH);
    syncOrientationFromYawPitch();

    // 4. Move camera along direction (camera → target)
    const scale = stepUnits / dUnits;
    posScratch[0] += gotoRenderScratch[0] * scale;
    posScratch[1] += gotoRenderScratch[1] * scale;
    posScratch[2] += gotoRenderScratch[2] * scale;

    // 5. Sync origin (may trigger rebase — transparent per ADR-001)
    const universePos: UniversePosition = {
      context: origin.context,
      local: [posScratch[0], posScratch[1], posScratch[2]],
    };
    const rebase = origin.setCameraPosition(universePos);
    if (rebase) applyRebase(rebase);

    if (arrived) {
      doArrive(state);
    } else {
      speedUnitsPerS = dt > 0 ? stepUnits / dt : 0;
    }
  }

  // ── Context switching (TASK-027) ───────────────────────────────────────────

  function setSystemAnchor(anchor: SystemAnchor | null): void {
    if (anchor === null) {
      systemAnchor = null;
      return;
    }
    // While inside a system, ignore a DIFFERENT anchor: the glue owns the tree
    // and must wait for exit before re-anchoring. Same id is allowed (refresh).
    if (
      origin.context === 'system' &&
      systemAnchor !== null &&
      anchor.id !== systemAnchor.id
    ) {
      return;
    }
    systemAnchor = anchor;
  }

  // ── Galaxy context switching (TASK-037) ────────────────────────────────────

  function setGalaxyAnchor(anchor: GalaxyAnchor | null): void {
    if (anchor === null) {
      galaxyAnchor = null;
      return;
    }
    // While in galaxy or deeper, ignore a DIFFERENT anchor id. The glue must
    // exit back to universe before re-anchoring. Same id is allowed (refresh).
    const ctx = origin.context;
    if (
      (ctx === 'galaxy' || ctx === 'system' || ctx === 'planet') &&
      galaxyAnchor !== null &&
      anchor.id !== galaxyAnchor.id
    ) {
      return;
    }
    galaxyAnchor = anchor;
  }

  function onContextSwitch(cb: (e: ContextSwitchEvent) => void): () => void {
    contextSwitchCallbacks.push(cb);
    return () => {
      const idx = contextSwitchCallbacks.indexOf(cb);
      if (idx !== -1) contextSwitchCallbacks.splice(idx, 1);
    };
  }

  /**
   * Perform a context switch. `preDM` is the camera↔anchor distance in meters
   * measured in the OLD context (NaN when exiting on a cleared anchor, where
   * there is nothing to re-measure). Allocations on this path — the
   * `cameraUniverse` read and the event payload — are sanctioned: switches are
   * rare by construction (the hysteresis gap, §5.8).
   */
  function doSwitch(
    from: ContextId,
    to: ContextId,
    anchorId: BodyId | null,
    preDM: number,
  ): void {
    origin.switchContext(to);

    // f64 position is re-read from the reconverted origin (now `to`-units).
    const cam = origin.cameraUniverse;
    posScratch[0] = cam.local[0];
    posScratch[1] = cam.local[1];
    posScratch[2] = cam.local[2];

    // Velocity & reported speed rescale by the unit ratio so PHYSICAL speed is
    // unchanged (ADR-001 §3). Speed CAPS are NOT rescaled — they are
    // context-agnostic limits in units/s by design (documented asymmetry).
    const ratio = CONTEXT_UNIT_METERS[from] / CONTEXT_UNIT_METERS[to];
    velScratch[0] *= ratio;
    velScratch[1] *= ratio;
    velScratch[2] *= ratio;
    speedUnitsPerS *= ratio;

    // Dev precondition guard (skipped in production builds): switchContext is a
    // pure coordinate reconversion, so it never moves the camera's ABSOLUTE
    // point — but it is only MEANINGFUL if the glue set the correct tree anchor.
    // Cheap check on enter: the anchor's absolute coordinate in the new context
    // must be ≈ 0 (the anchor must be at the context origin).
    // (preDM is referenced so the param is meaningful to callers; NaN on a
    // cleared-anchor exit, where there is no anchor to verify.)
    if (NAV_DEV && to === 'system' && systemAnchor !== null && Number.isFinite(preDM)) {
      anchorLocalScratch[0] = systemAnchor.positionPc[0];
      anchorLocalScratch[1] = systemAnchor.positionPc[1];
      anchorLocalScratch[2] = systemAnchor.positionPc[2];
      origin.toRenderSpace(anchorMeasureScratch, ctxRenderScratch);
      // anchor_absolute = camera_absolute + (anchor − camera)
      const ax = cam.local[0] + ctxRenderScratch[0];
      const ay = cam.local[1] + ctxRenderScratch[1];
      const az = cam.local[2] + ctxRenderScratch[2];
      const offsetM = Math.hypot(ax, ay, az) * CONTEXT_UNIT_METERS.system;
      if (offsetM > policy.enterSystemAtM) {
        throw new Error(
          'nav: context switch broke positional continuity — the host star is not ' +
            'at the system origin. The glue must call ' +
            "tree.setAnchor('system', anchor.positionPc) before the camera enters " +
            '(TASK-027 precondition).',
        );
      }
    }

    if (NAV_DEV && to === 'galaxy' && from === 'universe' && galaxyAnchor !== null && Number.isFinite(preDM)) {
      galAnchorLocalScratch[0] = galaxyAnchor.positionMpc[0];
      galAnchorLocalScratch[1] = galaxyAnchor.positionMpc[1];
      galAnchorLocalScratch[2] = galaxyAnchor.positionMpc[2];
      origin.toRenderSpace(galAnchorMeasureScratch, galCtxRenderScratch);
      const ax = cam.local[0] + galCtxRenderScratch[0];
      const ay = cam.local[1] + galCtxRenderScratch[1];
      const az = cam.local[2] + galCtxRenderScratch[2];
      const offsetM = Math.hypot(ax, ay, az) * CONTEXT_UNIT_METERS.galaxy;
      if (offsetM > galaxyPolicy.enterGalaxyAtM) {
        throw new Error(
          'nav: context switch broke positional continuity — the galaxy center is not ' +
            'at the galaxy origin. The glue must call ' +
            "tree.setAnchor('galaxy', anchor.positionMpc) before the camera enters " +
            '(TASK-037 precondition).',
        );
      }
    }

    // Track whether we own the galaxy context (entered from universe). This
    // prevents TASK-027 controllers (initial context = galaxy, no galaxy anchor)
    // from accidentally triggering a universe exit.
    if (from === 'universe' && to === 'galaxy') ownGalaxyContext = true;
    else if (from === 'galaxy' && to === 'universe') ownGalaxyContext = false;

    if (contextSwitchCallbacks.length > 0) {
      const event: ContextSwitchEvent = { from, to, anchorId };
      const cbs = contextSwitchCallbacks.slice();
      for (const cb of cbs) cb(event);
    }
  }

  /** Camera↔system-anchor distance in meters (galaxy-frame anchor, ADR-001). */
  function measureAnchorDM(anchor: SystemAnchor): number {
    anchorLocalScratch[0] = anchor.positionPc[0];
    anchorLocalScratch[1] = anchor.positionPc[1];
    anchorLocalScratch[2] = anchor.positionPc[2];
    origin.toRenderSpace(anchorMeasureScratch, ctxRenderScratch);
    return (
      Math.hypot(ctxRenderScratch[0], ctxRenderScratch[1], ctxRenderScratch[2]) *
      CONTEXT_UNIT_METERS[origin.context]
    );
  }

  /** Camera↔galaxy-anchor distance in meters (universe-frame anchor, ADR-001). */
  function measureGalaxyAnchorDM(anchor: GalaxyAnchor): number {
    galAnchorLocalScratch[0] = anchor.positionMpc[0];
    galAnchorLocalScratch[1] = anchor.positionMpc[1];
    galAnchorLocalScratch[2] = anchor.positionMpc[2];
    origin.toRenderSpace(galAnchorMeasureScratch, galCtxRenderScratch);
    return (
      Math.hypot(galCtxRenderScratch[0], galCtxRenderScratch[1], galCtxRenderScratch[2]) *
      CONTEXT_UNIT_METERS[origin.context]
    );
  }

  /**
   * Switch law (TASK-027 + TASK-037). Runs at the END of update(), after the
   * camera's new position is final for the frame. At most ONE switch per call —
   * enforced by early returns after each doSwitch(). The galaxy switch (universe
   * boundary) is checked first in universe context; the system switch (galaxy
   * boundary) is checked first in galaxy context before the universe exit.
   */
  function maybeSwitchContext(): void {
    const sysAnchor = systemAnchor;
    const galAnch = galaxyAnchor;
    const ctx = origin.context;

    if (ctx === 'universe') {
      // Rule 1: no galaxy anchor → universe⇄galaxy switching is inert.
      if (galAnch === null) return;
      const dM = measureGalaxyAnchorDM(galAnch);
      if (shouldEnterGalaxy(dM, galaxyPolicy)) {
        doSwitch('universe', 'galaxy', galAnch.id, dM);
      }
      return;
    }

    if (ctx === 'galaxy') {
      // System switch evaluated FIRST so at most one switch fires per update.
      if (sysAnchor !== null) {
        const dM = measureAnchorDM(sysAnchor);
        if (shouldEnterSystem(dM, policy)) {
          doSwitch('galaxy', 'system', sysAnchor.id, dM);
          return; // at most one switch per update
        }
      }
      // Galaxy exit: only when we entered from universe (ownGalaxyContext).
      // Rule 1: if galaxyAnchor is null and we never entered from universe,
      // this is a plain galaxy context (TASK-027) — no universe exit.
      if (ownGalaxyContext) {
        const cleared = galAnch === null;
        const dM = cleared ? Number.NaN : measureGalaxyAnchorDM(galAnch!);
        if (shouldExitGalaxy(cleared ? 0 : dM, cleared, galaxyPolicy)) {
          doSwitch('galaxy', 'universe', cleared ? null : galAnch!.id, dM);
        }
      }
      return;
    }

    if (ctx === 'system') {
      const cleared = sysAnchor === null;
      const dM = cleared ? Number.NaN : measureAnchorDM(sysAnchor!);
      if (shouldExitSystem(cleared ? 0 : dM, cleared, policy)) {
        doSwitch('system', 'galaxy', cleared ? null : sysAnchor!.id, dM);
      }
    }
    // planet: no automatic switching
  }

  // ── Cinematic camera mode (TASK-051) ───────────────────────────────────────

  function fireCinematicEnd(state: CinematicState, completed: boolean): void {
    const cb = state.onEnd;
    if (cb !== null) cb(completed);
  }

  /** Stop the camera dead (shared by every cinematic stop/replace path). */
  function haltMotion(): void {
    velScratch[0] = 0;
    velScratch[1] = 0;
    velScratch[2] = 0;
    speedUnitsPerS = 0;
  }

  function startCinematic(next: CinematicState): void {
    // Cinematic and goTo are mutually exclusive — a new cinematic cancels any
    // in-flight goTo (reuses the existing cancel path; goTo itself is unchanged).
    cancelGoTo();
    if (cinematic !== null) {
      const prev = cinematic;
      cinematic = null;
      fireCinematicEnd(prev, false);
    }
    haltMotion();
    cinematic = next;
  }

  function playSpline(
    spline: CameraSpline,
    opts?: { onEnd?(completed: boolean): void },
  ): void {
    if (spline.keyframes.length === 0) {
      opts?.onEnd?.(true);
      return;
    }
    startCinematic({
      kind: 'spline',
      spline,
      tMs: 0,
      paused: false,
      letterbox: spline.letterbox === true,
      onEnd: opts?.onEnd ?? null,
    });
  }

  function orbitBody(opts: {
    center: UniversePosition;
    radiusM: number;
    ratePerSec?: number;
  }): void {
    startCinematic({
      kind: 'orbit',
      center: opts.center,
      radiusM: opts.radiusM,
      ratePerSec: opts.ratePerSec ?? DEFAULT_ORBIT_RATE_PER_SEC,
      angle: 0,
      paused: false,
      onEnd: null,
    });
  }

  function pauseCinematic(): void {
    if (cinematic !== null) cinematic.paused = true;
  }

  function resumeCinematic(): void {
    if (cinematic !== null) cinematic.paused = false;
  }

  function cancelCinematic(): void {
    if (cinematic === null) return;
    const state = cinematic;
    cinematic = null;
    haltMotion();
    fireCinematicEnd(state, false);
  }

  /**
   * Slew the orientation toward a render-space facing direction (relative to the
   * camera), by blending the yaw/pitch SCALARS — same rationale as the goTo slew
   * (see its comment): roll is not representable in this state, so there is no
   * degenerate-axis case to handle.
   */
  function slewLookToward(dx: number, dy: number, dz: number, dtMs: number): void {
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-30) return;

    yawPitchFromDir(dx, dy, dz);
    const alpha = 1 - Math.exp(-dtMs / CINEMATIC_LOOK_TC_MS);
    yaw += wrapAngleDiff(yawPitchScratch.yaw - yaw) * alpha;
    pitch = clamp(pitch + (yawPitchScratch.pitch - pitch) * alpha, -MAX_PITCH, MAX_PITCH);
    syncOrientationFromYawPitch();
  }

  /**
   * Move the camera onto an interpolated render-space point (relative to the
   * current camera), then face `lookRel`. Shared tail of the spline and orbit
   * frames. `posRel`/`lookRel` are camera-relative in current-context units.
   */
  function applyCinematicFrame(
    posRel: readonly [number, number, number],
    lookRel: readonly [number, number, number],
    dtMs: number,
    dt: number,
  ): void {
    posScratch[0] += posRel[0];
    posScratch[1] += posRel[1];
    posScratch[2] += posRel[2];

    // Face from the NEW camera toward the look point: both are relative to the
    // OLD camera, so the new facing vector is lookRel − posRel.
    slewLookToward(
      lookRel[0] - posRel[0],
      lookRel[1] - posRel[1],
      lookRel[2] - posRel[2],
      dtMs,
    );

    const universePos: UniversePosition = {
      context: origin.context,
      local: [posScratch[0], posScratch[1], posScratch[2]],
    };
    const rebase = origin.setCameraPosition(universePos);
    if (rebase) applyRebase(rebase);

    const stepUnits = Math.hypot(posRel[0], posRel[1], posRel[2]);
    speedUnitsPerS = dt > 0 ? stepUnits / dt : 0;
  }

  /** Single spline-playback tick — called from update() while cinematic.kind==='spline'. */
  function updateSplineFrame(dtMs: number, dt: number): void {
    const state = cinematic as SplineState;
    const kfs = state.spline.keyframes;
    const n = kfs.length;
    const endMs = kfs[n - 1]!.timeMs;

    if (!state.paused) state.tMs += dtMs;
    const arrived = state.tMs >= endMs;
    const t = arrived ? endMs : state.tMs;

    if (n === 1) {
      // Degenerate single-keyframe "spline": dolly straight onto it.
      origin.toRenderSpace(kfs[0]!.at, cinePosScratch);
      origin.toRenderSpace(kfs[0]!.lookAt, cineLookScratch);
    } else {
      // Locate the active segment [i, i+1] (timeMs is monotonic increasing).
      let i = 0;
      while (i < n - 2 && t > kfs[i + 1]!.timeMs) i += 1;
      const segDur = kfs[i + 1]!.timeMs - kfs[i]!.timeMs;
      const u = segDur > 0 ? clamp((t - kfs[i]!.timeMs) / segDur, 0, 1) : 0;

      const i0 = i > 0 ? i - 1 : i;
      const i1 = i;
      const i2 = i + 1;
      const i3 = i + 2 < n ? i + 2 : i + 1;

      // Reconvert the 4 control keyframes into the current context's render
      // space every frame — this is what makes the path animate in the active
      // frame and survive a rebase / context switch (§5.3).
      origin.toRenderSpace(kfs[i0]!.at, cineP0);
      origin.toRenderSpace(kfs[i1]!.at, cineP1);
      origin.toRenderSpace(kfs[i2]!.at, cineP2);
      origin.toRenderSpace(kfs[i3]!.at, cineP3);
      catmullRomCentripetal(cineP0, cineP1, cineP2, cineP3, u, cinePosScratch);

      origin.toRenderSpace(kfs[i0]!.lookAt, cineL0);
      origin.toRenderSpace(kfs[i1]!.lookAt, cineL1);
      origin.toRenderSpace(kfs[i2]!.lookAt, cineL2);
      origin.toRenderSpace(kfs[i3]!.lookAt, cineL3);
      catmullRomCentripetal(cineL0, cineL1, cineL2, cineL3, u, cineLookScratch);
    }

    applyCinematicFrame(cinePosScratch, cineLookScratch, dtMs, dt);

    if (arrived) {
      const finished = cinematic!;
      cinematic = null;
      haltMotion();
      fireCinematicEnd(finished, true);
    }
  }

  /** Single auto-orbit tick — called from update() while cinematic.kind==='orbit'. */
  function updateOrbitFrame(dtMs: number, dt: number): void {
    const state = cinematic as OrbitState;
    if (!state.paused) state.angle += state.ratePerSec * dt;

    origin.toRenderSpace(state.center, cineCenterScratch);
    const radiusUnits = state.radiusM / CONTEXT_UNIT_METERS[origin.context];

    // Camera offset from the center, in the orbit plane (XY of the context).
    const ox = Math.cos(state.angle) * radiusUnits;
    const oy = Math.sin(state.angle) * radiusUnits;

    // Desired camera point, render-space relative to the current camera.
    cinePosScratch[0] = cineCenterScratch[0] + ox;
    cinePosScratch[1] = cineCenterScratch[1] + oy;
    cinePosScratch[2] = cineCenterScratch[2];

    // Look point is the center itself.
    cineLookScratch[0] = cineCenterScratch[0];
    cineLookScratch[1] = cineCenterScratch[1];
    cineLookScratch[2] = cineCenterScratch[2];

    applyCinematicFrame(cinePosScratch, cineLookScratch, dtMs, dt);
  }

  function update(dtMs: number): void {
    const dt = dtMs / 1000;
    const inputState = input.state;

    input.accumulatePointerDelta();

    // Cinematic mode (TASK-051): yields to the user instantly like goTo — any
    // translate key or look drag past the 2 px deadzone cancels and resumes free
    // flight this same frame.
    if (cinematic !== null) {
      const hasTranslate =
        inputState.forward ||
        inputState.back ||
        inputState.left ||
        inputState.right ||
        inputState.up ||
        inputState.down;
      const hasLook = inputState.lookDeltaX !== 0 || inputState.lookDeltaY !== 0;
      if (hasTranslate || hasLook) {
        cancelCinematic();
      } else {
        if (cinematic.kind === 'spline') updateSplineFrame(dtMs, dt);
        else updateOrbitFrame(dtMs, dt);
        input.consumeLookDelta();
        maybeSwitchContext();
        return;
      }
    }

    // GoTo cancellation: any translate key or look drag > 2 px deadzone
    if (activeGoTo !== null) {
      const hasTranslate =
        inputState.forward ||
        inputState.back ||
        inputState.left ||
        inputState.right ||
        inputState.up ||
        inputState.down;
      const hasLook =
        inputState.lookDeltaX !== 0 || inputState.lookDeltaY !== 0;
      if (hasTranslate || hasLook) {
        cancelGoTo();
      }
    }

    if (activeGoTo !== null) {
      updateGoToFrame(dtMs, dt);
      input.consumeLookDelta();
      maybeSwitchContext();
      return;
    }

    // ── Free flight ───────────────────────────────────────────────────────────

    applyLook(inputState.lookDeltaX, inputState.lookDeltaY);
    input.consumeLookDelta();

    const targetSpeed = clamp(speedScale * distanceToNearestSurface, minSpeed, maxSpeed);
    let speedMult = 1;
    if (inputState.speedBoost) speedMult *= 10;
    if (inputState.speedSlow) speedMult *= 0.1;

    rotateVecByQuat(orientation, [0, 0, -1], forwardScratch);
    rotateVecByQuat(orientation, [1, 0, 0], rightScratch);

    wishScratch[0] = 0;
    wishScratch[1] = 0;
    wishScratch[2] = 0;
    if (inputState.forward) {
      wishScratch[0] += forwardScratch[0];
      wishScratch[1] += forwardScratch[1];
      wishScratch[2] += forwardScratch[2];
    }
    if (inputState.back) {
      wishScratch[0] -= forwardScratch[0];
      wishScratch[1] -= forwardScratch[1];
      wishScratch[2] -= forwardScratch[2];
    }
    if (inputState.right) {
      wishScratch[0] += rightScratch[0];
      wishScratch[1] += rightScratch[1];
      wishScratch[2] += rightScratch[2];
    }
    if (inputState.left) {
      wishScratch[0] -= rightScratch[0];
      wishScratch[1] -= rightScratch[1];
      wishScratch[2] -= rightScratch[2];
    }
    if (inputState.up) {
      wishScratch[0] += upScratch[0];
      wishScratch[1] += upScratch[1];
      wishScratch[2] += upScratch[2];
    }
    if (inputState.down) {
      wishScratch[0] -= upScratch[0];
      wishScratch[1] -= upScratch[1];
      wishScratch[2] -= upScratch[2];
    }

    const wishLen = Math.hypot(wishScratch[0], wishScratch[1], wishScratch[2]);
    const targetVelX =
      wishLen > 0 ? (wishScratch[0] / wishLen) * targetSpeed * speedMult : 0;
    const targetVelY =
      wishLen > 0 ? (wishScratch[1] / wishLen) * targetSpeed * speedMult : 0;
    const targetVelZ =
      wishLen > 0 ? (wishScratch[2] / wishLen) * targetSpeed * speedMult : 0;

    const decay =
      dtMs <= 0 ? 0 : Math.exp((-Math.LN2 * dtMs) / dampingHalfLifeMs);
    velScratch[0] = targetVelX + (velScratch[0] - targetVelX) * decay;
    velScratch[1] = targetVelY + (velScratch[1] - targetVelY) * decay;
    velScratch[2] = targetVelZ + (velScratch[2] - targetVelZ) * decay;

    speedUnitsPerS = Math.hypot(velScratch[0], velScratch[1], velScratch[2]);

    posScratch[0] += velScratch[0] * dt;
    posScratch[1] += velScratch[1] * dt;
    posScratch[2] += velScratch[2] * dt;

    const universePos: UniversePosition = {
      context: origin.context,
      local: [posScratch[0], posScratch[1], posScratch[2]],
    };
    const rebase = origin.setCameraPosition(universePos);
    if (rebase) applyRebase(rebase);

    maybeSwitchContext();
  }

  return {
    state: flightState,
    attach: (el) => input.attach(el),
    setDistanceToNearestSurface(units: number): void {
      distanceToNearestSurface = Math.max(units, 1e-30);
    },
    update,
    applyRebase,
    goTo,
    cancelGoTo,
    get goToActive() {
      return activeGoTo !== null;
    },
    onGoToEnd,
    setSystemAnchor,
    get systemAnchor() {
      return systemAnchor;
    },
    get contextId() {
      return origin.context;
    },
    onContextSwitch,
    setGalaxyAnchor,
    get galaxyAnchor() {
      return galaxyAnchor;
    },
    playSpline,
    orbitBody,
    pauseCinematic,
    resumeCinematic,
    cancelCinematic,
    get cinematicActive() {
      return cinematic !== null;
    },
    get letterboxActive() {
      return cinematic !== null && cinematic.kind === 'spline' && cinematic.letterbox;
    },
  };
}
