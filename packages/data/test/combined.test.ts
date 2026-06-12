import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCombinedSource, loadStarPack, loadSystemsPack } from '../src/index.js';
import type { CombinedSource, StarDataSource, SystemsSource } from '../src/index.js';
import { buildFixturePack, makeFileFetch } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const fetchImpl = makeFileFetch();

function fixtureUrl(name: string): string {
  return `file:///${join(FIXTURES, name).replace(/\\/g, '/')}`;
}

let stars: StarDataSource;
let exoSource: SystemsSource;
let solSource: SystemsSource;
let combined: CombinedSource;
let solOnly: CombinedSource;

beforeAll(async () => {
  const packDir = buildFixturePack();
  const manifestUrl = `file:///${packDir.replace(/\\/g, '/')}/manifest.json`;
  stars = await loadStarPack(manifestUrl, { fetchImpl });

  exoSource = await loadSystemsPack(fixtureUrl('systems-exo-fixture.json'), { fetchImpl });
  solSource = await loadSystemsPack(fixtureUrl('systems-sol-fixture.json'), { fetchImpl });

  combined = createCombinedSource(stars, [exoSource, solSource]);
  solOnly = createCombinedSource(stars, [solSource]);
});

describe('CombinedSource — deduplication', () => {
  it('colliding host resolves: canonicalId("exo:sirius") → "hyg:2"', () => {
    expect(combined.canonicalId('exo:sirius')).toBe('hyg:2');
  });

  it('exoidx:0 maps to first unresolved host (exo:trappist-1)', () => {
    expect(combined.canonicalId('exoidx:0')).toBe('exo:trappist-1');
  });

  it('exoidx:1 maps to second unresolved host (exo:kepler-442)', () => {
    expect(combined.canonicalId('exoidx:1')).toBe('exo:kepler-442');
  });

  it('HYG id passes through unchanged', () => {
    expect(combined.canonicalId('hyg:2')).toBe('hyg:2');
  });

  it('unresolved pack id passes through unchanged', () => {
    expect(combined.canonicalId('exo:trappist-1')).toBe('exo:trappist-1');
  });

  it('getBody("exo:sirius") returns the HYG Sirius record', () => {
    const body = combined.getBody('exo:sirius');
    expect(body).toBeDefined();
    expect(body!.id).toBe('hyg:2');
    expect(body!.kind).toBe('star');
  });

  it('hostPositionPc returns HYG position for a resolved host', () => {
    // hyg:2 (Sirius) is at ~[-1.94, -0.46, -0.75] pc in the HYG fixture
    const pos = combined.hostPositionPc('exo:sirius');
    expect(pos).toBeDefined();
    // Should be close to the real HYG position, not the pack position
    const dist = Math.hypot(...(pos as [number, number, number]));
    expect(dist).toBeGreaterThan(2.0);
  });

  it('hostPositionPc returns pack position for unresolved host', () => {
    const pos = combined.hostPositionPc('exo:trappist-1');
    expect(pos).toBeDefined();
    expect(pos![0]).toBeCloseTo(10.0, 5);
    expect(pos![1]).toBeCloseTo(0.0, 5);
    expect(pos![2]).toBeCloseTo(0.0, 5);
  });

  it('hostPositionPc returns [0,0,0] for sol (deduped to hyg:0)', () => {
    const pos = combined.hostPositionPc('sol');
    expect(pos).toBeDefined();
    expect(pos![0]).toBeCloseTo(0, 5);
    expect(pos![1]).toBeCloseTo(0, 5);
    expect(pos![2]).toBeCloseTo(0, 5);
  });

  it('hostPositionPc returns undefined for unknown system', () => {
    expect(combined.hostPositionPc('exo:nobody')).toBeUndefined();
  });
});

describe('CombinedSource — extraHostBatch', () => {
  it('count equals number of unresolved hosts (2 = TRAPPIST-1 + Kepler-442)', () => {
    expect(combined.extraHostBatch).not.toBeNull();
    expect(combined.extraHostBatch!.count).toBe(2);
  });

  it('idPrefix is "exoidx"', () => {
    expect(combined.extraHostBatch!.idPrefix).toBe('exoidx');
  });

  it('catalogIds[i] === i', () => {
    const { catalogIds } = combined.extraHostBatch!;
    expect(catalogIds[0]).toBe(0);
    expect(catalogIds[1]).toBe(1);
  });

  it('hostIdByIndex round-trips via exoidx canonicalId', () => {
    const { hostIdByIndex } = combined;
    expect(combined.canonicalId('exoidx:0')).toBe(hostIdByIndex[0]);
    expect(combined.canonicalId('exoidx:1')).toBe(hostIdByIndex[1]);
  });

  it('batch positions match pack records within f32 epsilon', () => {
    const { positionsPc } = combined.extraHostBatch!;
    const EPS = 1e-5;
    // Only TRAPPIST-1 and Kepler-442 are unresolved; sol and sirius are deduped.
    // TRAPPIST-1 is at [10,0,0], Kepler-442 at [30,0,0] — exactly f32-representable.
    const expected: ReadonlyArray<readonly [number, number, number]> = [
      [10.0, 0.0, 0.0], // TRAPPIST-1
      [30.0, 0.0, 0.0], // Kepler-442
    ];
    for (let i = 0; i < combined.extraHostBatch!.count; i++) {
      const [ex, ey, ez] = expected[i]!;
      expect(Math.abs(positionsPc[i * 3]! - ex)).toBeLessThan(EPS);
      expect(Math.abs(positionsPc[i * 3 + 1]! - ey)).toBeLessThan(EPS);
      expect(Math.abs(positionsPc[i * 3 + 2]! - ez)).toBeLessThan(EPS);
    }
  });

  it('extraHostBatch is null when all hosts resolve (sol-only)', () => {
    expect(solOnly.extraHostBatch).toBeNull();
  });
});

