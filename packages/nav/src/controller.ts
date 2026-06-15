import {
  CONTEXT_UNIT_METERS,
  type BodyId,
  type ContextId,
  type UniversePosition,
} from '@cosmos/core-types';
import type { OriginManager, RebaseEvent } from '@cosmos/coords';
import { createInputHandler, type InputHandler } from './input.js';
import { computeGoToK } from './goto.js';
import {
  resolveContextSwitchPolicy,
  shouldEnterSystem,
  shouldExitSystem,
  type ContextSwitchEvent,
  type ContextSwitchPolicy,
  type SystemAnchor,
} from './context-switch.js';

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

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SPEED_SCALE = 1.0;
const DEFAULT_MIN_SPEED = 1e-7;
const DEFAULT_MAX_SPEED = 1e7;
const DEFAULT_DAMPING_HALF_LIFE_MS = 90;
const LOOK_SENSITIVITY = 0.002;
const MAX_PITCH = Math.PI / 2 - 1e-4;

// ── Module-scoped scratch (free-flight path) ─────────────────────────────────

const posScratch: [number, number, number] = [0, 0, 0];
const velScratch: [number, number, number] = [0, 0, 0];
const wishScratch: [number, number, number] = [0, 0, 0];
const forwardScratch: [number, number, number] = [0, 0, 0];
const rightScratch: [number, number, number] = [0, 0, 0];
const upScratch: [number, number, number] = [0, 0, 1];
const quatScratch: [number, number, number, number] = [0, 0, 0, 1];
const axisScratch: [number, number, number] = [0, 0, 0];
const deltaQuatScratch: [number, number, number, number] = [0, 0, 0, 1];

// ── Module-scoped scratch (goTo path — no allocations in update during goTo) ──

const gotoRenderScratch: [number, number, number] = [0, 0, 0];
/** Render-space vector to the lookAt point (facing target), when one is set. */
const gotoLookScratch: [number, number, number] = [0, 0, 0];
const gotoAxisScratch: [number, number, number] = [0, 0, 0];
const gotoQDeltaScratch: [number, number, number, number] = [0, 0, 0, 1];
const gotoQTempScratch: [number, number, number, number] = [0, 0, 0, 1];
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

