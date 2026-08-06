import { describe, it, expect } from 'vitest';
import type { StarBatch } from '@cosmos/core-types';
import {
  effectiveStarExposure,
  sampleRenderedStar,
  NATURAL_VISIBILITY_PROFILE,
  SURVEY_VISIBILITY_PROFILE,
  STAR_PERCEPTIBILITY_FLOOR,
} from '@cosmos/photometry';
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
  /** Per-index absolute magnitude. Defaults to all-zeros (bright at ~10pc/150 exposure) so
   *  pre-TASK-100 fixtures stay perceptible with the exposure gate threaded through. */
  readonly absMag?: readonly number[];
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
    absMag: opts.absMag ? Float32Array.from(opts.absMag) : new Float32Array(n),
    colorIndexBV: new Float32Array(n),
    catalogIds: Uint32Array.from(opts.catalogIds),
    hipIds: new Uint32Array(n),
    idPrefix: opts.idPrefix ?? 'gaia',
  };
}

const CAM: readonly [number, number, number] = [0, 0, 0];
const RAY_X: readonly [number, number, number] = [1, 0, 0]; // +x
const MAX = 0.1;

// Effective octree exposure at slider 25: Natural = 150, Survey = 1000 (ADR-007 §2-3). The pick
// is gated at Natural until VIS-05, so existing fixtures thread NAT and stay perceptible.
const SLIDER = 25;
const NAT = effectiveStarExposure(NATURAL_VISIBILITY_PROFILE, 'galaxy-octree', SLIDER);
const SURVEY = effectiveStarExposure(SURVEY_VISIBILITY_PROFILE, 'galaxy-octree', SLIDER);

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
    const hit = pickNearestGaia(tiles, CAM, RAY_X, MAX, NAT);
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
    const hit = pickNearestGaia([{ batch, ranges }], CAM, RAY_X, 0.05, NAT);
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
      NAT,
    );
    expect(hit).toBeNull();
  });

  it('empty tile list → null', () => {
    expect(pickNearestGaia([], CAM, RAY_X, MAX, NAT)).toBeNull();
  });

  it('a gaia star outside maxAngleRad → null', () => {
    const batch = makeBatch({ absPositions: [[10, 5, 0]], catalogIds: [400] }); // ~0.46 rad off
    const hit = pickNearestGaia(
      [{ batch, ranges: [{ offset: 0, count: 1, idPrefix: 'gaia' }] }],
      CAM,
      RAY_X,
      0.02,
      NAT,
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
      NAT,
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
      NAT,
    );
    expect(hit?.catalogId).toBe(10);
  });
});

