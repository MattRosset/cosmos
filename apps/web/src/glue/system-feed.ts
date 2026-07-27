import type * as THREE from 'three';
import type { BodyId } from '@cosmos/core-types';

/**
 * Shared, per-frame state published by the mounted SystemScene and consumed by
 * NavDriver (nearest-surface speed feed) and goto.ts (live planet positions for
 * "Go to" while a system is anchored). Written imperatively each frame — never
 * through React (§2.2). Inactive between system mounts.
 */
export interface SystemFeed {
  /** True while a system scene is mounted and has been built. */
  active: boolean;
  /** Number of bodies tracked (planets + moons + sun disc). */
  count: number;
  /** 3 × count absolute system positions, AU, galactic axes (system origin = host). */
  positionsAu: Float64Array;
  /** count radii in context units (AU): radiusKm × 1000 / AU_meters. */
  radiiUnits: Float64Array;
  /** bodyId → index into positionsAu / radiiUnits. Reassigned per mount. */
  indexById: Map<BodyId, number>;
  /**
   * 3 × count camera-relative render offsets, ACTIVE-CONTEXT units (TASK-084) — the
   * same values `SystemScene` passes to `mesh.setRenderOffset` each frame, mirrored
   * here so e2e (`__cosmos.systemBody`) can query the real offset without re-deriving
   * `OriginManager.toRenderSpace` (CLAUDE.md testing rule 1).
   */
  renderOffsetsContextUnits: Float64Array;
}

export const systemFeed: SystemFeed = {
  active: false,
  count: 0,
  positionsAu: new Float64Array(0),
  radiiUnits: new Float64Array(0),
  indexById: new Map(),
  renderOffsetsContextUnits: new Float64Array(0),
};

/**
 * The mounted system's mesh group, for click-picking. StarScene raycasts this
 * FIRST (planets win over stars), then falls back to the star batches. null when
 * no system is mounted.
 */
export const systemPickGroup: { current: THREE.Group | null } = { current: null };

/** Mark the feed inactive on system unmount (buffers are GC'd with the scene). */
export function deactivateSystemFeed(): void {
  systemFeed.active = false;
  systemFeed.count = 0;
  systemFeed.indexById = new Map();
}
