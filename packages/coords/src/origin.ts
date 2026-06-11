/**
 * Origin manager: camera-relative, f32-safe render positions with atomic
 * frame-start rebasing (ADR-001 §3, architecture §5.2).
 *
 * All math is f64. Subtraction happens in f64 BEFORE any downcast:
 * `render = bodyLocal - cameraLocal`. The caller downcasts the output.
 */
import type { ContextId, UniversePosition } from '@cosmos/core-types';
import { REBASE_THRESHOLD_UNITS } from '@cosmos/core-types';
import type { FrameTreeInternal, ScaleFrameTree, Vec3Tuple } from './frame-tree';

export interface RebaseEvent {
  readonly context: ContextId;
  /** Offset subtracted from all root render groups, in context units (f64). */
  readonly offsetUnits: Vec3Tuple;
}

export interface OriginManager {
  readonly context: ContextId;
  /** Camera's absolute position (f64) in the current context. */
  readonly cameraUniverse: UniversePosition;
  /**
   * Update the camera's absolute position. MUST be called exactly once per frame,
   * at frame start. Returns a RebaseEvent when |cameraLocal| exceeded
   * REBASE_THRESHOLD_UNITS (core-types) and the origin was rebased; null otherwise.
   * Rebasing is atomic: all subsequent toRenderSpace calls this frame use the new origin.
   */
  setCameraPosition(pos: UniversePosition): RebaseEvent | null;
  /** Switch the active context (converts the camera + origin into the target frame). */
  switchContext(target: ContextId): void;
  /**
   * Camera-relative position, safe to downcast to f32/GPU. Writes into `out`
   * (zero allocation in frame paths, §9) and returns it.
   */
  toRenderSpace(pos: UniversePosition, out: Vec3Tuple): Vec3Tuple;
}

// Module-scoped scratch: setCameraPosition/switchContext never allocate on the
// steady-state path. The RebaseEvent itself is allocated only when a rebase
// actually fires (rare by construction — once per ~10^4 units traveled).
const scratch: Vec3Tuple = [0, 0, 0];

export function createOriginManager(
  tree: ScaleFrameTree,
  initialCamera: UniversePosition,
): OriginManager {
  // Trees come from createScaleFrameTree, which always carries the internal
  // allocation-free conversion path.
  const frames = tree as FrameTreeInternal;

  let context: ContextId = initialCamera.context;
  // Absolute positions in the current context's units (f64).
  const cameraAbs: Vec3Tuple = [initialCamera.local[0], initialCamera.local[1], initialCamera.local[2]];
  // The render origin starts at the camera: cameraLocal = 0.
  const originAbs: Vec3Tuple = [cameraAbs[0], cameraAbs[1], cameraAbs[2]];

  return {
    get context() {
      return context;
    },

    get cameraUniverse(): UniversePosition {
      return { context, local: [cameraAbs[0], cameraAbs[1], cameraAbs[2]] };
    },

    setCameraPosition(pos) {
      frames.convertInto(pos.context, pos.local[0], pos.local[1], pos.local[2], context, scratch);
      cameraAbs[0] = scratch[0];
      cameraAbs[1] = scratch[1];
      cameraAbs[2] = scratch[2];

      const lx = cameraAbs[0] - originAbs[0];
      const ly = cameraAbs[1] - originAbs[1];
      const lz = cameraAbs[2] - originAbs[2];
      if (Math.hypot(lx, ly, lz) > REBASE_THRESHOLD_UNITS) {
        // Atomic rebase: move the origin onto the camera; every toRenderSpace
        // call after this point (this frame) uses the new origin.
        originAbs[0] += lx;
        originAbs[1] += ly;
        originAbs[2] += lz;
        return { context, offsetUnits: [lx, ly, lz] };
      }
      return null;
    },

    switchContext(target) {
      if (target === context) return;
      frames.convertInto(context, originAbs[0], originAbs[1], originAbs[2], target, scratch);
      const ox = scratch[0];
      const oy = scratch[1];
      const oz = scratch[2];
      frames.convertInto(context, cameraAbs[0], cameraAbs[1], cameraAbs[2], target, scratch);
      cameraAbs[0] = scratch[0];
      cameraAbs[1] = scratch[1];
      cameraAbs[2] = scratch[2];
      originAbs[0] = ox;
      originAbs[1] = oy;
      originAbs[2] = oz;
      context = target;
    },

    toRenderSpace(pos, out) {
      frames.convertInto(pos.context, pos.local[0], pos.local[1], pos.local[2], context, out);
      // render = bodyLocal - cameraLocal, both relative to the render origin,
      // subtracted in f64 — only the caller downcasts to f32.
      out[0] = out[0] - originAbs[0] - (cameraAbs[0] - originAbs[0]);
      out[1] = out[1] - originAbs[1] - (cameraAbs[1] - originAbs[1]);
      out[2] = out[2] - originAbs[2] - (cameraAbs[2] - originAbs[2]);
      return out;
    },
  };
}
