/**
 * Per-tile brightness/distance cull predicate (TASK-094).
 *
 * Pure, DOM/THREE-free — lives under `src/glue/**` so the node-env vitest scope
 * can exercise it directly (same pattern as `tile-frustum-cull.ts`).
 *
 * Replays the shipped star-point shader math CPU-side so a tile whose brightest
 * star (min absMag) at its nearest approach still lands under the visibility
 * floor can be skipped at DRAW time. Conservative upper bound: bri(m) is
 * non-increasing in apparent magnitude, and m rises with both absMag and
 * distance — so one evaluation at (minAbsMag, dist − radius) bounds the tile.
 */

/**
 * Research's "absurdly generous" visibility bucket (`near-sol-overdraw-frustum-
 * culling.md`). FROZEN — do NOT raise to make a gate pass: bri ≥ 0.02 points are
 * verified visible, and past arrival the HYG monolith is coverage-gated OFF, so a
 * higher floor blanks the sky with no fallback.
 */
export const TILE_VISIBILITY_FLOOR = 0.004;

// Octree mount uniforms — createStarPoints defaults (star-points.ts ~47);
// makeOctreeMount passes no overrides. NOT parameters: the call site cannot
// supply them; a citing comment + Step 0 re-verification is the drift guard.
const BASE_POINT_PX = 8;
const MIN_POINT_PX = 3;
const MAX_POINT_PX = 64;

/**
 * True ⇒ even the tile's BRIGHTEST star (minAbsMag) at its NEAREST approach
 * (distToCenterPc − radiusPc) projects under the visibility floor — the whole tile
 * emits no visible light this frame, so drawing it is pure waste. Conservative
 * (never returns true for a tile containing a visible star): the single evaluation
 * is the tile's exact brightness upper bound (monotonicity — see TASK-094 Step 0 §3).
 * NaN inputs ⇒ false (bad data NEVER culls). Allocation-free (scalar math only).
 *
 * Replays the shipped shader math EXACTLY — stars.vert.glsl.ts ~50–61,
 * stars.frag.glsl.ts ~15 — with the octree mount's actual uniforms
 * (base 8 / min 3 / max 64, star-points.ts ~47; makeOctreeMount passes no overrides).
 * If those shader lines or defaults change, this function is wrong — update both.
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

  const dPc = Math.max(distToCenterPc - radiusPc, 0.001); // vert ~50 clamp
  const m = minAbsMag + 5 * (Math.log10(dPc) - 1); // vert ~51
  const sNat = BASE_POINT_PX * Math.pow(10, -0.2 * m); // vert ~56 (base 8)
  const sRen = Math.min(Math.max(sNat, MIN_POINT_PX), MAX_POINT_PX); // vert ~57
  const sizeDim = Math.min(1, (sNat / sRen) * (sNat / sRen)); // vert ~61
  const flux = Math.min(1, Math.pow(10, -0.4 * m)); // frag ~15 clamp(…,0,1)
  return flux * exposureEff * sizeDim < floor;
}
