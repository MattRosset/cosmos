import type { StarBatch } from '@cosmos/core-types';

export interface StarPickHit {
  readonly index: number;
  readonly distancePc: number;
  /** Angle between the ray and the star direction, radians. */
  readonly angleRad: number;
}

/**
 * Nearest star to a ray by angular distance, within maxAngleRad.
 * Ray origin and direction are TILE-LOCAL parsecs (caller subtracts batch.originPc).
 * Pure math, no Three.js types. Click-time only — may allocate.
 * Ties in angle are broken by nearer distancePc.
 */
export function pickStar(
  batch: StarBatch,
  rayOriginPc: readonly [number, number, number],
  rayDirUnit: readonly [number, number, number],
  maxAngleRad: number,
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
