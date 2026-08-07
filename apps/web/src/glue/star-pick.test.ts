import { describe, it, expect } from 'vitest';
import type { StarBatch } from '@cosmos/core-types';
import { pickStar } from '@cosmos/render-stars';
import {
  effectiveStarExposure,
  sampleRenderedStar,
  NATURAL_VISIBILITY_PROFILE,
  STAR_PERCEPTIBILITY_FLOOR,
} from '@cosmos/photometry';
import { pickNearestVisibleStar } from './star-pick';

/**
 * TASK-103 (VIS-06b) contract. `pickNearestVisibleStar` is the pure, WebGL-free heart of the
 * HYG/exoplanet star pick: the angularly-nearest star the frame ACTUALLY DRAWS. It is `pickStar`
 * with a `starIsPerceptible` gate — so these tests both mirror `octree-pick.test.ts`'s TASK-100
 * gate suite (same defect class) AND prove the gate is real by asserting the un-gated `pickStar`
 * would return the invisible star the gated pick rejects.
 *
 * `makeBatch` is copied (not imported) from `octree-pick.test.ts`: that file and the Gaia pick it
 * tests are frozen for this task (spec Frozen §), so exporting from it is out of bounds — copying
 * the helper is the sanctioned mirror, exactly as the pick functions themselves are mirrored.
 */

/** Build a tile-local StarBatch from ABSOLUTE positions + its originPc (tile-local = absolute −
 *  origin). `catalogIds` length sets `count`. Fills every required `StarBatch` field. */
function makeBatch(opts: {
  readonly absPositions: readonly (readonly [number, number, number])[];
  readonly catalogIds: readonly number[];
  readonly originPc?: readonly [number, number, number];
  readonly idPrefix?: string;
  /** Per-index absolute magnitude. Defaults to all-zeros (bright). */
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
    idPrefix: opts.idPrefix ?? 'hyg',
  };
}

const CAM_LOCAL: readonly [number, number, number] = [0, 0, 0]; // tile-local ray origin (origin [0,0,0])
const RAY_X: readonly [number, number, number] = [1, 0, 0]; // +x
const MAX = 0.1;

// HYG/exo have exposure multiplier 1 in EVERY profile (ADR-007 §8), so the effective HYG exposure
// is just the raw slider. Drive the gate through `effectiveStarExposure` anyway — the one source
// of truth the production path uses — rather than hardcoding "exposure = slider".
const SLIDER_LOW = 25; // default slider
const SLIDER_HIGH = 50;
const HYG_LOW = effectiveStarExposure(NATURAL_VISIBILITY_PROFILE, 'hyg', SLIDER_LOW); // = 25
const HYG_HIGH = effectiveStarExposure(NATURAL_VISIBILITY_PROFILE, 'hyg', SLIDER_HIGH); // = 50

// Fixture brightnesses (from sampleRenderedStar, the shared oracle) at HYG exposure 25 / 10pc:
//   faint absMag 6.0 = 0.00282  (BELOW the 0.004 floor → invisible → must be skipped)
//   bright absMag 4.0 = 0.112   (far above the floor → drawn → claimable)
const FAINT_ABSMAG = 6.0;
const BRIGHT_ABSMAG = 4.0;

