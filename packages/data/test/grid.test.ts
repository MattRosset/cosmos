import { describe, expect, it } from 'vitest';
import { buildGrid, nearestStarIndex, queryRegion } from '../src/grid.js';

function makePositions(coords: readonly [number, number, number][]): Float32Array {
  const arr = new Float32Array(coords.length * 3);
  for (let i = 0; i < coords.length; i++) {
    arr[i * 3] = coords[i]![0];
    arr[i * 3 + 1] = coords[i]![1];
    arr[i * 3 + 2] = coords[i]![2];
  }
  return arr;
}

describe('buildGrid', () => {
  it('returns an empty map for zero stars', () => {
    const grid = buildGrid(new Float32Array(0), 0);
    expect(grid.size).toBe(0);
  });

  it('places stars in correct cells', () => {
    // Two stars: one at origin cell, one far away
    const pos = makePositions([[0, 0, 0], [100, 0, 0]]);
    const grid = buildGrid(pos, 2);
    // origin cell (0,0,0) and far cell (4,0,0) should each have 1 entry
    expect(grid.size).toBe(2);
    for (const arr of grid.values()) {
      expect(arr.length).toBe(1);
    }
  });

  it('stars in the same cell are grouped together', () => {
    const pos = makePositions([[1, 1, 1], [2, 2, 2], [200, 0, 0]]);
    const grid = buildGrid(pos, 3);
    // 1,1,1 and 2,2,2 both land in cell (0,0,0)
    expect(grid.size).toBe(2);
    const sizes = Array.from(grid.values()).map(a => a.length).sort((a, b) => a - b);
    expect(sizes).toEqual([1, 2]);
  });
});

describe('nearestStarIndex', () => {
  it('returns -1 for empty set', () => {
    const grid = buildGrid(new Float32Array(0), 0);
    expect(nearestStarIndex(grid, new Float32Array(0), 0, 0, 0, 0)).toBe(-1);
  });

  it('returns 0 for a single star', () => {
    const pos = makePositions([[10, 0, 0]]);
    const grid = buildGrid(pos, 1);
    expect(nearestStarIndex(grid, pos, 1, 10, 0, 0)).toBe(0);
  });

  it('matches brute-force for random probes', () => {
    let state = 7;
    function rand(): number {
      state = (state * 1664525 + 1013904223) & 0xffffffff;
      return (state >>> 0) / 0x100000000;
    }

    const COUNT = 50;
    const coords: [number, number, number][] = Array.from({ length: COUNT }, () => [
      (rand() - 0.5) * 500,
      (rand() - 0.5) * 500,
      (rand() - 0.5) * 500,
    ]);
    const pos = makePositions(coords);
    const grid = buildGrid(pos, COUNT);

    for (let trial = 0; trial < 200; trial++) {
      const qx = (rand() - 0.5) * 600;
      const qy = (rand() - 0.5) * 600;
      const qz = (rand() - 0.5) * 600;

      const idx = nearestStarIndex(grid, pos, COUNT, qx, qy, qz);

      let bestD2 = Infinity;
      let bestIdx = -1;
      for (let j = 0; j < COUNT; j++) {
        const dx = pos[j * 3]! - qx;
        const dy = pos[j * 3 + 1]! - qy;
        const dz = pos[j * 3 + 2]! - qz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestIdx = j;
        }
      }

      expect(idx).toBe(bestIdx);
    }
  });

  it('handles stars outside normal grid range (large coords)', () => {
    const pos = makePositions([[40000, 0, 0]]);
    const grid = buildGrid(pos, 1);
    const idx = nearestStarIndex(grid, pos, 1, 40000, 0, 0);
    expect(idx).toBe(0);
  });
});

describe('queryRegion', () => {
  it('returns empty for a region with no stars', () => {
    const pos = makePositions([[0, 0, 0], [10, 0, 0]]);
    const grid = buildGrid(pos, 2);
    const result = queryRegion(grid, pos, [0, 0, 0], [100, 100, 100], [200, 200, 200], 10);
    expect(result.length).toBe(0);
  });

  it('returns all stars inside the AABB', () => {
    const pos = makePositions([[5, 5, 5], [15, 15, 15], [100, 0, 0]]);
    const grid = buildGrid(pos, 3);
    // AABB in absolute coords [0,0,0]-[20,20,20], originPc=[0,0,0]
    const result = queryRegion(grid, pos, [0, 0, 0], [0, 0, 0], [20, 20, 20], 100);
    const sorted = Array.from(result).sort((a, b) => a - b);
    expect(sorted).toEqual([0, 1]);
  });

  it('respects maxCount', () => {
    const coords: [number, number, number][] = Array.from({ length: 20 }, (_, i) => [
      i * 2,
      0,
      0,
    ]);
    const pos = makePositions(coords);
    const grid = buildGrid(pos, 20);
    const result = queryRegion(grid, pos, [0, 0, 0], [-1, -1, -1], [100, 1, 1], 5);
    expect(result.length).toBe(5);
  });

  it('uses absolute coords (origin offset applied correctly)', () => {
    const pos = makePositions([[5, 5, 5]]);
    const grid = buildGrid(pos, 1);
    // tile origin at [100, 100, 100]; absolute position of star = [105, 105, 105]
    const origin: [number, number, number] = [100, 100, 100];
    const found = queryRegion(grid, pos, origin, [104, 104, 104], [106, 106, 106], 10);
    expect(found.length).toBe(1);
    // query that doesn't include the star in absolute space
    const notFound = queryRegion(grid, pos, origin, [0, 0, 0], [10, 10, 10], 10);
    expect(notFound.length).toBe(0);
  });
});
