/**
 * HYG point-cloud bounds for the galaxy free-flight speed law (TASK-091).
 *
 * The boundary is the TRUE maximum distance from the cloud centre to any HYG point
 * — NOT the AABB half-diagonal the old inline `hygBounds` used. The diagonal is
 * ~√3× the true point extent (≈1715 pc for a ~990 pc cloud), and guarding on it
 * leaves a 990–1715 pc shell where the grid still walks empty rings (a bounded but
 * real version of the ~90 ms void-search cliff). The point radius closes that shell.
 * See docs/research/hyg-void-nearest-robust-fix.md and TASK-091.
 */
export interface HygFieldBounds {
  /** Cloud centre, absolute galaxy-frame pc. */
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  /** TRUE max distance from centre to any HYG point (pc) — NOT the AABB diagonal. */
  readonly maxRadiusPc: number;
}

/**
 * Two O(count) passes (run once in a useMemo): pass 1 finds the AABB centre, pass 2
 * finds the true max point radius from that centre. `count === 0` → centre = origin,
 * `maxRadiusPc = 0`.
 */
export function computeHygFieldBounds(
  positionsPc: Float32Array,
  originPc: readonly [number, number, number],
  count: number,
): HygFieldBounds {
  if (count === 0) {
    return { cx: originPc[0], cy: originPc[1], cz: originPc[2], maxRadiusPc: 0 };
  }

  // Pass 1 — AABB in tile-local coords → centre (same centre the old code computed).
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = positionsPc[i * 3]!, y = positionsPc[i * 3 + 1]!, z = positionsPc[i * 3 + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  // Centre in tile-local, then lifted to absolute galaxy-frame pc.
  const lcx = (minX + maxX) / 2;
  const lcy = (minY + maxY) / 2;
  const lcz = (minZ + maxZ) / 2;
  const cx = originPc[0] + lcx;
  const cy = originPc[1] + lcy;
  const cz = originPc[2] + lcz;

  // Pass 2 — true max radius from the centre (tile-local distances; origin cancels).
  let maxRadiusSq = 0;
  for (let i = 0; i < count; i++) {
    const dx = positionsPc[i * 3]! - lcx;
    const dy = positionsPc[i * 3 + 1]! - lcy;
    const dz = positionsPc[i * 3 + 2]! - lcz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > maxRadiusSq) maxRadiusSq = d2;
  }

  return { cx, cy, cz, maxRadiusPc: Math.sqrt(maxRadiusSq) };
}
