import { describe, it, expect } from 'vitest';
import type { StarBatch } from '@cosmos/core-types';
import type { PrefixRange } from './octree-combined';
import { pickNearestGaia, gaiaHitWins, type OctreePickTile, type GaiaPickHit } from './octree-pick';

/**
 * TASK-088 D1/D3 contract (Task B of the "Gaia realness" reframe —
 * docs/research/gaia-pick-identity-gap.md). `pickNearestGaia` is the pure, WebGL-free heart of
 * the octree-stream pick: it claims ONLY gaia stars (a hit in a hyg-v41 sub-range of a mixed
 * tile is never surfaced — the octree branch emits only `gaia:*`). `gaiaHitWins` is the
 * cross-source arbitration StarScene runs (extracted so the additive-branch guarantee is
 * unit-testable, gate 4). These tests ARE the contract; the WebGL adaptation (live mounts) is
 * exercised only by the e2e reference spec.
 */

/** Build a tile-local StarBatch from ABSOLUTE positions + its originPc (the decoder rebases the
 *  same way: tile-local = absolute − originPc). `catalogIds` length sets `count`. */
function makeBatch(opts: {
  readonly absPositions: readonly (readonly [number, number, number])[];
  readonly catalogIds: readonly number[];
  readonly originPc?: readonly [number, number, number];
  readonly idPrefix?: string;
}): StarBatch {
  const origin = opts.originPc ?? [0, 0, 0];
  const n = opts.catalogIds.length;
  const positionsPc = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positionsPc[i * 3] = opts.absPositions[i]![0] - origin[0];
    positionsPc[i * 3 + 1] = opts.absPositions[i]![1] - origin[1];
    positionsPc[i * 3 + 2] = opts.absPositions[i]![2] - origin[2];
  }
  return {
    count: n,
    originPc: origin as [number, number, number],
    positionsPc,
    absMag: new Float32Array(n),
    colorIndexBV: new Float32Array(n),
    catalogIds: Uint32Array.from(opts.catalogIds),
    hipIds: new Uint32Array(n),
    idPrefix: opts.idPrefix ?? 'gaia',
  };
}

const CAM: readonly [number, number, number] = [0, 0, 0];
const RAY_X: readonly [number, number, number] = [1, 0, 0]; // +x
const MAX = 0.1;

