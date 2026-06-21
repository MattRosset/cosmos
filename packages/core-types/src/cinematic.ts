/**
 * Cinematic camera spline. See docs/architecture.md §5.3 / §5.12.
 *
 * Keyframes carry UniversePositions so a path survives context switches (animate in
 * the target frame, §5.3). Played back by `nav` v5 (TASK-051). Data contract only.
 */

import type { UniversePosition } from './coords';

/** A keyframe on a camera spline. Position is a UniversePosition so the path
 *  survives context switches (animate in the target frame, §5.3). */
export interface CameraKeyframe {
  readonly at: UniversePosition;
  /** Look-at target, same context as `at`. */
  readonly lookAt: UniversePosition;
  /** Arrival time along the path, ms from path start (monotonic increasing). */
  readonly timeMs: number;
}

/** A Catmull-Rom camera spline played back by `nav` v5 (TASK-051). */
export interface CameraSpline {
  readonly id: string;
  readonly keyframes: readonly CameraKeyframe[];
  /** Letterbox the viewport during playback (cinematic chrome, §5.12). */
  readonly letterbox?: boolean;
}
