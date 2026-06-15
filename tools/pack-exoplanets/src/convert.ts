/**
 * Convert validated CSV rows into a SystemsPackManifest.
 *
 * Unit boundary (§5.5):
 *   - RA/Dec in degrees → radians at the top of icrsToGalactic()
 *   - pl_orblper in degrees → radians inside drawPlanetAngles()
 *   - All other angles are synthesized or already in radians
 */

import type { KeplerElements, PlanetRecord, StarRecord, StarSystemRecord, SystemsPackManifest } from '@cosmos/core-types';
import { ICRS_TO_GALACTIC, SYSTEMS_PACK_FORMAT_VERSION, applyMat3 } from '@cosmos/core-types';
import type { CsvRow } from './schema.js';
import {
  AU_KM,
  absMagFromApparent,
  ballesterosInvert,
  bvToStarColorLinear,
  drawPlanetAngles,
  drawSystemPlane,
  equilibriumTemp,
  hostMu,
  hostSlug,
  makePrng,
  planetSuffix,
  resolveEccentricity,
  resolveRadius,
  resolveStarRadiusKm,
  surfaceColorFromTeq,
  semiMajorFromPeriod,
} from './synthesize.js';

const J2000_JD = 2451545.0;

// ---------------------------------------------------------------------------
// Coordinate conversion: ICRS equatorial → galactic Cartesian
// ---------------------------------------------------------------------------

/**
 * Convert RA/Dec (degrees) + distance (pc) to galactic Cartesian position (pc).
 * RA/Dec → unit vector in ICRS → rotate by ICRS_TO_GALACTIC → scale by dist.
 * Degrees are converted at this boundary only (§5.5).
 */
function icrsToGalacticPc(
  raDeg: number,
  decDeg: number,
  distPc: number,
): readonly [number, number, number] {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const x = Math.cos(dec) * Math.cos(ra);
  const y = Math.cos(dec) * Math.sin(ra);
  const z = Math.sin(dec);
  const gal = applyMat3(ICRS_TO_GALACTIC, x, y, z, [0, 0, 0]);
  return [gal[0] * distPc, gal[1] * distPc, gal[2] * distPc];
}

// ---------------------------------------------------------------------------
// Per-system conversion
// ---------------------------------------------------------------------------

interface PlanetInput {
  row: CsvRow;
  suffix: string;
}

function buildPlanet(
  input: PlanetInput,
  systemId: string,
  systemPlane: { inclinationRad: number; ascendingNodeLongitudeRad: number },
  planetAngles: { argumentOfPeriapsisRad: number; meanAnomalyAtEpochRad: number },
  muKm3S2: number,
  stRadSolar: number | null,
  stTeff: number | null,
): PlanetRecord {
  const { row, suffix } = input;
  const id = `${systemId}:${suffix}`;

  const semiMajorAxisAu =
    row.pl_orbsmax !== null
      ? row.pl_orbsmax
      : semiMajorFromPeriod(row.pl_orbper!, muKm3S2);

  const eccentricity = resolveEccentricity(row.pl_orbeccen);

  const elements: KeplerElements = {
    semiMajorAxisAu,
    eccentricity,
    inclinationRad: systemPlane.inclinationRad,
    ascendingNodeLongitudeRad: systemPlane.ascendingNodeLongitudeRad,
    argumentOfPeriapsisRad: planetAngles.argumentOfPeriapsisRad,
    meanAnomalyAtEpochRad: planetAngles.meanAnomalyAtEpochRad,
    epochJD: J2000_JD,
    muKm3S2,
  };

  const radiusKm = resolveRadius(row.pl_rade, row.pl_bmasse);
  const teq = equilibriumTemp(stRadSolar, stTeff, semiMajorAxisAu);
  const surfaceColorLinear = surfaceColorFromTeq(teq);

  return {
    id,
    kind: 'planet',
    name: row.pl_name,
    parentId: systemId,
    radiusKm,
    elements,
    surfaceColorLinear,
  };
}