describe('pickNearestVisibleStar — TASK-103 perceptibility gate (a claimed star is a drawn star)', () => {
  it('sanity: returns the nearest perceptible star for a ray aimed at it (whole-batch scan)', () => {
    // On-ray star is the LAST index → a whole-batch scan is required (guards an off-by-one).
    const batch = makeBatch({
      absPositions: [
        [10, 3, 0], // idx0 far off-axis
        [10, 1, 0], // idx1
        [10, 0, 0], // idx2 exactly on the +x ray (angle 0)
      ],
      catalogIds: [1, 2, 3],
      absMag: [1, 1, 1], // all bright → all perceptible; angle decides
    });
    const hit = pickNearestVisibleStar(batch, CAM_LOCAL, RAY_X, MAX, HYG_LOW);
    expect(hit?.index).toBe(2);
    expect(hit?.angleRad).toBeCloseTo(0, 6);
  });

  it('POWER (fails before the gate): a faint ON-axis star below the floor loses to a bright OFF-axis star', () => {
    // Pre-TASK-103 the faint star (angle 0) wins purely on angle — a click on empty-looking sky
    // returns a star the frame never drew. With the gate it is skipped; the bright star wins.
    const batch = makeBatch({
      absPositions: [
        [10, 0, 0], // idx0 faint — EXACTLY on the +x ray (angle 0), would win without the gate
        [10, 0.05, 0], // idx1 bright — ~0.005 rad off-axis, inside MAX
      ],
      catalogIds: [900, 901],
      absMag: [FAINT_ABSMAG, BRIGHT_ABSMAG],
    });
    const faintB = sampleRenderedStar({ absMag: FAINT_ABSMAG, distancePc: 10, exposure: HYG_LOW }).brightness;
    const brightB = sampleRenderedStar({ absMag: BRIGHT_ABSMAG, distancePc: 10, exposure: HYG_LOW }).brightness;
    console.log(`TASK-103 POWER: faint(idx0) brightness=${faintB} < floor=${STAR_PERCEPTIBILITY_FLOOR} < bright(idx1)=${brightB} @HYG=${HYG_LOW}`);
    expect(faintB).toBeLessThan(STAR_PERCEPTIBILITY_FLOOR); // fixture really is sub-floor
    expect(brightB).toBeGreaterThan(STAR_PERCEPTIBILITY_FLOOR);

    // The un-gated `pickStar` returns the faint on-axis star — proving the fixture straddles the
    // gate, so the assertion below genuinely fails on the pre-TASK-103 (geometry-only) path.
    expect(pickStar(batch, CAM_LOCAL, RAY_X, MAX)?.index).toBe(0);

    const hit = pickNearestVisibleStar(batch, CAM_LOCAL, RAY_X, MAX, HYG_LOW);
    expect(hit?.index).toBe(1); // the bright, drawn star — NOT the on-axis invisible one
  });

  it('EXPOSURE SENSITIVITY: the same faint star is not claimable at a low slider but is at a high one', () => {
    // HYG gives the SAME exposure in both modes (multiplier 1), so — unlike TASK-100's
    // Natural/Survey test — this is driven by two RAW SLIDER values, not two modes.
    const batch = makeBatch({
      absPositions: [[10, 0, 0]], // on the ray
      catalogIds: [900],
      absMag: [FAINT_ABSMAG],
    });
    expect(pickNearestVisibleStar(batch, CAM_LOCAL, RAY_X, MAX, HYG_LOW)).toBeNull(); // invisible at slider 25
    expect(pickNearestVisibleStar(batch, CAM_LOCAL, RAY_X, MAX, HYG_HIGH)?.index).toBe(0); // drawn at slider 50
  });

  it('ALL SUB-FLOOR → null (no fallback to the least-invisible star)', () => {
    const batch = makeBatch({
      absPositions: [
        [10, 0, 0],
        [10, 0.01, 0],
      ],
      catalogIds: [910, 911],
      absMag: [FAINT_ABSMAG, FAINT_ABSMAG + 0.5],
    });
    expect(pickNearestVisibleStar(batch, CAM_LOCAL, RAY_X, MAX, HYG_LOW)).toBeNull();
  });

  it('FLOOR EQUALITY: brightness === floor is claimable (matches the render/cull < floor boundary)', () => {
    // absMag 0 at 10pc → brightness = exposure exactly, so exposure = floor makes brightness === floor.
    const batch = makeBatch({ absPositions: [[10, 0, 0]], catalogIds: [920], absMag: [0] });
    expect(pickNearestVisibleStar(batch, CAM_LOCAL, RAY_X, MAX, STAR_PERCEPTIBILITY_FLOOR)?.index).toBe(0);
    // A hair below the floor is not claimable — proves the boundary is exactly at the floor.
    expect(pickNearestVisibleStar(batch, CAM_LOCAL, RAY_X, MAX, STAR_PERCEPTIBILITY_FLOOR * 0.99)).toBeNull();
  });

  it('FAIL-CLOSED: a non-finite absMag is skipped; a mixed batch still returns the finite bright star', () => {
    const batch = makeBatch({
      absPositions: [
        [10, 0, 0], // idx0 NaN absMag — on the ray, would win on angle if not skipped
        [10, 0.05, 0], // idx1 bright finite — off-axis
        [10, -0.03, 0], // idx2 Infinity absMag — also on the near-axis, must be skipped too
      ],
      catalogIds: [800, 801, 802],
      absMag: [Number.NaN, BRIGHT_ABSMAG, Number.POSITIVE_INFINITY],
    });
    expect(pickNearestVisibleStar(batch, CAM_LOCAL, RAY_X, MAX, HYG_LOW)?.index).toBe(1);

    // A batch whose only star has a non-finite absMag → null, never claimed.
    const nanOnly = makeBatch({ absPositions: [[10, 0, 0]], catalogIds: [800], absMag: [Number.NaN] });
    expect(pickNearestVisibleStar(nanOnly, CAM_LOCAL, RAY_X, MAX, HYG_LOW)).toBeNull();
  });
});
