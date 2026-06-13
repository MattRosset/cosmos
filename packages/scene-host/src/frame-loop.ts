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

/**
 * Called exactly once per frame, BEFORE all subscribers (at
 * PRIORITY_FRAME_CONTEXT), with the CLAMPED wall delta (≤ MAX_DT_MS).
 * Return value becomes FrameContext.epochJD for this frame.
 * Typical app wiring: (dtMs) => { clock.advance(dtMs); return clock.epochJD; }
 */
export type EpochProvider = (dtMs: number) => number;

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

let hasWarnedNonFiniteEpoch = false;

export function updateSharedFrameContext(
  camera: THREE.PerspectiveCamera,
  deltaSec: number,
  epochProvider?: EpochProvider | null,
): void {
  mutableFrameContext.camera = camera;
  const clampedDtMs = Math.min(deltaSec * 1000, MAX_DT_MS);
  mutableFrameContext.dtMs = clampedDtMs;

  if (epochProvider) {
    const epoch = epochProvider(clampedDtMs);
    if (Number.isFinite(epoch)) {
      mutableFrameContext.epochJD = epoch;
    } else {
      if (!hasWarnedNonFiniteEpoch) {
        console.warn(
          'EpochProvider returned non-finite value; retaining previous epoch',
        );
        hasWarnedNonFiniteEpoch = true;
      }
    }
  } else {
    mutableFrameContext.epochJD = J2000_EPOCH_JD;
  }
}
