import { describe, it, expect, vi } from 'vitest';
import type { MortonKey } from '@cosmos/core-types';
import { hasMarkedAncestor } from '../src/lod-coverage-antichain.js';

/**
 * Production helper walks only cached parent IDs — these fixtures are plain
 * key→parent maps, not Morton math. Log chosen key / marked set / result so a
 * CI-only miss is triagable from the assertion message alone.
 */
function parentMap(entries: ReadonlyArray<readonly [MortonKey, MortonKey | null]>): Map<MortonKey, MortonKey | null> {
  return new Map(entries);
}

function lookup(map: Map<MortonKey, MortonKey | null>): (key: MortonKey) => MortonKey | null {
  return (key) => (map.has(key) ? map.get(key)! : null);
}

function markedSet(keys: readonly MortonKey[]): (key: MortonKey) => boolean {
  const set = new Set(keys);
  return (key) => set.has(key);
}

describe('hasMarkedAncestor', () => {
  it('direct cached parent marked ⇒ true', () => {
    const parentId: MortonKey = '1/0';
    const parents = parentMap([['1/0', '0/0'], ['0/0', null]]);
    const marked = markedSet(['1/0']);
    const result = hasMarkedAncestor(parentId, lookup(parents), marked);
    expect(result, `key parentId=${parentId} marked=[1/0] → ${result}`).toBe(true);
  });

  it('cached grandparent marked with immediate parent unmarked ⇒ true', () => {
    const parentId: MortonKey = '2/1';
    const parents = parentMap([
      ['2/1', '1/0'],
      ['1/0', '0/0'],
      ['0/0', null],
    ]);
    const marked = markedSet(['0/0']);
    const result = hasMarkedAncestor(parentId, lookup(parents), marked);
    expect(result, `parentId=${parentId} marked=[0/0] grandparent chain → ${result}`).toBe(true);
  });

  it('sibling/cousin marked ⇒ false', () => {
    const parentId: MortonKey = '1/0';
    const parents = parentMap([['1/0', '0/0'], ['0/0', null], ['1/1', '0/0']]);
    const marked = markedSet(['1/1']); // sibling of the original chunk, not an ancestor
    const result = hasMarkedAncestor(parentId, lookup(parents), marked);
    expect(result, `parentId=${parentId} marked sibling 1/1 → ${result}`).toBe(false);
  });

  it('original chunk key is never queried (strict means strict)', () => {
    const original: MortonKey = '2/7';
    const parentId: MortonKey = '1/0';
    const parents = parentMap([['1/0', '0/0'], ['0/0', null]]);
    const isMarked = vi.fn((key: MortonKey) => key === original);
    const result = hasMarkedAncestor(parentId, lookup(parents), isMarked);
    expect(result, `parentId=${parentId} only original ${original} marked → ${result}`).toBe(false);
    expect(isMarked.mock.calls.map((c) => c[0])).not.toContain(original);
  });

  it('parentId = null ⇒ false and neither callback is called', () => {
    const parentOf = vi.fn(() => null as MortonKey | null);
    const isMarked = vi.fn(() => true);
    const result = hasMarkedAncestor(null, parentOf, isMarked);
    expect(result, `parentId=null → ${result}`).toBe(false);
    expect(parentOf).not.toHaveBeenCalled();
    expect(isMarked).not.toHaveBeenCalled();
  });

  it('a deep cached chain works without Morton parsing', () => {
    // Artificial keys — no decode/encode; only Map lookups.
    const parents = parentMap([
      ['L4', 'L3'],
      ['L3', 'L2'],
      ['L2', 'L1'],
      ['L1', 'L0'],
      ['L0', null],
    ]);
    const marked = markedSet(['L1']);
    const result = hasMarkedAncestor('L4', lookup(parents), marked);
    expect(result, `deep chain parentId=L4 marked=[L1] → ${result}`).toBe(true);
  });

  it('a missing cached parent terminates safely rather than looping', () => {
    // parentOf returns null for the unknown next hop — walk must stop.
    const parents = parentMap([['1/0', '0/missing']]); // '0/missing' not in map ⇒ null
    const marked = markedSet([]);
    const parentOf = lookup(parents);
    const result = hasMarkedAncestor('1/0', parentOf, marked);
    expect(result, `broken cache parentId=1/0 next=0/missing → ${result}`).toBe(false);
  });
});
