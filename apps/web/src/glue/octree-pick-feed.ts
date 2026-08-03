import type { StarBatch } from '@cosmos/core-types';

/**
 * Currently-visible octree tiles for the star pick (TASK-088 D2). Published by GalaxyScene each
 * time its visible octree mount set changes (mount / evict / per-frame visibility flip); read
 * inside `StarScene.pickAt`. Mirrors the `localGroupPickHolder` / `systemPickGroup` precedent: a
 * module-scoped `{ current }` a producer scene writes imperatively, a consumer scene reads.
 *
 * `chunkId` is the MortonKey — exactly the key `CombinedOctreeSource.prefixRangesFor(key)` is
 * keyed by (Step 0b: same `loadTile(key)` call populated both), so StarScene pairs each
 * `{ chunkId, batch }` with `prefixRangesFor(chunkId)` at click time. `PrefixRange` is
 * deliberately NOT carried here — GalaxyScene has no `CombinedOctreeSource` to read it from
 * (D2 rationale). `null` when no galaxy stream is mounted / visible.
 */
export interface OctreePickMount {
  readonly chunkId: string;
  readonly batch: StarBatch;
}

export const octreePickHolder: { current: readonly OctreePickMount[] | null } = {
  current: null,
};