describe('pickNearestGaia — TASK-089 D1: hit carries absMag/colorIndexBV/positionPc', () => {
  it('(a) returned hit has absMag and colorIndexBV equal to the batch values at the winning index', () => {
    // Two gaia stars; the nearer one (idx1) should win and carry ITS attribute values.
    const n = 2;
    const positionsPc = new Float32Array(n * 3);
    positionsPc[0] = 10; positionsPc[1] = 1; positionsPc[2] = 0; // idx0 off-axis
    positionsPc[3] = 10; positionsPc[4] = 0; positionsPc[5] = 0; // idx1 on-ray
    const absMag = new Float32Array([3.5, 7.2]);
    const colorIndexBV = new Float32Array([0.4, 1.1]);
    const batch: StarBatch = {
      count: n,
      originPc: [0, 0, 0],
      positionsPc,
      absMag,
      colorIndexBV,
      catalogIds: Uint32Array.from([100, 200]),
      hipIds: new Uint32Array(n),
      idPrefix: 'gaia',
    };
    // absMag 7.2 at 10pc is sub-floor at Natural (150 → 0.00185); this test is about the carried
    // attributes, not the gate, so run it at Survey (1000 → 0.0124) where idx1 is perceptible.
    const hit = pickNearestGaia(
      [{ batch, ranges: [{ offset: 0, count: 2, idPrefix: 'gaia' }] }],
      CAM, RAY_X, MAX, SURVEY,
    );
    expect(hit?.catalogId).toBe(200);
    expect(hit?.absMag).toBeCloseTo(7.2, 4);
    expect(hit?.colorIndexBV).toBeCloseTo(1.1, 4);
  });

  it('(b) positionPc is Sol-relative (tile-local + originPc), NOT camera-relative', () => {
    // Non-zero originPc so a camera-relative bug would give wrong coordinates.
    const originPc: [number, number, number] = [5, 3, 1];
    const tileLocalX = 10; const tileLocalY = 0; const tileLocalZ = 0;
    const positionsPc = new Float32Array([tileLocalX, tileLocalY, tileLocalZ]);
    const batch: StarBatch = {
      count: 1,
      originPc,
      positionsPc,
      absMag: new Float32Array([4.0]),
      colorIndexBV: new Float32Array([0.6]),
      catalogIds: Uint32Array.from([42]),
      hipIds: new Uint32Array(1),
      idPrefix: 'gaia',
    };
    // Camera at the same position as originPc, ray along +x from there.
    const camera: [number, number, number] = [5, 3, 1];
    const hit = pickNearestGaia(
      [{ batch, ranges: [{ offset: 0, count: 1, idPrefix: 'gaia' }] }],
      camera, RAY_X, MAX, NAT,
    );
    // Sol-relative = tile-local + originPc = [10+5, 0+3, 0+1] = [15, 3, 1]
    expect(hit?.positionPc[0]).toBeCloseTo(tileLocalX + originPc[0], 4);
    expect(hit?.positionPc[1]).toBeCloseTo(tileLocalY + originPc[1], 4);
    expect(hit?.positionPc[2]).toBeCloseTo(tileLocalZ + originPc[2], 4);
  });
});

describe('pickNearestGaia — TASK-089 D1 additivity: non-gaia pick is unchanged', () => {
  it('a hyg-only tile returns null (identical to before the GaiaPickHit extension)', () => {
    const batch = makeBatch({
      absPositions: [[10, 0, 0]],
      catalogIds: [999],
      idPrefix: 'hyg-v41',
    });
    const result = pickNearestGaia(
      [{ batch, ranges: [{ offset: 0, count: 1, idPrefix: 'hyg-v41' }] }],
      CAM, RAY_X, MAX, NAT,
    );
    expect(result).toBeNull();
  });
});

