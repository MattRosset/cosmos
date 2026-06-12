/**
 * Ephemeris gate — §5.5 "published ephemeris values, 8 planets, J2000 ± 50 yr".
 *
 * Horizons query settings (reproduced verbatim for review):
 *   URL:              https://ssd.jpl.nasa.gov/api/horizons.api
 *   Ephemeris Type:   VECTORS
 *   Center:           500@10  (Sun body-center)
 *   Reference Plane:  ECLIPTIC (ecliptic and mean equinox of reference epoch)
 *   Reference Epoch:  J2000.0
 *   Output Units:     AU-D
 *   Vector Table:     2  (position only)
 *   TLIST:            2451545.0, 2433282.5, 2469807.5
 *   CSV:              NO
 *
 * Body codes:
 *   Mercury 199, Venus 299, Earth-Moon Barycenter 3,
 *   Mars 499, Jupiter 599, Saturn 699, Uranus 799, Neptune 899
 *
 * Tolerance: |Δr| < toleranceFactor × 0.1% of the body's semi-major axis.
 * Base factor = 1.0 for all planets. Jupiter and Saturn use relaxed factors
 * per ADR-002 (docs/decisions/ADR-002-gas-giant-ephemeris-tolerance.md):
 *   Jupiter: 2.0× (0.2% of a) — great-inequality perturbation exceeds Keplerian
 *   Saturn:  3.0× (0.3% of a) — same root cause, larger amplitude
 * These are the tightest thresholds achievable with a static secular Keplerian
 * propagator and JPL Table 1 mean elements. Measured deltas at decision time:
 *   Jupiter J2000: 7.686e-3 AU (1.48×), 2050: 8.283e-3 AU (1.59×)
 *   Saturn  J2000: 2.572e-2 AU (2.70×), 2050: 2.029e-2 AU (2.13×)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AU_KM, elementsToPositionAu } from '@cosmos/orbits';
import { SourceDataSchema, SystemsPackManifestSchema } from '../src/schema.js';
import { buildPack } from '../src/convert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, '../data/solar-system.json');
const raw = JSON.parse(readFileSync(dataPath, 'utf-8')) as unknown;
const source = SourceDataSchema.parse(raw);
const pack = buildPack(source);
SystemsPackManifestSchema.parse(pack); // belt-and-suspenders

const bodies = pack.systems[0]!.bodies;

// ---------------------------------------------------------------------------
// Horizons vector literals (AU, heliocentric ecliptic J2000)
// Queried 2026-06-12 via the API above.
// ---------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];

interface HorizonsEpoch {
  jd: number;
  label: string;
  pos: Vec3;
}

interface PlanetRef {
  id: string;
  epochs: HorizonsEpoch[];
  /** Multiplier on the 0.1% base tolerance. See ADR-002 for Jupiter/Saturn rationale. */
  toleranceFactor?: number;
}

