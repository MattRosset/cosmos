/**
 * Deterministic local-group generator (TASK-037). Pure: no Three.js, no DOM,
 * no Math.random — createPrng/hashCombine only (§5.6).
 */
import { createPrng, hashCombine } from '@cosmos/core-types';
import type { GalaxyRecord } from '@cosmos/core-types';

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
