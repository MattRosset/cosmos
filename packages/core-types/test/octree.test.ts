import { describe, expect, it } from 'vitest';
import {
  INTERNAL_TILE_POINTS,
  MAX_OCTREE_LEVEL,
  MAX_POINTS_PER_TILE,
  MAX_TILE_BYTES,
  OCTREE_FORMAT_VERSION,
  childCell,
  decodeMortonKey,
  encodeMortonKey,
  parentCell,
  type OctreeManifest,
} from '../src/octree';
import { createPrng } from '../src/prng';

describe('octree constants', () => {
  it('has correct values', () => {
    expect(OCTREE_FORMAT_VERSION).toBe(1);
    expect(MAX_OCTREE_LEVEL).toBe(16);
    expect(MAX_POINTS_PER_TILE).toBe(32768);
    expect(MAX_TILE_BYTES).toBe(524288);
    expect(INTERNAL_TILE_POINTS).toBe(4096);
  });
});

describe('Morton round-trip', () => {
  it('encodes and decodes 1000 seeded random cells', () => {
    const rng = createPrng(2026_03_31);
    for (let n = 0; n < 1000; n++) {
      const level = rng.int(0, MAX_OCTREE_LEVEL);
      const maxIdx = Math.pow(2, level) - 1;
      const ix = maxIdx === 0 ? 0 : rng.int(0, maxIdx);
      const iy = maxIdx === 0 ? 0 : rng.int(0, maxIdx);
      const iz = maxIdx === 0 ? 0 : rng.int(0, maxIdx);
      const cell = { level, ix, iy, iz };
      expect(decodeMortonKey(encodeMortonKey(cell))).toStrictEqual(cell);
    }
  });
});

describe('childCell ordering', () => {
  it('yields 8 unit cells with correct ix,iy,iz from root', () => {
    const root = { level: 0, ix: 0, iy: 0, iz: 0 };
    for (let c = 0; c < 8; c++) {
      const ch = childCell(root, c);
      expect(ch.level).toBe(1);
      expect(ch.ix).toBe(c & 1);
      expect(ch.iy).toBe((c >> 1) & 1);
      expect(ch.iz).toBe((c >> 2) & 1);
    }
  });

  it('parentCell(childCell(c, k)) deep-equals c for arbitrary cells', () => {
    const rng = createPrng(42);
    for (let n = 0; n < 200; n++) {
      const level = rng.int(0, MAX_OCTREE_LEVEL - 1);
      const maxIdx = Math.pow(2, level) - 1;
      const cell = {
        level,
        ix: maxIdx === 0 ? 0 : rng.int(0, maxIdx),
        iy: maxIdx === 0 ? 0 : rng.int(0, maxIdx),
        iz: maxIdx === 0 ? 0 : rng.int(0, maxIdx),
      };
      const k = rng.int(0, 7);
      expect(parentCell(childCell(cell, k))).toStrictEqual(cell);
    }
  });

  it('parentCell at level 0 throws RangeError', () => {
    expect(() => parentCell({ level: 0, ix: 0, iy: 0, iz: 0 })).toThrow(RangeError);
  });

  it('childCell at MAX_OCTREE_LEVEL throws RangeError', () => {
    expect(() =>
      childCell({ level: MAX_OCTREE_LEVEL, ix: 0, iy: 0, iz: 0 }, 0),
    ).toThrow(RangeError);
  });
});

describe('BigInt Morton key handling', () => {
  it('level-16 all-ones cell uses BigInt internally and round-trips correctly', () => {
    // At level 16, 3*16=48 interleaved bits; all-ones indices fill all 48 bit positions.
    // The combined code (2^48-1) is stored as a BigInt decimal string (the format is
    // designed for up to level 21 = 63 bits, which exceeds Number.MAX_SAFE_INTEGER).
    const cell = { level: 16, ix: 65535, iy: 65535, iz: 65535 };
    const key = encodeMortonKey(cell);
    const mortonDecimal = key.slice(key.indexOf('/') + 1);
    // Verify the encoded decimal represents the correct BigInt value (2^48 - 1)
    expect(BigInt(mortonDecimal)).toBe(2n ** 48n - 1n);
    expect(decodeMortonKey(key)).toStrictEqual(cell);
  });

  it('level-16 cell with distinct large indices encodes correctly', () => {
    const cell = { level: 16, ix: 65535, iy: 32768, iz: 49152 };
    expect(decodeMortonKey(encodeMortonKey(cell))).toStrictEqual(cell);
  });

  it('MortonKey decimal is the BigInt base-10 string', () => {
    // Known value: cell {level:1, ix:1, iy:0, iz:0} → Morton code = spread3(1) = 1
    expect(encodeMortonKey({ level: 1, ix: 1, iy: 0, iz: 0 })).toBe('1/1');
    // cell {level:1, ix:0, iy:1, iz:0} → spread3(1)<<1 = 2
    expect(encodeMortonKey({ level: 1, ix: 0, iy: 1, iz: 0 })).toBe('1/2');
    // cell {level:1, ix:0, iy:0, iz:1} → spread3(1)<<2 = 4
    expect(encodeMortonKey({ level: 1, ix: 0, iy: 0, iz: 1 })).toBe('1/4');
    // cell {level:1, ix:1, iy:1, iz:1} → 1|2|4 = 7
    expect(encodeMortonKey({ level: 1, ix: 1, iy: 1, iz: 1 })).toBe('1/7');
  });
});

describe('compile-time shape checks', () => {
  it('OctreeManifest octreeFormatVersion must be the literal 1', () => {
    // Verifying the field type is `typeof OCTREE_FORMAT_VERSION` (the literal 1).
    const v: OctreeManifest['octreeFormatVersion'] = 1;
    expect(v).toBe(1);
    // @ts-expect-error — must be literal 1, not an arbitrary number
    const bad: OctreeManifest['octreeFormatVersion'] = 2;
    expect(bad).toBe(2); // runtime still assigns, but TS rejects it
  });
});