/** Test hook: module-scoped scratch used by update() — same identity every frame. */
export const UPDATE_SCRATCH = {
  pos: posScratch,
  vel: velScratch,
  wish: wishScratch,
  gotoRender: gotoRenderScratch,
  gotoAxis: gotoAxisScratch,
  ctxAnchor: anchorLocalScratch,
  ctxRender: ctxRenderScratch,
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

function clampPitch(q: [number, number, number, number]): void {
  rotateVecByQuat(q, [0, 0, -1], forwardScratch);
  const pitch = Math.asin(clamp(forwardScratch[1], -1, 1));
  if (Math.abs(pitch) <= MAX_PITCH) return;

  const yaw = Math.atan2(forwardScratch[0], forwardScratch[2]);
  const clampedPitch = clamp(pitch, -MAX_PITCH, MAX_PITCH);
  const halfYaw = yaw * 0.5;
  const halfPitch = clampedPitch * 0.5;
  const cy = Math.cos(halfYaw);
  const sy = Math.sin(halfYaw);
  const cx = Math.cos(halfPitch);
  const sx = Math.sin(halfPitch);
  q[0] = sx * cy;
  q[1] = sy * cx;
  q[2] = -sy * sx;
  q[3] = cx * cy;
  quatNormalize(q);
}

function applyLook(
  orientation: [number, number, number, number],
  deltaX: number,
  deltaY: number,
): void {
  if (deltaX === 0 && deltaY === 0) return;

  if (deltaX !== 0) {
    axisScratch[0] = 0;
    axisScratch[1] = 1;
    axisScratch[2] = 0;
    quatFromAxisAngle(axisScratch, -deltaX * LOOK_SENSITIVITY, deltaQuatScratch);
    quatMultiply(deltaQuatScratch, orientation, quatScratch);
    orientation[0] = quatScratch[0];
    orientation[1] = quatScratch[1];
    orientation[2] = quatScratch[2];
    orientation[3] = quatScratch[3];
  }

  if (deltaY !== 0) {
    rotateVecByQuat(orientation, [1, 0, 0], axisScratch);
    const len = Math.hypot(axisScratch[0], axisScratch[1], axisScratch[2]);
    if (len > 1e-20) {
      axisScratch[0] /= len;
      axisScratch[1] /= len;
      axisScratch[2] /= len;
      quatFromAxisAngle(axisScratch, -deltaY * LOOK_SENSITIVITY, deltaQuatScratch);
      quatMultiply(deltaQuatScratch, orientation, quatScratch);
      orientation[0] = quatScratch[0];
      orientation[1] = quatScratch[1];
      orientation[2] = quatScratch[2];
      orientation[3] = quatScratch[3];
    }
  }

  quatNormalize(orientation);
  clampPitch(orientation);
}

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

  posScratch[0] = opts.initial.position.local[0];
  posScratch[1] = opts.initial.position.local[1];
  posScratch[2] = opts.initial.position.local[2];

  velScratch[0] = 0;
  velScratch[1] = 0;
  velScratch[2] = 0;

  let distanceToNearestSurface = 1;
  let speedUnitsPerS = 0;
  let activeGoTo: GoToState | null = null;

  // Context switching (TASK-027)
  const policy = resolveContextSwitchPolicy(opts.contextSwitchPolicy);
  let systemAnchor: SystemAnchor | null = null;
  const contextSwitchCallbacks: Array<(e: ContextSwitchEvent) => void> = [];

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

    // 3. Orientation slerp toward the FACING direction: the lookAt point when one
    //    is set (dolly-back framing), else the travel direction (normal fly-to).
    rotateVecByQuat(orientation, FORWARD_LOCAL, forwardScratch);
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
    const dot = clamp(
      forwardScratch[0] * tDirX + forwardScratch[1] * tDirY + forwardScratch[2] * tDirZ,
      -1,
      1,
    );

    if (dot < 1 - 1e-10) {
      let axLen: number;
      if (dot < -1 + 1e-10) {
        // Opposite direction — pick arbitrary perpendicular axis
        gotoAxisScratch[0] = 1;
        gotoAxisScratch[1] = 0;
        gotoAxisScratch[2] = 0;
        axLen = 1;
      } else {
        gotoAxisScratch[0] = forwardScratch[1] * tDirZ - forwardScratch[2] * tDirY;
        gotoAxisScratch[1] = forwardScratch[2] * tDirX - forwardScratch[0] * tDirZ;
        gotoAxisScratch[2] = forwardScratch[0] * tDirY - forwardScratch[1] * tDirX;
        axLen = Math.hypot(gotoAxisScratch[0], gotoAxisScratch[1], gotoAxisScratch[2]);
        if (axLen > 1e-20) {
          const invAx = 1 / axLen;
          gotoAxisScratch[0] *= invAx;
          gotoAxisScratch[1] *= invAx;
          gotoAxisScratch[2] *= invAx;
        }
      }

      if (axLen > 1e-20) {
        const T = durationMs / 5;
        const alpha = 1 - Math.exp(-dtMs / T);
        const fullAngle = Math.acos(dot);
        quatFromAxisAngle(gotoAxisScratch, fullAngle * alpha, gotoQDeltaScratch);
        quatMultiply(gotoQDeltaScratch, orientation, gotoQTempScratch);
        orientation[0] = gotoQTempScratch[0];
        orientation[1] = gotoQTempScratch[1];
        orientation[2] = gotoQTempScratch[2];
        orientation[3] = gotoQTempScratch[3];
        quatNormalize(orientation);
      }
    }

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
    // point — but it is only MEANINGFUL if the glue set the tree's 'system'
    // anchor to positionPc, which places the host star at the system origin.
    // Cheap check on enter: the anchor's absolute system coordinate must be ≈ 0.
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

    if (contextSwitchCallbacks.length > 0) {
      const event: ContextSwitchEvent = { from, to, anchorId };
      const cbs = contextSwitchCallbacks.slice();
      for (const cb of cbs) cb(event);
    }
  }

  /**
   * Switch law (TASK-027). Runs at the END of update(), after the camera's new
   * position is final for the frame. At most ONE switch per call — the
   * hysteresis gap guarantees enter and exit cannot both fire.
   */
  /** Camera↔anchor distance in meters: the only sanctioned cross-context
   *  measurement (toRenderSpace of the galaxy-frame anchor, ADR-001). */
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

  function maybeSwitchContext(): void {
    const anchor = systemAnchor;
    const ctx = origin.context;

    if (ctx === 'galaxy') {
      if (anchor === null) return; // Phase-1 behavior, bit-identical.
      const dM = measureAnchorDM(anchor);
      if (shouldEnterSystem(dM, policy)) doSwitch('galaxy', 'system', anchor.id, dM);
      return;
    }

    if (ctx === 'system') {
      const cleared = anchor === null;
      const dM = cleared ? Number.NaN : measureAnchorDM(anchor!);
      if (shouldExitSystem(cleared ? 0 : dM, cleared, policy)) {
        doSwitch('system', 'galaxy', cleared ? null : anchor!.id, dM);
      }
    }
  }

  function update(dtMs: number): void {
    const dt = dtMs / 1000;
    const inputState = input.state;

    input.accumulatePointerDelta();

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

    applyLook(orientation, inputState.lookDeltaX, inputState.lookDeltaY);
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
  };
}
