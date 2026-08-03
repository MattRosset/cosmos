/**
 * Pure Gaia-range pick over streamed octree tiles (TASK-088 D1, Task B of the "Gaia realness"
 * reframe — docs/research/gaia-pick-identity-gap.md). Mirrors `render-stars/pick.ts`'s pure
 * angular test so it is unit-testable in vitest (no WebGL here). It deliberately claims ONLY
 * gaia stars: an index inside a `hyg-v41` sub-range of a mixed tile is never a candidate
 * (scope rule — the octree branch emits only `gaia:*`; octree-HYG identity is out of scope).
 *
 * Depends on `PrefixRange` (app glue), so it lives in app glue rather than render-stars — the
 * frozen `pick.ts` must not depend on it.
 */
import type { StarBatch } from '@cosmos/core-types';
import type { PrefixRange } from './octree-combined';

/** One visible octree tile as pick input: the decoded batch + its per-source provenance
 *  (from `CombinedOctreeSource.prefixRangesFor(chunkId)`). */
export interface OctreePickTile {
  readonly batch: StarBatch;
  readonly ranges: readonly PrefixRange[];
}

export interface GaiaPickHit {
  /** Pack-global Gaia catalogId of the nearest gaia star (the D1 sidecar index). */
  readonly catalogId: number;
  /** Angle between the ray and the star, radians (for cross-batch nearest comparison). */
  readonly angleRad: number;
  /** Camera-relative distance, parsecs (for cross-source arbitration only). */
  readonly distancePc: number;
  /** Absolute galactic-frame position (Sol-origin), parsecs. |positionPc| = distance from Sol. */
  readonly positionPc: readonly [number, number, number];
  readonly absMag: number;
  readonly colorIndexBV: number;
}

/**
 * Nearest GAIA star to `rayDirUnit` from `cameraLocalPc` across all `tiles`, within
 * `maxAngleRad`. Only indices inside a range whose `idPrefix === 'gaia'` are considered — a
 * hit in a hyg-v41 sub-range is deliberately ignored (TASK-088 scope). Per tile the ray origin
 * is rebased by `batch.originPc` (tile-local parsecs, exactly as StarScene does for hyg). The
 * angular test is IDENTICAL to `pickStar` (smaller angle wins; ties in angle → nearer
 * distance). Returns null if no gaia star is within threshold.
 */
export function pickNearestGaia(
  tiles: readonly OctreePickTile[],
  cameraLocalPc: readonly [number, number, number],
  rayDirUnit: readonly [number, number, number],
  maxAngleRad: number,
): GaiaPickHit | null {
  const [dx, dy, dz] = rayDirUnit;

  let bestCatalogId = -1;
  let bestAngle = maxAngleRad;
  let bestDist = Infinity;
  let bestAbsMag = 0;
  let bestColorIndexBV = 0;
  let bestPx = 0;
  let bestPy = 0;
  let bestPz = 0;

  for (const tile of tiles) {
    const { batch, ranges } = tile;
    // Tile-local ray origin (same rebasing as `pickNearestStar` does per batch).
    const ox = cameraLocalPc[0] - batch.originPc[0]!;
    const oy = cameraLocalPc[1] - batch.originPc[1]!;
    const oz = cameraLocalPc[2] - batch.originPc[2]!;

    for (const range of ranges) {
      if (range.idPrefix !== 'gaia') continue;
      const end = Math.min(range.offset + range.count, batch.count);
      for (let i = range.offset; i < end; i++) {
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
          bestCatalogId = batch.catalogIds[i]!;
          bestAbsMag = batch.absMag[i]!;
          bestColorIndexBV = batch.colorIndexBV[i]!;
          // Absolute galactic-frame (Sol-origin) = tile-local + originPc.
          // Do NOT use the camera-rebased sx/sy/sz — those are camera-relative.
          bestPx = batch.positionsPc[i * 3]! + batch.originPc[0]!;
          bestPy = batch.positionsPc[i * 3 + 1]! + batch.originPc[1]!;
          bestPz = batch.positionsPc[i * 3 + 2]! + batch.originPc[2]!;
        }
      }
    }
  }

  if (bestCatalogId < 0) return null;
  return {
    catalogId: bestCatalogId,
    angleRad: bestAngle,
    distancePc: bestDist,
    positionPc: [bestPx, bestPy, bestPz],
    absMag: bestAbsMag,
    colorIndexBV: bestColorIndexBV,
  };
}

/**
 * Cross-source arbitration for the star pick (TASK-088 D3): does the octree gaia hit win over
 * the hyg/exo star hit? Smaller angle wins — exactly the rule exo-vs-hyg already use.
 * `starAngleRad` is null when `pickNearestStar` found no hyg/exo star. Extracted (not inlined)
 * so the additive-branch contract (gate 4) is unit-testable without WebGL, over the SAME
 * function production runs. A false result means the existing hyg/exo/null outcome is returned
 * unchanged; a null `gaiaHit` (no gaia in threshold / octree pick off) always loses.
 */
export function gaiaHitWins(gaiaHit: GaiaPickHit | null, starAngleRad: number | null): boolean {
  return gaiaHit !== null && (starAngleRad === null || gaiaHit.angleRad < starAngleRad);
}