describe('CombinedSource — getBody', () => {
  it('getBody by HYG id returns the HYG star', () => {
    const body = combined.getBody('hyg:2');
    expect(body).toBeDefined();
    expect(body!.kind).toBe('star');
  });

  it('getBody("exo:trappist-1:e") returns PlanetRecord', () => {
    const body = combined.getBody('exo:trappist-1:e');
    expect(body).toBeDefined();
    expect(body!.kind).toBe('planet');
    expect((body as { name?: string }).name).toBe('TRAPPIST-1 e');
  });

  it('getBody("exoidx:0") returns the first unresolved host', () => {
    const body = combined.getBody('exoidx:0');
    expect(body).toBeDefined();
    expect(body!.kind).toBe('star');
  });

  it('getBody returns undefined for unknown id', () => {
    expect(combined.getBody('exo:nobody')).toBeUndefined();
  });

  it('getBody("sol:earth") returns Earth planet', () => {
    const body = combined.getBody('sol:earth');
    expect(body).toBeDefined();
    expect(body!.kind).toBe('planet');
  });
});

describe('CombinedSource — search', () => {
  it('search("trappist") returns TRAPPIST-1 host before planets', () => {
    const results = combined.search('trappist', 10);
    const hostIdx = results.findIndex(r => r.id === 'exo:trappist-1');
    const planetIdx = results.findIndex(r => r.id === 'exo:trappist-1:e');
    expect(hostIdx).toBeGreaterThanOrEqual(0);
    expect(planetIdx).toBeGreaterThanOrEqual(0);
    expect(hostIdx).toBeLessThan(planetIdx);
  });

  it('search("TRAPPIST-1 e") finds the planet by name', () => {
    const results = combined.search('TRAPPIST-1 e', 5);
    expect(results.some(r => r.id === 'exo:trappist-1:e')).toBe(true);
  });

  it('search ranking: exact > prefix > substring', () => {
    // "Alpha" — exact; "Alpha Beta" — prefix; "X Alpha Y" — substring
    const results = combined.search('alpha', 10);
    const exactIdx = results.findIndex(
      r => (r as { name?: string }).name?.toLowerCase() === 'alpha',
    );
    const prefixIdx = results.findIndex(
      r => (r as { name?: string }).name?.toLowerCase() === 'alpha beta',
    );
    const subIdx = results.findIndex(
      r => (r as { name?: string }).name?.toLowerCase() === 'x alpha y',
    );
    expect(exactIdx).toBeGreaterThanOrEqual(0);
    expect(prefixIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBeGreaterThanOrEqual(0);
    expect(exactIdx).toBeLessThan(prefixIdx);
    expect(prefixIdx).toBeLessThan(subIdx);
  });

  it('max parameter is respected', () => {
    const results = combined.search('a', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('deduplicated host ("Sirius") appears exactly once in search', () => {
    const results = combined.search('sirius', 10);
    const count = results.filter(r => (r as { name?: string }).name?.toLowerCase() === 'sirius').length;
    expect(count).toBe(1);
  });

  it('search returns empty array for empty query', () => {
    expect(combined.search('')).toEqual([]);
  });
});

describe('CombinedSource — nearestHostSystem', () => {
  it('returns Sol at the origin', () => {
    const hit = combined.nearestHostSystem(0, 0, 0);
    expect(hit).not.toBeNull();
    expect(hit!.systemId).toBe('sol');
    expect(hit!.distancePc).toBeCloseTo(0, 5);
  });

  it('returns the nearer of two systems from a biased midpoint', () => {
    // TRAPPIST-1 is at [10,0,0], Kepler-442 at [30,0,0]
    // From [12,0,0]: dist to TRAPPIST-1=2, dist to Kepler-442=18
    // (Sol at [0,0,0] has dist=12, Sirius ~2.1 pc — bias point toward TRAPPIST-1)
    // Use [9,0,0] to be clearly closest to TRAPPIST-1 (dist=1) over sol (dist=9)
    const hit = combined.nearestHostSystem(9, 0, 0);
    expect(hit).not.toBeNull();
    expect(hit!.systemId).toBe('exo:trappist-1');
  });

  it('returns null for empty systems list', () => {
    const emptyCombined = createCombinedSource(stars, []);
    expect(emptyCombined.nearestHostSystem(0, 0, 0)).toBeNull();
  });
});
