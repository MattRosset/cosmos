/**
 * Perceptibility-gated HYG/exoplanet star pick (TASK-103, VIS-06b). The pure, WebGL-free heart
 * of the near-field star pick: the angularly-nearest star that the frame ACTUALLY DRAWS, within
 * `maxAngleRad`. Mirrors `render-stars/pick.ts`'s pure angular test verbatim in structure (same
 * `dist === 0` guard, same `cosA`/`acos`, same "smaller angle wins; ties by nearer dist"), with
 * ONE addition: a `starIsPerceptible` gate before `acos` that skips a sub-floor candidate.
 *
 * Why here and not in `render-stars/pick.ts` (TASK-103 Decision (b), mirroring TASK-100): this
 * depends on `@cosmos/photometry`, the dependency the frozen `pick.ts` must not take. `pick.ts`
 * and `octree-pick.ts` already carry two copies of the same angular test on purpose; this is the
 * third sanctioned mirror, not a novel abstraction.
 */
import type { StarBatch } from '@cosmos/core-types';
import type { StarPickHit } from '@cosmos/render-stars';
import { starIsPerceptible, STAR_PERCEPTIBILITY_FLOOR } from '@cosmos/photometry';

/**
 * Nearest PERCEPTIBLE star to a ray by angular distance, within `maxAngleRad`. Ray origin and
 * direction are TILE-LOCAL parsecs (caller subtracts `batch.originPc`, exactly as `pickStar`).
 * Pure math, no Three.js. Click-time only — may allocate. Ties in angle are broken by nearer
 * `distancePc`.
 *
 * PERCEPTIBILITY GATE (TASK-103). A candidate is skipped unless it is perceptible at the SAME
 * predicate the renderer and tile cull use (`@cosmos/photometry`), evaluated at the
 * camera-relative `dist` and the effective HYG/exo exposure the scene draws with — so the pick
 * cannot claim a star the frame does not show. `effectiveExposure` is REQUIRED (an unmigrated
 * call site must fail typecheck, not silently keep the old, over-claiming behavior);
 * `perceptibilityFloor` defaults to the shared `STAR_PERCEPTIBILITY_FLOOR` and must never be
 * replaced by a pick-only floor — a pick-visible star the renderer omits is exactly the bug this
 * closes.
 */
export function pickNearestVisibleStar(
  batch: StarBatch,
  rayOriginPc: readonly [number, number, number],
  rayDirUnit: readonly [number, number, number],
  maxAngleRad: number,
  effectiveExposure: number,
  perceptibilityFloor: number = STAR_PERCEPTIBILITY_FLOOR,
): StarPickHit | null {
  const [ox, oy, oz] = rayOriginPc;
  const [dx, dy, dz] = rayDirUnit;

  let bestIndex = -1;
  let bestAngle = maxAngleRad;
  let bestDist = Infinity;

  for (let i = 0; i < batch.count; i++) {
    const sx = batch.positionsPc[i * 3]! - ox;
    const sy = batch.positionsPc[i * 3 + 1]! - oy;
    const sz = batch.positionsPc[i * 3 + 2]! - oz;

    const dist = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (dist === 0) continue;

    // TASK-103: skip a candidate the frame does not draw. Cheaper than `acos`, so it goes first;
    // it uses `dist` (camera-relative parsecs), the SAME distance the renderer uses. Fail-CLOSED
    // by design: a non-finite `absMag` yields non-perceptible, so the point is skipped rather than
    // claimed. This is the opposite bias from the tile cull (which fails OPEN, because dropping a
    // tile loses pixels) — for a pick, a wrong claim is worse than a miss. Floor equality is
    // claimable, matching the render/cull boundary.
    if (
      !starIsPerceptible({
        absMag: batch.absMag[i]!,
        distancePc: dist,
        exposure: effectiveExposure,
        perceptibilityFloor,
      })
    ) {
      continue;
    }

    const cosA = (dx * sx + dy * sy + dz * sz) / dist;
    const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));

    if (angle < bestAngle || (angle === bestAngle && dist < bestDist)) {
      bestAngle = angle;
      bestDist = dist;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) return null;

  return { index: bestIndex, distancePc: bestDist, angleRad: bestAngle };
}
