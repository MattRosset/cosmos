/**
 * pack-solar unit tests.
 *
 * Tests the conversion logic directly (no I/O) and validates the committed
 * systems-sol.json against the Zod schema and acceptance criteria.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPack } from '../src/convert.js';
import { SourceDataSchema, SystemsPackManifestSchema } from '../src/schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../../..');
const dataPath = join(__dirname, '../data/solar-system.json');
const packPath = join(projectRoot, 'apps/web/public/packs/systems-sol.json');

const raw = JSON.parse(readFileSync(dataPath, 'utf-8')) as unknown;
const source = SourceDataSchema.parse(raw);

describe('source data transcription checksums', () => {
  it('Mercury a, e, I match JPL Table 1', () => {
    const m = source.jplTable1.find((p) => p.id === 'sol:mercury')!;
    expect(m.a).toBe(0.38709927);
    expect(m.e).toBe(0.20563593);
    expect(m.I).toBe(7.00497902);
  });

  it('Earth a, e match JPL Table 1 (Earth-Moon barycenter)', () => {
    const e = source.jplTable1.find((p) => p.id === 'sol:earth')!;
    expect(e.a).toBe(1.00000261);
    expect(e.e).toBe(0.01671123);
  });

  it('Jupiter a matches JPL Table 1', () => {
    const j = source.jplTable1.find((p) => p.id === 'sol:jupiter')!;
    expect(j.a).toBe(5.20288700);
  });
});

describe('buildPack', () => {
  const pack = buildPack(source);

  it('validates against SystemsPackManifest Zod schema', () => {
    expect(() => SystemsPackManifestSchema.parse(pack)).not.toThrow();
  });

  it('has exactly 1 system with id "sol"', () => {
    expect(pack.systems).toHaveLength(1);
    expect(pack.systems[0]!.id).toBe('sol');
  });

  it('has exactly 15 bodies (1 sol disc + 8 planets + 6 moons)', () => {
    expect(pack.systems[0]!.bodies).toHaveLength(15);
  });

  it('body ids are exactly as specified', () => {
    const ids = pack.systems[0]!.bodies.map((b) => b.id);
    expect(ids).toContain('sol:sun');
    expect(ids).toContain('sol:mercury');
    expect(ids).toContain('sol:venus');
    expect(ids).toContain('sol:earth');
    expect(ids).toContain('sol:mars');
    expect(ids).toContain('sol:jupiter');
    expect(ids).toContain('sol:saturn');
    expect(ids).toContain('sol:uranus');
    expect(ids).toContain('sol:neptune');
    expect(ids).toContain('sol:moon');
    expect(ids).toContain('sol:io');
    expect(ids).toContain('sol:europa');
    expect(ids).toContain('sol:ganymede');
    expect(ids).toContain('sol:callisto');
    expect(ids).toContain('sol:titan');
  });

  it('parent links are correct', () => {
    const bodies = pack.systems[0]!.bodies;
    const byId = Object.fromEntries(bodies.map((b) => [b.id, b]));

    // Sol disc and all 8 planets orbit the star
    for (const id of ['sol:sun', 'sol:mercury', 'sol:venus', 'sol:earth', 'sol:mars',
                       'sol:jupiter', 'sol:saturn', 'sol:uranus', 'sol:neptune']) {
      expect(byId[id]!.parentId).toBe('hyg:0');
    }

    // Moons orbit their parent planets
    expect(byId['sol:moon']!.parentId).toBe('sol:earth');
    expect(byId['sol:io']!.parentId).toBe('sol:jupiter');
    expect(byId['sol:europa']!.parentId).toBe('sol:jupiter');
    expect(byId['sol:ganymede']!.parentId).toBe('sol:jupiter');
    expect(byId['sol:callisto']!.parentId).toBe('sol:jupiter');
    expect(byId['sol:titan']!.parentId).toBe('sol:saturn');
  });

  it('sol:sun has no orbital elements (fixed at origin)', () => {
    const sun = pack.systems[0]!.bodies.find((b) => b.id === 'sol:sun')!;
    expect(sun.elements).toBeUndefined();
    expect(sun.unlit).toBe(true);
  });

  it('all planets have orbital elements with valid radians', () => {
    const planetIds = ['sol:mercury', 'sol:venus', 'sol:earth', 'sol:mars',
                       'sol:jupiter', 'sol:saturn', 'sol:uranus', 'sol:neptune'];
    for (const id of planetIds) {
      const body = pack.systems[0]!.bodies.find((b) => b.id === id)!;
      expect(body.elements).toBeDefined();
      const el = body.elements!;
      expect(el.semiMajorAxisAu).toBeGreaterThan(0);
      expect(el.eccentricity).toBeGreaterThanOrEqual(0);
      expect(el.eccentricity).toBeLessThan(1);
      expect(Math.abs(el.inclinationRad)).toBeLessThanOrEqual(Math.PI);
      expect(el.muKm3S2).toBeGreaterThan(0);
    }
  });

  it('Saturn has ring spec', () => {
    const saturn = pack.systems[0]!.bodies.find((b) => b.id === 'sol:saturn')!;
    expect(saturn.ring).toBeDefined();
    expect(saturn.ring!.innerRadiusKm).toBe(74500);
    expect(saturn.ring!.outerRadiusKm).toBe(140220);
    expect(saturn.textures?.ringUrl).toBe('../textures/sol/saturn_ring.ktx2');
  });

  it('source field is "jpl-approx-pos-1800-2050"', () => {
    expect(pack.source).toBe('jpl-approx-pos-1800-2050');
  });

  it('generatedAtIso comes from source file (not Date.now)', () => {
    expect(pack.generatedAtIso).toBe(source.generatedAtIso);
  });
});

describe('determinism', () => {
  it('two builds produce byte-identical JSON', () => {
    const pack1 = buildPack(source);
    const pack2 = buildPack(source);
    expect(JSON.stringify(pack1)).toBe(JSON.stringify(pack2));
  });
});

describe('moon orbital period sanity', () => {
  function periodDays(aKm: number, muKm3S2: number): number {
    const n = Math.sqrt(muKm3S2 / (aKm * aKm * aKm));
    return (2 * Math.PI / n) / 86400;
  }

  it('sol:moon period in [27.2, 27.5] days', () => {
    const moon = source.moonsTable.find((m) => m.id === 'sol:moon')!;
    const mu = source.parentGm['sol:earth']!;
    const T = periodDays(moon.aKm, mu);
    expect(T).toBeGreaterThanOrEqual(27.2);
    expect(T).toBeLessThanOrEqual(27.5);
  });

  it('sol:io period ≈ 1.77 days (±1%)', () => {
    const io = source.moonsTable.find((m) => m.id === 'sol:io')!;
    const mu = source.parentGm['sol:jupiter']!;
    const T = periodDays(io.aKm, mu);
    expect(T).toBeCloseTo(1.77, 1); // within ±0.05 days
    expect(Math.abs(T - 1.769) / 1.769).toBeLessThan(0.01);
  });

  it('sol:titan period ≈ 15.9 days (±1%)', () => {
    const titan = source.moonsTable.find((m) => m.id === 'sol:titan')!;
    const mu = source.parentGm['sol:saturn']!;
    const T = periodDays(titan.aKm, mu);
    expect(Math.abs(T - 15.945) / 15.945).toBeLessThan(0.01);
  });

  it('moon rotationPeriodH in pack matches orbital period', () => {
    const pack = buildPack(source);
    const bodies = pack.systems[0]!.bodies;
    const moon = bodies.find((b) => b.id === 'sol:moon')!;
    expect(moon.rotationPeriodH).toBeDefined();
    // Moon orbital period ≈ 655–660 hours
    expect(moon.rotationPeriodH!).toBeGreaterThan(650);
    expect(moon.rotationPeriodH!).toBeLessThan(670);
  });
});

describe('committed pack integrity', () => {
  it('systems-sol.json exists', () => {
    expect(existsSync(packPath)).toBe(true);
  });

  it('systems-sol.json validates against schema', () => {
    const packed = JSON.parse(readFileSync(packPath, 'utf-8')) as unknown;
    expect(() => SystemsPackManifestSchema.parse(packed)).not.toThrow();
  });

  it('systems-sol.json is < 64 KB', () => {
    const content = readFileSync(packPath, 'utf-8');
    expect(content.length).toBeLessThan(64 * 1024);
  });

  it('every textures.*Url in pack resolves to an existing file', () => {
    const packed = JSON.parse(readFileSync(packPath, 'utf-8')) as {
      systems: Array<{
        bodies: Array<{
          id: string;
          textures?: { albedoUrl?: string; ringUrl?: string };
        }>;
      }>;
    };

    const packDir = join(projectRoot, 'apps/web/public/packs');
    const missing: string[] = [];

    for (const system of packed.systems) {
      for (const body of system.bodies) {
        if (body.textures === undefined) continue;
        const { albedoUrl, ringUrl } = body.textures;
        for (const url of [albedoUrl, ringUrl]) {
          if (url === undefined) continue;
          const texturePath = join(packDir, url);
          if (!existsSync(texturePath)) {
            missing.push(`${body.id}: ${url}`);
          }
        }
      }
    }

    expect(missing).toHaveLength(0);
  });
});
