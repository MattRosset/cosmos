import type * as THREE from 'three';

/** J2000 epoch (Phase 0 stub until sim-time lands). */
export const J2000_EPOCH_JD = 2451545.0;

/** Tab-switch protection: wall-clock delta clamp (architecture §5.4). */
export const MAX_DT_MS = 100;

/** Runs before all public priorities — populates the shared FrameContext. */
export const PRIORITY_FRAME_CONTEXT = -1000;

/** Frame-loop ordering (lower runs earlier). Matches §3 data flow. */
export const PRIORITY_NAV = -200;
export const PRIORITY_COORDS = -100;
export const PRIORITY_STREAMING = -50;
export const PRIORITY_RENDER = 0;

/** Per-frame data passed to subscribers (architecture §5.1). */
export interface FrameContext {
  readonly camera: THREE.PerspectiveCamera;
  /** Wall-clock delta, CLAMPED to 100 ms (tab-switch protection, §5.4). */
  readonly dtMs: number;
  /** Simulation epoch. Phase 0 stub: constant J2000 until sim-time lands. */
  readonly epochJD: number;
}

export type FrameCallback = (ctx: FrameContext) => void;

/** Reused every frame — fields mutated in place, no per-frame allocation. */
const mutableFrameContext = {
  camera: null as unknown as THREE.PerspectiveCamera,
  dtMs: 0,
  epochJD: J2000_EPOCH_JD,
};

export const sharedFrameContext: FrameContext = mutableFrameContext;

export function updateSharedFrameContext(
  camera: THREE.PerspectiveCamera,
  deltaSec: number,
): void {
  mutableFrameContext.camera = camera;
  mutableFrameContext.dtMs = Math.min(deltaSec * 1000, MAX_DT_MS);
  mutableFrameContext.epochJD = J2000_EPOCH_JD;
}
