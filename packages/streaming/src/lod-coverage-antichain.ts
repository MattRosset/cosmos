import type { MortonKey } from '@cosmos/core-types';

export type MortonKeyPredicate = (key: MortonKey) => boolean;
export type MortonParentLookup = (key: MortonKey) => MortonKey | null;

/**
 * True iff `parentId` or one of its cached ancestors satisfies `isMarked`.
 * The original chunk key is never queried. null returns false.
 *
 * Performs no Morton parsing and allocates nothing; `parentOf` supplies the
 * creation-time cache.
 */
export function hasMarkedAncestor(
  parentId: MortonKey | null,
  parentOf: MortonParentLookup,
  isMarked: MortonKeyPredicate,
): boolean {
  let key = parentId;
  while (key !== null) {
    if (isMarked(key)) return true;
    key = parentOf(key);
  }
  return false;
}
