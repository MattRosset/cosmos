/**
 * Per-tile brightness/distance cull predicate (TASK-094).
 *
 * Pure, DOM/THREE-free — lives under `src/glue/**` so the node-env vitest scope
 * can exercise it directly (same pattern as `tile-frustum-cull.ts`).
 *
 * Delegates the per-star shader replay to `@cosmos/photometry.sampleRenderedStar`
 * (TASK-097) — this file no longer owns the formula or the 8/3/64 constants, so it
 * cannot drift from the renderer and the CPU pick/diagnostic consumers. It still owns
 * the TILE-level conservative bound: bri(m) is non-increasing in apparent magnitude,
 * and m rises with both absMag and distance — so one evaluation at
 * (minAbsMag, dist − radius) bounds the whole tile.
 */

import {
  sampleRenderedStar,
  STAR_PERCEPTIBILITY_FLOOR,
} from '@cosmos/photometry';

/**
 * Research's "absurdly generous" visibility bucket (`near-sol-overdraw-frustum-
 * culling.md`). FROZEN — do NOT raise to make a gate pass: bri ≥ 0.02 points are
 * verified visible, and past arrival the HYG monolith is coverage-gated OFF, so a
 * higher floor blanks the sky with no fallback.
 *
 * Compatibility alias for `@cosmos/photometry.STAR_PERCEPTIBILITY_FLOOR` (TASK-097) —
 * same value, kept so existing callers/tests importing `TILE_VISIBILITY_FLOOR` are
 * undisturbed.
 */
export const TILE_VISIBILITY_FLOOR = STAR_PERCEPTIBILITY_FLOOR;

/**
 * True ⇒ even the tile's BRIGHTEST star (minAbsMag) at its NEAREST approach
 * (distToCenterPc − radiusPc) projects under the visibility floor — the whole tile
 * emits no visible light this frame, so drawing it is pure waste. Conservative
 * (never returns true for a tile containing a visible star): the single evaluation
 * is the tile's exact brightness upper bound (monotonicity — see TASK-094 Step 0 §3).
 * NaN inputs ⇒ false (bad data NEVER culls) — the fail-open guard is HERE, before the
 * shared oracle, because dropping a tile loses pixels. `@cosmos/photometry.sampleRenderedStar`
 * itself reports non-finite brightness as not-perceptible; the guard below overrides that for
 * the tile path. Allocation-free (scalar math only).
 *
 * The per-star replay (distance clamp, magnitude, size, sizeDim, flux, exposure) is owned by
 * `sampleRenderedStar` with the octree mount's uniforms (createStarPoints defaults, star-points.ts;
 * makeOctreeMount passes no overrides). This wrapper only supplies the tile's brightest star at
 * its nearest approach and asks whether that upper bound is perceptible.
 *
 * @param distToCenterPc  camera → tile CENTER distance, parsecs.
 * @param radiusPc        tile bounding-sphere radius (= halfExtentPc * sqrt(3)).
 * @param minAbsMag       tile's brightest absolute magnitude (scanned at mount).
 * @param exposureEff     EFFECTIVE exposure = slider * GALAXY_FIELD_EXPOSURE_BOOST.
 * @param floor           brightness floor; default TILE_VISIBILITY_FLOOR.
 */
export function tileBelowVisibilityFloor(
  distToCenterPc: number,
  radiusPc: number,
  minAbsMag: number,
  exposureEff: number,
  floor: number = TILE_VISIBILITY_FLOOR,
): boolean {
  // NaN never culls — any NaN comparison is false, so we short-circuit first.
  if (
    Number.isNaN(distToCenterPc) ||
    Number.isNaN(radiusPc) ||
    Number.isNaN(minAbsMag) ||
    Number.isNaN(exposureEff) ||
    Number.isNaN(floor)
  ) {
    return false;
  }

  // Nearest approach = tile center distance minus its radius; sampleRenderedStar applies
  // the shader's 0.001 pc distance clamp internally (MIN_DISTANCE_PC), so we pass it raw.
  // `!perceptible` === `brightness < floor` for every finite input reachable here (exposureEff
  // is a finite slider×boost), so this is the exact old truth table; the shared oracle now owns
  // the formula. The regression fixture proves zero changed booleans against TASK-094.
  const sample = sampleRenderedStar({
    absMag: minAbsMag,
    distancePc: distToCenterPc - radiusPc,
    exposure: exposureEff,
    perceptibilityFloor: floor,
  });
  return !sample.perceptible;
}