describe('pickNearestGaia — pure gaia-range pick (TASK-088 D1)', () => {
  it('(a/c) returns the nearest gaia star for a ray aimed at it, scanning the WHOLE full-width batch', () => {
    // Full-width single gaia range; the on-ray star is the LAST index → a whole-batch scan is
    // required to find it (guards an offset/count off-by-one).
    const batch = makeBatch({
      absPositions: [
        [10, 3, 0], // idx0, far off-axis
        [10, 1, 0], // idx1
        [10, 0, 0], // idx2, exactly on the +x ray (angle 0)
      ],
      catalogIds: [300, 301, 302],
    });
    const tiles: OctreePickTile[] = [
      { batch, ranges: [{ offset: 0, count: 3, idPrefix: 'gaia' }] },
    ];
    const hit = pickNearestGaia(tiles, CAM, RAY_X, MAX);
    // eslint-disable-next-line no-console
    console.log(`D1(a/c): ray=${JSON.stringify(RAY_X)} → catalogId=${hit?.catalogId}`);
    expect(hit?.catalogId).toBe(302);
    expect(hit?.angleRad).toBeCloseTo(0, 6);
  });

  it('(b) ignores a NEARER hyg-v41 star in a mixed tile — returns the nearest GAIA, never a hyg catalogId', () => {
    // idx0 (hyg) is exactly on the ray (angle 0) and nearer than any gaia; the pick must still
    // return the nearest GAIA (idx2), proving it never claims a hyg-range index.
    const batch = makeBatch({
      absPositions: [
        [10, 0, 0], // idx0 hyg — ON the ray, would win if hyg were a candidate
        [10, 1, 0], // idx1 hyg
        [10, 0.2, 0], // idx2 gaia — small angle (~0.02 rad)
        [10, 2, 0], // idx3 gaia — outside threshold
      ],
      catalogIds: [100, 101, 200, 201],
    });
    const ranges: PrefixRange[] = [
      { offset: 0, count: 2, idPrefix: 'hyg-v41' },
      { offset: 2, count: 2, idPrefix: 'gaia' },
    ];
    const hit = pickNearestGaia([{ batch, ranges }], CAM, RAY_X, 0.05);
    // eslint-disable-next-line no-console
    console.log(`D1(b): mixed tile → catalogId=${hit?.catalogId} (expect gaia 200, not hyg 100)`);
    expect(hit?.catalogId).toBe(200);
  });

  it('(d) a gaia-absent tile (only hyg-v41 ranges) → null, even with a star on the ray', () => {
    const batch = makeBatch({
      absPositions: [
        [10, 0, 0], // on the ray, but hyg
        [10, 1, 0],
      ],
      catalogIds: [100, 101],
      idPrefix: 'hyg-v41',
    });
    const hit = pickNearestGaia(
      [{ batch, ranges: [{ offset: 0, count: 2, idPrefix: 'hyg-v41' }] }],
      CAM,
      RAY_X,
      MAX,
    );
    expect(hit).toBeNull();
  });

  it('empty tile list → null', () => {
    expect(pickNearestGaia([], CAM, RAY_X, MAX)).toBeNull();
  });

  it('a gaia star outside maxAngleRad → null', () => {
    const batch = makeBatch({ absPositions: [[10, 5, 0]], catalogIds: [400] }); // ~0.46 rad off
    const hit = pickNearestGaia(
      [{ batch, ranges: [{ offset: 0, count: 1, idPrefix: 'gaia' }] }],
      CAM,
      RAY_X,
      0.02,
    );
    expect(hit).toBeNull();
  });

  it('rebases the ray origin by batch.originPc (tile-local parsecs)', () => {
    // Camera and tile both offset by +5 in x; the star sits at absolute [15,0,0], i.e. tile-local
    // [10,0,0] with origin [5,0,0]. A correct rebase puts it on the +x ray from the camera.
    const batch = makeBatch({
      absPositions: [[15, 0, 0]],
      catalogIds: [500],
      originPc: [5, 0, 0],
    });
    const hit = pickNearestGaia(
      [{ batch, ranges: [{ offset: 0, count: 1, idPrefix: 'gaia' }] }],
      [5, 0, 0],
      RAY_X,
      MAX,
    );
    expect(hit?.catalogId).toBe(500);
    expect(hit?.angleRad).toBeCloseTo(0, 6);
  });

  it('picks the global nearest gaia ACROSS tiles', () => {
    const near = makeBatch({ absPositions: [[10, 0.1, 0]], catalogIds: [10] });
    const far = makeBatch({ absPositions: [[10, 0.5, 0]], catalogIds: [20] });
    const hit = pickNearestGaia(
      [
        { batch: far, ranges: [{ offset: 0, count: 1, idPrefix: 'gaia' }] },
        { batch: near, ranges: [{ offset: 0, count: 1, idPrefix: 'gaia' }] },
      ],
      CAM,
      RAY_X,
      MAX,
    );
    expect(hit?.catalogId).toBe(10);
  });
});

describe('gaiaHitWins — cross-source arbitration (TASK-088 D3, gate 4 additivity)', () => {
  const gaia: GaiaPickHit = { catalogId: 7, angleRad: 0.01, distancePc: 10 };

  it('a null gaia hit never wins (octree pick off / empty holder → hyg/exo result unchanged)', () => {
    expect(gaiaHitWins(null, 0.02)).toBe(false);
    expect(gaiaHitWins(null, null)).toBe(false);
  });

  it('a FARTHER gaia hit loses to the hyg/exo hit (existing id returned unchanged)', () => {
    // gaia angle 0.01 is LARGER than the star angle 0.005 → star wins.
    expect(gaiaHitWins(gaia, 0.005)).toBe(false);
  });

  it('a NEARER gaia hit wins; a gaia hit with no competing star hit wins', () => {
    expect(gaiaHitWins(gaia, 0.05)).toBe(true); // gaia nearer than star
    expect(gaiaHitWins(gaia, null)).toBe(true); // no hyg/exo star at all
  });
});
