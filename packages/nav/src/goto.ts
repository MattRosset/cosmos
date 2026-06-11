/**
 * Pure motion-law helpers for goTo animation (§5.3).
 * All functions are stateless — state lives in controller.ts.
 */

/**
 * Exponential-decay constant k such that d(t) = d0 × exp(-k × t).
 * At t = durationMs the distance equals arrivalDistanceM.
 */
export function computeGoToK(
  d0M: number,
  arrivalDistanceM: number,
  durationMs: number,
): number {
  return Math.log(d0M / arrivalDistanceM) / durationMs;
}