/**
 * Renderable host-star disc (NAV-A). Exoplanet hosts were previously kept only as
 * `system.star` (data), so `SystemScene` — which renders `system.bodies` — drew
 * nothing at the origin and planets orbited empty space. Emit a body for the host,
 * mirroring Sol's `sol:sun` (`kind:"planet"`, `unlit:true`, no `elements` ⇒ placed
 * at the system origin), with a real stellar radius (`st_rad`) and a B-V tint.
 *
 * Intentionally NAMELESS: the host star is already searchable as `system.star`, so
 * a named disc would duplicate it in search results. A click still selects the disc
 * (picking), and `SystemScene` remaps that to the host StarRecord for the info panel.
 */
function buildHostStarBody(
  systemId: string,
  stRadSolar: number | null,
  colorIndexBV: number,
): PlanetRecord {
  const [r, g, b] = bvToStarColorLinear(colorIndexBV);
  return {
    id: `${systemId}:star`,
    kind: 'planet',
    parentId: systemId,
    radiusKm: resolveStarRadiusKm(stRadSolar),
    unlit: true,
    surfaceColorLinear: [r, g, b],
  };
}

function buildSystem(hostname: string, rows: CsvRow[]): StarSystemRecord {
  // Use the first row for host-star fields (all rows share the same host).
  const first = rows[0]!;
  const slug = hostSlug(hostname);
  const systemId = `exo:${slug}`;

  const positionPc = icrsToGalacticPc(first.ra, first.dec, first.sy_dist);

  const absMag =
    first.sy_vmag !== null ? absMagFromApparent(first.sy_vmag, first.sy_dist) : 10.0;

  const colorIndexBV =
    first.st_teff !== null ? ballesterosInvert(first.st_teff) : 1.5;

  const star: StarRecord = {
    id: systemId,
    kind: 'star',
    name: hostname,
    positionPc,
    absMag,
    colorIndexBV,
  };

  // Sort planets by pl_name for reproducible ordering.
  const sorted = [...rows].sort((a, b) => a.pl_name.localeCompare(b.pl_name));

  const mu = hostMu(first.st_mass);
  const prng = makePrng(slug);

  // System-plane draws (calls 1 & 2 — must precede all per-planet draws).
  const systemPlane = drawSystemPlane(prng);

  const planets: PlanetRecord[] = sorted.map((row) => {
    const suffix = planetSuffix(row.pl_name, hostname);
    const planetAngles = drawPlanetAngles(prng, row.pl_orblper);
    return buildPlanet(
      { row, suffix },
      systemId,
      systemPlane,
      planetAngles,
      mu,
      first.st_rad,
      first.st_teff,
    );
  });

  // Host-star disc first, then planets (NAV-A). The PRNG stream is untouched —
  // the star body consumes no draws, so existing planet synthesis is unchanged.
  const starBody = buildHostStarBody(systemId, first.st_rad, colorIndexBV);

  return { id: systemId, name: hostname, star, bodies: [starBody, ...planets] };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Group validated rows by hostname, convert each group to a StarSystemRecord,
 * sort systems by host slug for stable output ordering.
 * Pure — no I/O.
 */
export function buildPack(rows: CsvRow[], generatedAtIso: string): SystemsPackManifest {
  // Group by hostname.
  const byHost = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const existing = byHost.get(row.hostname);
    if (existing) {
      existing.push(row);
    } else {
      byHost.set(row.hostname, [row]);
    }
  }

  // Build systems, sorted by slug for deterministic ordering.
  const systems: StarSystemRecord[] = Array.from(byHost.entries())
    .sort(([a], [b]) => hostSlug(a).localeCompare(hostSlug(b)))
    .map(([hostname, hostRows]) => buildSystem(hostname, hostRows));

  return {
    packFormatVersion: SYSTEMS_PACK_FORMAT_VERSION,
    source: 'nasa-exoplanet-archive-pscomppars',
    generatedAtIso,
    systems,
  };
}

/**
 * Parse and filter CSV rows before passing to buildPack.
 * Drops rows with unparseable ra/dec/sy_dist (Zod rejects them).
 * All other rows must pass full validation — fail loudly on unexpected data.
 */
export function filterRows(rawRows: unknown[]): CsvRow[] {
  // Re-export slug utilities for convenience in tests/CLI.
  return rawRows as CsvRow[];
}

export { hostSlug, planetSuffix, AU_KM };