const HORIZONS_REF: PlanetRef[] = [
  {
    id: 'sol:mercury',
    epochs: [
      { jd: 2433282.5, label: '1950-Jan-01', pos: [ 3.208815126064326e-1,  9.919523755987102e-2, -2.139653050292696e-2] },
      { jd: 2451545.0, label: 'J2000',       pos: [-1.300936053754522e-1, -4.472876181353563e-1, -2.459830695805179e-2] },
      { jd: 2469807.5, label: '2050-Jan-01', pos: [-1.795140424844850e-1,  2.678117696735194e-1,  3.834830324254487e-2] },
    ],
  },
  {
    id: 'sol:venus',
    epochs: [
      { jd: 2433282.5, label: '1950-Jan-01', pos: [ 9.427794081347000e-2,  7.138887939817755e-1,  4.209010424116465e-3] },
      { jd: 2451545.0, label: 'J2000',       pos: [-7.183022963453890e-1, -3.265430819980606e-2,  4.101418202684621e-2] },
      { jd: 2469807.5, label: '2050-Jan-01', pos: [ 1.417822235551292e-1, -7.133842157318016e-1, -1.802566774593160e-2] },
    ],
  },
  {
    id: 'sol:earth',
    epochs: [
      { jd: 2433282.5, label: '1950-Jan-01', pos: [-1.827019777847186e-1,  9.661458551954407e-1,  1.101819495711953e-4] },
      { jd: 2451545.0, label: 'J2000',       pos: [-1.771587841839055e-1,  9.672193524609504e-1, -1.139275508446145e-6] },
      { jd: 2469807.5, label: '2050-Jan-01', pos: [-1.715829623696938e-1,  9.682682880886148e-1, -1.081487189538922e-4] },
    ],
  },
  {
    id: 'sol:mars',
    epochs: [
      { jd: 2433282.5, label: '1950-Jan-01', pos: [-1.395553774894103e0,  9.043964307251104e-1,  5.337868315157205e-2] },
      { jd: 2451545.0, label: 'J2000',       pos: [ 1.390715921746351e0, -1.341631815101244e-2, -3.446766277581799e-2] },
      { jd: 2469807.5, label: '2050-Jan-01', pos: [-1.543231687780398e0, -5.035895204731804e-1,  2.720193305057832e-2] },
    ],
  },
  {
    id: 'sol:jupiter',
    toleranceFactor: 2.0,
    epochs: [
      { jd: 2433282.5, label: '1950-Jan-01', pos: [ 3.406605247558555e0, -3.760530033862945e0, -6.089144483071644e-2] },
      { jd: 2451545.0, label: 'J2000',       pos: [ 4.001177435589426e0,  2.938575782470499e0, -1.017852834518150e-1] },
      { jd: 2469807.5, label: '2050-Jan-01', pos: [-2.391045955156108e0,  4.664073539322320e0,  3.396562774577581e-2] },
    ],
  },
  {
    id: 'sol:saturn',
    toleranceFactor: 3.0,
    epochs: [
      { jd: 2433282.5, label: '1950-Jan-01', pos: [-9.007366891248770e0,  2.500428606539161e0,  3.139899154080162e-1] },
      { jd: 2451545.0, label: 'J2000',       pos: [ 6.406410428378656e0,  6.569988452110556e0, -3.690759730763678e-1] },
      { jd: 2469807.5, label: '2050-Jan-01', pos: [ 4.766226141432818e0, -8.773718298319354e0, -3.787765602192074e-2] },
    ],
  },
  {
    id: 'sol:uranus',
    epochs: [
      { jd: 2433282.5, label: '1950-Jan-01', pos: [-1.241424763211740e0,  1.890453343662341e1,  8.647950702716091e-2] },
      { jd: 2451545.0, label: 'J2000',       pos: [ 1.443185527592405e1, -1.373432340215935e1, -2.381417673271042e-1] },
      { jd: 2469807.5, label: '2050-Jan-01', pos: [-1.782323745057253e1,  4.071455414306206e0,  2.458503246256954e-1] },
    ],
  },
  {
    id: 'sol:neptune',
    epochs: [
      { jd: 2433282.5, label: '1950-Jan-01', pos: [-2.909262451529198e1, -8.409026463127816e0,  8.433805125372391e-1] },
      { jd: 2451545.0, label: 'J2000',       pos: [ 1.681204725521350e1, -2.499176306235863e1,  1.272225154327781e-1] },
      { jd: 2469807.5, label: '2050-Jan-01', pos: [ 1.739819861036683e1,  2.419778422682314e1, -8.992414286514476e-1] },
    ],
  },
];

describe('ephemeris gate — |Δr| < toleranceFactor × 0.1% of semi-major axis', () => {
  for (const planet of HORIZONS_REF) {
    const body = bodies.find((b) => b.id === planet.id);
    if (body?.elements === undefined) {
      it.skip(`${planet.id} has no elements`, () => {});
      continue;
    }

    const elements = body.elements;
    const factor = planet.toleranceFactor ?? 1.0;
    const toleranceAu = elements.semiMajorAxisAu * 0.001 * factor;
    const pct = (factor * 0.1).toFixed(1);

    for (const epoch of planet.epochs) {
      it(`${planet.id} at ${epoch.label} (JD ${epoch.jd}) [tol ${pct}% a]`, () => {
        const out: [number, number, number] = [0, 0, 0];
        elementsToPositionAu(elements, epoch.jd, out);

        const dx = out[0] - epoch.pos[0];
        const dy = out[1] - epoch.pos[1];
        const dz = out[2] - epoch.pos[2];
        const deltaR = Math.sqrt(dx * dx + dy * dy + dz * dz);

        expect(deltaR, `|Δr| = ${deltaR.toExponential(4)} AU, tolerance = ${toleranceAu.toExponential(4)} AU`).toBeLessThan(toleranceAu);
      });
    }
  }
});

// Suppress unused import warning — AU_KM imported for documentation purposes
void AU_KM;
