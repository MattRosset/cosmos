/**
 * pack-exoplanets unit + integration tests.
 *
 * Exercises every fallback rule from the TASK-022 spec:
 *   - Kepler III semi-major axis from period
 *   - Eccentricity → 0 fallback
 *   - Radius: pl_rade, mass-radius, and bare-default paths
 *   - Color bands (hot / temperate / cold)
 *   - absMag default (10.0) when sy_vmag missing
 *   - B-V inversion + fallback (1.5) when st_teff missing
 *   - Shared system plane; different planes across hosts
 *   - Determinism: two builds byte-identical
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseCsv } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/convert.js';
import { CsvRowSchema, SystemsPackManifestSchema } from '../src/schema.js';
import {
  AU_KM,
  ballesterosInvert,
  hostSlug,
  makePrng,
  resolveRadius,
  surfaceColorFromTeq,
} from '../src/synthesize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../../..');
const fixturePath = join(__dirname, 'fixtures/pscomppars-mini.csv');
const packPath = join(projectRoot, 'apps/web/public/packs/systems-exo.json');

const GENERATED_AT = '2026-06-12T00:00:00.000Z';

// ---------------------------------------------------------------------------
// Load and parse fixture
// ---------------------------------------------------------------------------

function loadFixture() {
  const text = readFileSync(fixturePath, 'utf-8');
  const rawRows = parseCsv(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as unknown[];
  return rawRows.map((r) => CsvRowSchema.parse(r));
}

const fixtureRows = loadFixture();
const pack = buildPack(fixtureRows, GENERATED_AT);

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('manifest schema', () => {
  it('validates against SystemsPackManifest Zod schema', () => {
    expect(() => SystemsPackManifestSchema.parse(pack)).not.toThrow();
  });

  it('source field is "nasa-exoplanet-archive-pscomppars"', () => {
    expect(pack.source).toBe('nasa-exoplanet-archive-pscomppars');
  });

  it('packFormatVersion is 1', () => {
    expect(pack.packFormatVersion).toBe(1);
  });

  it('generatedAtIso comes from the argument, not Date.now()', () => {
    expect(pack.generatedAtIso).toBe(GENERATED_AT);
  });
});

// ---------------------------------------------------------------------------
// TRAPPIST-1 system
// ---------------------------------------------------------------------------

describe('TRAPPIST-1 system', () => {
  const trappist = pack.systems.find((s) => s.id === 'exo:trappist-1')!;

  it('system exists with id exo:trappist-1', () => {
    expect(trappist).toBeDefined();
  });

  it('has exactly 7 planets', () => {
    expect(trappist.bodies).toHaveLength(7);
  });

  it('planet ids are exo:trappist-1:b … :h', () => {
    const ids = trappist.bodies.map((b) => b.id);
    for (const letter of ['b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      expect(ids).toContain(`exo:trappist-1:${letter}`);
    }
  });

  it('host |positionPc| ≈ 12.4 ± 0.4 pc', () => {
    const [x, y, z] = trappist.star.positionPc;
    const dist = Math.sqrt(x * x + y * y + z * z);
    expect(dist).toBeGreaterThan(12.0);
    expect(dist).toBeLessThan(12.8);
  });

  it('all 7 planets share the same inclinationRad and ascendingNodeLongitudeRad', () => {
    const [first, ...rest] = trappist.bodies;
    for (const body of rest) {
      expect(body.elements!.inclinationRad).toBe(first!.elements!.inclinationRad);
      expect(body.elements!.ascendingNodeLongitudeRad).toBe(
        first!.elements!.ascendingNodeLongitudeRad,
      );
    }
  });

  it('all elements are finite', () => {
    for (const body of trappist.bodies) {
      const el = body.elements!;
      expect(isFinite(el.semiMajorAxisAu)).toBe(true);
      expect(isFinite(el.eccentricity)).toBe(true);
      expect(isFinite(el.inclinationRad)).toBe(true);
      expect(isFinite(el.ascendingNodeLongitudeRad)).toBe(true);
      expect(isFinite(el.argumentOfPeriapsisRad)).toBe(true);
      expect(isFinite(el.meanAnomalyAtEpochRad)).toBe(true);
    }
  });

  it('absMag uses sy_vmag − 5·log10(sy_dist/10)', () => {
    const expected = 18.8 - 5 * Math.log10(12.43 / 10);
    expect(trappist.star.absMag).toBeCloseTo(expected, 5);
  });

  it('colorIndexBV from st_teff=2566 is in [−0.4, 2.0]', () => {
    const bv = trappist.star.colorIndexBV;
    expect(bv).toBeGreaterThanOrEqual(-0.4);
    expect(bv).toBeLessThanOrEqual(2.0);
  });
});

// ---------------------------------------------------------------------------
// Kepler III fallback — Proxima Cen b (no pl_orbsmax, only pl_orbper)
// ---------------------------------------------------------------------------

describe('Kepler III fallback (Proxima Cen b)', () => {
  const proxima = pack.systems.find((s) => s.id === 'exo:proxima-cen')!;
  const planet = proxima.bodies.find((b) => b.id === 'exo:proxima-cen:b')!;

  it('system and planet exist', () => {
    expect(proxima).toBeDefined();
    expect(planet).toBeDefined();
  });

  it('semiMajorAxisAu matches Kepler III formula (±1e-6)', () => {
    // Hand-computed reference: a³ = μ·P²/(4π²), a in AU
    const mu = 0.1221 * 1.32712440018e11; // km³/s²
    const P = 11.1868 * 86400; // seconds
    const expectedAu = Math.cbrt((mu * P * P) / (4 * Math.PI ** 2)) / AU_KM;
    expect(planet.elements!.semiMajorAxisAu).toBeCloseTo(expectedAu, 6);
  });

  it('eccentricity falls back to 0 (pl_orbeccen missing)', () => {
    expect(planet.elements!.eccentricity).toBe(0);
  });

  it('radius from pl_bmasse=1.07 (mass-radius path)', () => {
    const expectedKm = Math.min(Math.pow(1.07, 0.28), 11.2) * 6371;
    expect(planet.radiusKm).toBeCloseTo(expectedKm, 3);
  });

  it('absMag defaults to 10.0 (sy_vmag missing)', () => {
    expect(proxima.star.absMag).toBe(10.0);
  });

  it('colorIndexBV defaults to 1.5 (st_teff missing)', () => {
    expect(proxima.star.colorIndexBV).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// Eccentricity fallback — tau Cet e (pl_orbeccen missing)
// ---------------------------------------------------------------------------

describe('eccentricity fallback (tau Cet e)', () => {
  const tauCet = pack.systems.find((s) => s.id === 'exo:tau-cet')!;
  const planet = tauCet.bodies.find((b) => b.id === 'exo:tau-cet:e')!;

  it('eccentricity defaults to 0 when pl_orbeccen is absent', () => {
    expect(planet.elements!.eccentricity).toBe(0);
  });

  it('semiMajorAxisAu uses pl_orbsmax directly', () => {
    expect(planet.elements!.semiMajorAxisAu).toBeCloseTo(0.538, 5);
  });

  it('radius from pl_rade=3.93', () => {
    expect(planet.radiusKm).toBeCloseTo(3.93 * 6371, 3);
  });
});

// ---------------------------------------------------------------------------
// Radius fallbacks — GJ 876
// ---------------------------------------------------------------------------

describe('radius fallbacks (GJ 876)', () => {
  const gj876 = pack.systems.find((s) => s.id === 'exo:gj-876')!;

  it('GJ 876 b: no pl_rade or pl_bmasse → 2×6371 km', () => {
    const b = gj876.bodies.find((p) => p.id === 'exo:gj-876:b')!;
    expect(b.radiusKm).toBe(2 * 6371);
  });

  it('GJ 876 c: pl_bmasse=0.56 → mass-radius formula', () => {
    const c = gj876.bodies.find((p) => p.id === 'exo:gj-876:c')!;
    const expectedKm = Math.min(Math.pow(0.56, 0.28), 11.2) * 6371;
    expect(c.radiusKm).toBeCloseTo(expectedKm, 3);
  });

  it('GJ 876 d: pl_rade=1.65 → 1.65×6371 km', () => {
    const d = gj876.bodies.find((p) => p.id === 'exo:gj-876:d')!;
    expect(d.radiusKm).toBeCloseTo(1.65 * 6371, 3);
  });

  it('GJ 876 b: pl_orblper=175.6 used for argumentOfPeriapsisRad', () => {
    const b = gj876.bodies.find((p) => p.id === 'exo:gj-876:b')!;
    const expected = (175.6 * Math.PI) / 180;
    expect(b.elements!.argumentOfPeriapsisRad).toBeCloseTo(expected, 6);
  });

  it('all GJ 876 planets share the same system plane', () => {
    const [first, ...rest] = gj876.bodies;
    for (const body of rest) {
      expect(body.elements!.inclinationRad).toBe(first!.elements!.inclinationRad);
      expect(body.elements!.ascendingNodeLongitudeRad).toBe(
        first!.elements!.ascendingNodeLongitudeRad,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Different hosts get different system planes
// ---------------------------------------------------------------------------

describe('system plane isolation', () => {
  it('TRAPPIST-1 and GJ 876 have different inclinationRad', () => {
    const trappist = pack.systems.find((s) => s.id === 'exo:trappist-1')!;
    const gj876 = pack.systems.find((s) => s.id === 'exo:gj-876')!;
    expect(trappist.bodies[0]!.elements!.inclinationRad).not.toBe(
      gj876.bodies[0]!.elements!.inclinationRad,
    );
  });
});

// ---------------------------------------------------------------------------
// Color bands
// ---------------------------------------------------------------------------

describe('surface color bands', () => {
  it('T_eq > 1000 K → hot color [0.55, 0.35, 0.20]', () => {
    const color = surfaceColorFromTeq(1500);
    expect(color).toEqual([0.55, 0.35, 0.20]);
  });

  it('T_eq in [200, 1000] → temperate color [0.25, 0.35, 0.45]', () => {
    const color = surfaceColorFromTeq(300);
    expect(color).toEqual([0.25, 0.35, 0.45]);
  });

  it('T_eq < 200 K → cold color [0.75, 0.78, 0.82]', () => {
    const color = surfaceColorFromTeq(100);
    expect(color).toEqual([0.75, 0.78, 0.82]);
  });

  it('TRAPPIST-1 b (innermost, cool star) color is assigned', () => {
    const trappist = pack.systems.find((s) => s.id === 'exo:trappist-1')!;
    const b = trappist.bodies.find((p) => p.id === 'exo:trappist-1:b')!;
    expect(b.surfaceColorLinear).toBeDefined();
    expect(b.surfaceColorLinear).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// B-V inversion
// ---------------------------------------------------------------------------

describe('Ballesteros B-V inversion', () => {
  it('st_teff=5772 → bv ≈ 0.65 ± 0.05 (round-trips TASK-010 forward formula)', () => {
    const bv = ballesterosInvert(5772);
    expect(bv).toBeGreaterThan(0.60);
    expect(bv).toBeLessThan(0.70);
  });

  it('result clamped to [−0.4, 2.0]', () => {
    expect(ballesterosInvert(50000)).toBeLessThanOrEqual(2.0);
    expect(ballesterosInvert(50000)).toBeGreaterThanOrEqual(-0.4);
    expect(ballesterosInvert(1000)).toBeLessThanOrEqual(2.0);
  });
});

// ---------------------------------------------------------------------------
// Radius clamp
// ---------------------------------------------------------------------------

describe('radius mass-radius clamp', () => {
  it('very massive planet clamped to 11.2 R⊕ × 6371 km', () => {
    // Need mass where mass^0.28 > 11.2, i.e. mass > 11.2^(1/0.28) ≈ 5607 M⊕.
    // 10000^0.28 ≈ 13.17 → clamped to 11.2.
    const r = resolveRadius(null, 10000);
    expect(r).toBeCloseTo(11.2 * 6371, 1);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('two builds from the same rows produce byte-identical JSON', () => {
    const pack1 = buildPack(fixtureRows, GENERATED_AT);
    const pack2 = buildPack(fixtureRows, GENERATED_AT);
    expect(JSON.stringify(pack1)).toBe(JSON.stringify(pack2));
  });

  it('changing host slug changes only that system\'s synthesized values', () => {
    // TRAPPIST-1 and Proxima Cen should have independent PRNG streams
    const trappistProng = makePrng(hostSlug('TRAPPIST-1'));
    const proximaProng = makePrng(hostSlug('Proxima Cen'));
    // First draw (cos inclination) should differ
    expect(trappistProng.next()).not.toBe(proximaProng.next());
  });
});

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

describe('host slug', () => {
  it('TRAPPIST-1 → trappist-1', () => {
    expect(hostSlug('TRAPPIST-1')).toBe('trappist-1');
  });

  it('Proxima Cen → proxima-cen', () => {
    expect(hostSlug('Proxima Cen')).toBe('proxima-cen');
  });

  it('GJ 876 → gj-876', () => {
    expect(hostSlug('GJ 876')).toBe('gj-876');
  });

  it('tau Cet → tau-cet', () => {
    expect(hostSlug('tau Cet')).toBe('tau-cet');
  });
});

// ---------------------------------------------------------------------------
// Committed pack integrity (skipped if pack doesn't exist yet)
// ---------------------------------------------------------------------------

describe('committed pack integrity', () => {
  it('systems-exo.json exists', () => {
    expect(existsSync(packPath)).toBe(true);
  });

  it('systems-exo.json validates against schema', () => {
    if (!existsSync(packPath)) return;
    const packed = JSON.parse(readFileSync(packPath, 'utf-8')) as unknown;
    expect(() => SystemsPackManifestSchema.parse(packed)).not.toThrow();
  });

  it('systems-exo.json is < 1.5 MB', () => {
    if (!existsSync(packPath)) return;
    const content = readFileSync(packPath, 'utf-8');
    expect(content.length).toBeLessThan(1.5 * 1024 * 1024);
  });

  it('source is "nasa-exoplanet-archive-pscomppars"', () => {
    if (!existsSync(packPath)) return;
    const packed = JSON.parse(readFileSync(packPath, 'utf-8')) as { source: string };
    expect(packed.source).toBe('nasa-exoplanet-archive-pscomppars');
  });
});
