import type { HygFieldBounds } from './hyg-field';

/**
 * Galaxy-context far-field speed-law scalar (TASK-091), or `NaN` meaning "the camera
 * is inside/near the HYG cloud — the caller must run the HYG grid nearest-star search
 * instead". Zero allocation; arithmetic only (safe in the frame-loop callback).
 *
 * This replaces the magic `distFromSolPc > 500` proxy AND the
 * `streaming.nearestBodyDistanceM` scalar (which collapses to ~0 inside a covered
 * Gaia tile → immobilized flight; see docs/research/gaia-park-navigation-open.md §1).
 * The real precondition is geometric: when the camera is outside the point cloud, feed
 * the speed law the O(1) distance-to-the-cloud (large → controllable cruise); when
 * inside, return the sentinel so the caller keeps the fast grid nearest-star.
 *
 * `goToActive` forces the non-NaN (skip-grid) branch during animated flight — the
 * TASK-040 breadcrumb-freeze guard: the grid is never walked mid-goTo.
 */
export function galaxyFarFieldSurfacePc(
  cx: number,
  cy: number,
  cz: number,
  bounds: HygFieldBounds,
  goToActive: boolean,
  marginPc: number,
  minPc: number,
): number {
  const ddx = cx - bounds.cx;
  const ddy = cy - bounds.cy;
  const ddz = cz - bounds.cz;
  const distToCloud = Math.hypot(ddx, ddy, ddz) - bounds.maxRadiusPc;

  if (goToActive || distToCloud > marginPc) {
    // Outside the cloud (or animated flight): a large O(1) cruising scalar. Clamp to
    // minPc so a camera hovering exactly at the boundary never feeds ~0.
    return Math.max(distToCloud, minPc);
  }
  // Inside/near the cloud: distToCloud is negative or within the hysteresis margin —
  // NOT a meaningful surface distance. Sentinel → the caller runs the HYG grid.
  return Number.NaN;
}