describe('gaiaHitWins — cross-source arbitration (TASK-088 D3, gate 4 additivity)', () => {
  const gaia: GaiaPickHit = { catalogId: 7, angleRad: 0.01, distancePc: 10, positionPc: [10, 0, 0], absMag: 5.0, colorIndexBV: 0.65 };

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

describe('pickNearestGaia — TASK-100 perceptibility gate (a claimed star is a drawn star)', () => {
  // Fixture brightnesses (from sampleRenderedStar, the shared oracle) at Natural exposure 150:
  //   faint absMag 7.5 @ 10pc = 0.00107  (BELOW the 0.004 floor → invisible → must be skipped)
  //   bright absMag 1.0 @ 10pc = 59.7     (far above the floor → drawn → claimable)
  const FAINT_ABSMAG = 7.5;
  const BRIGHT_ABSMAG = 1.0;

  it('POWER: a faint ON-axis star below the floor loses to a bright OFF-axis star above it', () => {
    // Pre-TASK-100 the faint star (angle 0) wins purely on angle — a click on empty-looking sky
    // returns a star the frame never drew. With the gate it is skipped; the bright star wins.
    const batch = makeBatch({
      absPositions: [
        [10, 0, 0], // idx0 faint — EXACTLY on the +x ray (angle 0), would win without the gate
        [10, 0.05, 0], // idx1 bright — ~0.005 rad off-axis, inside MAX
      ],
      catalogIds: [900, 901],
      absMag: [FAINT_ABSMAG, BRIGHT_ABSMAG],
    });
    const faintB = sampleRenderedStar({ absMag: FAINT_ABSMAG, distancePc: 10, exposure: NAT }).brightness;
    const brightB = sampleRenderedStar({ absMag: BRIGHT_ABSMAG, distancePc: 10, exposure: NAT }).brightness;
    // eslint-disable-next-line no-console
    console.log(`TASK-100 POWER: faint(900) brightness=${faintB} < floor=${STAR_PERCEPTIBILITY_FLOOR} < bright(901)=${brightB} @NAT=${NAT}`);
    expect(faintB).toBeLessThan(STAR_PERCEPTIBILITY_FLOOR); // fixture really is sub-floor
    expect(brightB).toBeGreaterThan(STAR_PERCEPTIBILITY_FLOOR);
    const hit = pickNearestGaia(
      [{ batch, ranges: [{ offset: 0, count: 2, idPrefix: 'gaia' }] }],
      CAM, RAY_X, MAX, NAT,
    );
    expect(hit?.catalogId).toBe(901); // the bright, drawn star — NOT the on-axis invisible one
  });

  it('EXPOSURE SENSITIVITY: the same faint star is not claimable at Natural (150) but is at Survey (1000)', () => {
    const batch = makeBatch({
      absPositions: [[10, 0, 0]], // on the ray
      catalogIds: [900],
      absMag: [FAINT_ABSMAG],
    });
    const tiles: OctreePickTile[] = [{ batch, ranges: [{ offset: 0, count: 1, idPrefix: 'gaia' }] }];
    expect(pickNearestGaia(tiles, CAM, RAY_X, MAX, NAT)).toBeNull(); // invisible at Natural
    expect(pickNearestGaia(tiles, CAM, RAY_X, MAX, SURVEY)?.catalogId).toBe(900); // drawn at Survey
  });

  it('a tile whose points are ALL below the floor → null (no fallback to the least-invisible star)', () => {
    const batch = makeBatch({
      absPositions: [
        [10, 0, 0],
        [10, 0.01, 0],
      ],
      catalogIds: [910, 911],
      absMag: [FAINT_ABSMAG, FAINT_ABSMAG + 0.5],
    });
    const hit = pickNearestGaia(
      [{ batch, ranges: [{ offset: 0, count: 2, idPrefix: 'gaia' }] }],
      CAM, RAY_X, MAX, NAT,
    );
    expect(hit).toBeNull();
  });

  it('FLOOR EQUALITY: brightness === floor is claimable (matches the render/cull < floor boundary)', () => {
    // absMag 0 at 10pc → brightness = exposure exactly, so exposure = floor makes brightness === floor.
    const batch = makeBatch({ absPositions: [[10, 0, 0]], catalogIds: [920], absMag: [0] });
    const tiles: OctreePickTile[] = [{ batch, ranges: [{ offset: 0, count: 1, idPrefix: 'gaia' }] }];
    expect(pickNearestGaia(tiles, CAM, RAY_X, MAX, STAR_PERCEPTIBILITY_FLOOR)?.catalogId).toBe(920);
    // A hair below the floor is not claimable — proves the boundary is exactly at the floor.
    expect(pickNearestGaia(tiles, CAM, RAY_X, MAX, STAR_PERCEPTIBILITY_FLOOR * 0.99)).toBeNull();
  });

  it('FAIL-CLOSED: a non-finite absMag is skipped; a mixed tile still returns the finite bright star', () => {
    const batch = makeBatch({
      absPositions: [
        [10, 0, 0], // idx0 NaN absMag — on the ray, would win on angle if not skipped
        [10, 0.05, 0], // idx1 bright finite — off-axis
      ],
      catalogIds: [800, 801],
      absMag: [Number.NaN, BRIGHT_ABSMAG],
    });
    const hit = pickNearestGaia(
      [{ batch, ranges: [{ offset: 0, count: 2, idPrefix: 'gaia' }] }],
      CAM, RAY_X, MAX, NAT,
    );
    expect(hit?.catalogId).toBe(801);
    // A tile whose only gaia star has a non-finite absMag → null, never claimed.
    const nanOnly = makeBatch({ absPositions: [[10, 0, 0]], catalogIds: [800], absMag: [Number.NaN] });
    expect(
      pickNearestGaia([{ batch: nanOnly, ranges: [{ offset: 0, count: 1, idPrefix: 'gaia' }] }], CAM, RAY_X, MAX, NAT),
    ).toBeNull();
  });
});
