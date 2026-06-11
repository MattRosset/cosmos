/**
 * @cosmos/coords public API — frozen at the end of Phase 0 (TASK-006).
 * See docs/decisions/ADR-001-coordinates.md and TASK-003.
 */
export type { Vec3Tuple, ScaleFrameTree } from './frame-tree';
export { createScaleFrameTree } from './frame-tree';
export type { RebaseEvent, OriginManager } from './origin';
export { createOriginManager } from './origin';
