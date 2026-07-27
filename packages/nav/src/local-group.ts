/**
 * Deterministic local-group generator (TASK-037). Pure: no Three.js, no DOM,
 * no Math.random — createPrng/hashCombine only (§5.6).
 */
import { createPrng, hashCombine } from '@cosmos/core-types';
import type { BodyId, GalaxyRecord } from '@cosmos/core-types';

export interface LocalGroupParams {
  readonly seed: number;
  /** Number of procedural galaxies to place. Default 12. */
  readonly count?: number;
  /** Radius of the local-group volume, MEGAPARSECS. Default 1.5. */
  readonly radiusMpc?: number;
}

/**
 * Deterministic local group: GalaxyRecords placed in universe-frame Mpc by the
 * seeded PRNG. Same params ⇒ identical records, including each galaxy's
 * `seed` (= hashCombine(seed, index)) for downstream procgen.
 *
 * Three random draws per galaxy: radial fraction (cbrt-scaled for uniform
 * volume), cos(polar angle), azimuthal angle. One further draw for radiusKpc.
 */
export function generateLocalGroup(params: LocalGroupParams): readonly GalaxyRecord[] {
  const { seed, count = 12, radiusMpc = 1.5 } = params;
  const rng = createPrng(seed);
  const records: GalaxyRecord[] = [];
  const TWO_PI = 2 * Math.PI;

  for (let i = 0; i < count; i++) {
    // Uniform in sphere: r ∝ cbrt(u) for uniform volume distribution
    const r = radiusMpc * Math.cbrt(rng.next());
    const cosTheta = rng.range(-1, 1);
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = rng.range(0, TWO_PI);
    const x = r * sinTheta * Math.cos(phi);
    const y = r * sinTheta * Math.sin(phi);
    const z = r * cosTheta;
    const radiusKpc = rng.range(5, 50);

    records.push({
      id: `proc:localgroup:${i}`,
      kind: 'galaxy',
      positionMpc: [x, y, z],
      radiusKpc,
      seed: hashCombine(seed, i),
    });
  }

  return records;
}

/**
 * Angular click-tolerance for local-group galaxy picking (TASK-086, D6). MUST equal
 * `StarScene.tsx`'s `PICK_MAX_ANGLE_RAD` (0.02 rad) — the threshold is a click
 * tolerance, not a sprite-size constant, so the same value applies to galaxies. Not
 * imported directly: `packages/nav` is a lower layer than `apps/web` and cannot
 * depend on it, and the app constant isn't exported from `@cosmos/nav` today. See
 * NOTES-2026-07-27-task-086.md JC-2 for the full reasoning.
 */
export const GALAXY_PICK_MAX_ANGLE_RAD = 0.02;

/**
 * Deterministic display name for a local-group body id (TASK-086, D5). Pure — no
 * catalog lookup. `proc:milkyway` → "Milky Way"; `proc:localgroup:<n>` →
 * "Galaxy G-<n>" (the index is already embedded in the id); anything else → null so
 * callers can fall back to a real catalog name or the raw id.
 */
export function localGroupGalaxyName(id: BodyId): string | null {
  if (id === 'proc:milkyway') return 'Milky Way';
  const m = /^proc:localgroup:(\d+)$/.exec(id);
  if (m === null) return null;
  return `Galaxy G-${m[1]}`;
}

/**
 * Angular-nearest local-group galaxy along a camera ray (TASK-086, D4). Mirrors
 * `pickNearestStar`/`pickStar`'s shape: both the camera position and the galaxies'
 * `positionMpc` are in the SAME frame (universe-context Mpc), so the angle is
 * unit-consistent without any conversion. Pure — click-time only, may allocate
 * nothing extra beyond the return value. Ties in angle are broken by nearer distance
 * (same rule as `pickStar`).
 */
export function pickNearestGalaxy(
  galaxies: readonly GalaxyRecord[],
  camLocal: readonly [number, number, number],
  dir: readonly [number, number, number],
): BodyId | null {
  const [ox, oy, oz] = camLocal;
  const [dx, dy, dz] = dir;

  let bestIndex = -1;
  let bestAngle = GALAXY_PICK_MAX_ANGLE_RAD;
  let bestDist = Infinity;

  for (let i = 0; i < galaxies.length; i++) {
    const g = galaxies[i]!;
    const gx = g.positionMpc[0] - ox;
    const gy = g.positionMpc[1] - oy;
    const gz = g.positionMpc[2] - oz;

    const dist = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (dist === 0) continue;

    const cosA = (dx * gx + dy * gy + dz * gz) / dist;
    const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));

    if (angle < bestAngle || (angle === bestAngle && dist < bestDist)) {
      bestAngle = angle;
      bestDist = dist;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) return null;
  return galaxies[bestIndex]!.id;
}
