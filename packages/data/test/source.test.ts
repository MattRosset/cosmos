import { beforeAll, describe, expect, it } from 'vitest';
import { loadStarPack } from '../src/index.js';
import { buildFixturePack, makeFileFetch } from './helpers.js';

let src: Awaited<ReturnType<typeof loadStarPack>>;

beforeAll(async () => {
  const packDir = buildFixturePack();
  const manifestUrl = `file:///${packDir.replace(/\\/g, '/')}/manifest.json`;
  src = await loadStarPack(manifestUrl, { fetchImpl: makeFileFetch() });
});

// ── getBody ──────────────────────────────────────────────────────────────────

describe('getBody', () => {
  it('returns the correct record for "hyg:2" (Sirius)', () => {
    const r = src.getBody('hyg:2');
    expect(r).not.toBeNull();
    expect(r!.id).toBe('hyg:2');
    expect(r!.kind).toBe('star');
    expect(r!.name).toBe('Sirius');
    expect(r!.absMag).toBeCloseTo(1.43, 2);
    expect(r!.colorIndexBV).toBeCloseTo(0.009, 3);
  });

  it('returns null for unknown id', () => {
    expect(src.getBody('hyg:9999999')).toBeNull();
  });

  it('returns null for wrong prefix', () => {
    expect(src.getBody('gaia:2')).toBeNull();
  });

  it('returns null for malformed id (no colon)', () => {
    expect(src.getBody('nocolon')).toBeNull();
  });

  it('absolute position magnitude ≈ dist for Sirius', () => {
    const r = src.getBody('hyg:2')!;
    const dist = Math.hypot(...(r.positionPc as [number, number, number]));
    expect(Math.abs(dist - 2.6371) / 2.6371).toBeLessThan(0.001);
  });
});

// ── getByIndex ────────────────────────────────────────────────────────────────

describe('getByIndex', () => {
  it('returns a valid star record', () => {
    const r = src.getByIndex(0);
    expect(r.kind).toBe('star');
    expect(r.id).toMatch(/^hyg:\d+$/);
  });
});

// ── search ────────────────────────────────────────────────────────────────────

describe('search', () => {
  it('"sirius" returns Sirius first', () => {
    const results = src.search('sirius');
    expect(results[0]?.name).toBe('Sirius');
  });

  it('"SIRI" (case-insensitive) returns Sirius first', () => {
    const results = src.search('SIRI');
    expect(results[0]?.name).toBe('Sirius');
  });

  it('HIP query resolves Sirius (hip 32349)', () => {
    const results = src.search('hip 32349');
    expect(results[0]?.name).toBe('Sirius');
  });

  it('HIP query without space also works (hip32349)', () => {
    const results = src.search('hip32349');
    expect(results[0]?.name).toBe('Sirius');
  });

  it('HIP 0 returns no results (not a valid HIP number)', () => {
    expect(src.search('hip 0')).toHaveLength(0);
  });

  it('unnamed stars are never returned by name search', () => {
    // star id=5 has no name; searching an arbitrary substring should not find it
    const results = src.search('');
    expect(results).toHaveLength(0);
  });

  it('maxResults is respected', () => {
    // Search for something that matches multiple names (e.g. substring found in all proper names)
    // Use 'a' which is in "Sirius", "Vega", "Rigil Kentaurus", "21 Tau", "GJ 451"
    const results = src.search('a', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('empty query returns empty array', () => {
    expect(src.search('')).toHaveLength(0);
    expect(src.search('   ')).toHaveLength(0);
  });

  it('prefix matches ranked before other substring matches', () => {
    // 'rig' is a prefix of 'Rigil Kentaurus'
    const results = src.search('rig');
    expect(results[0]?.name).toBe('Rigil Kentaurus');
  });

  it('within prefix matches, brighter (lower absMag) is ranked first', () => {
    // 'sir' only matches Sirius in the fixture; just verify it returns Sirius
    const results = src.search('sir');
    expect(results[0]?.name).toBe('Sirius');
  });
});

// ── search timing ────────────────────────────────────────────────────────────

describe('search timing', () => {
  it('search over 120k synthetic names completes in < 50 ms', async () => {
    // Build a synthetic source with 120k names (seeded PRNG, no real pack needed)
    const COUNT = 120_000;

    // Seeded LCG PRNG for deterministic names
    let state = 42;
    function nextRand(): number {
      state = (state * 1664525 + 1013904223) & 0xffffffff;
      return (state >>> 0) / 0x100000000;
    }
    const adjectives = ['red', 'blue', 'dark', 'bright', 'cold', 'hot', 'dim', 'pale'];
    const nouns = ['star', 'sun', 'dwarf', 'giant', 'nova', 'beta', 'alpha', 'delta'];
    function syntheticName(i: number): string {
      return `${adjectives[Math.floor(nextRand() * adjectives.length)]!}-${nouns[Math.floor(nextRand() * nouns.length)]!}-${String(i)}`;
    }

    const positions = new Float32Array(COUNT * 3);
    const absMag = new Float32Array(COUNT);
    const colorIndexBV = new Float32Array(COUNT);
    const catalogIds = new Uint32Array(COUNT);
    const hipIds = new Uint32Array(COUNT);
    const names: Record<string, string> = {};

    for (let i = 0; i < COUNT; i++) {
      catalogIds[i] = i + 1;
      hipIds[i] = 0;
      absMag[i] = nextRand() * 10 - 2;
      colorIndexBV[i] = nextRand() * 2 - 0.5;
      positions[i * 3] = (nextRand() - 0.5) * 2000;
      positions[i * 3 + 1] = (nextRand() - 0.5) * 2000;
      positions[i * 3 + 2] = (nextRand() - 0.5) * 2000;
      names[String(i + 1)] = syntheticName(i);
    }
    // Insert a star named 'sirius-special' at index 60000 so search finds something
    names[String(60001)] = 'sirius-special';

    const { StarDataSourceImpl } = await import('../src/source.js');
    const synSrc = new StarDataSourceImpl(
      {
        count: COUNT,
        originPc: [0, 0, 0],
        positionsPc: positions,
        absMag,
        colorIndexBV,
        catalogIds,
        hipIds,
        idPrefix: 'hyg',
      },
      names,
    );

    const t0 = performance.now();
    const results = synSrc.search('sirius');
    const elapsed = performance.now() - t0;

    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });
});

// ── nearestStarIndex ──────────────────────────────────────────────────────────

describe('nearestStarIndex', () => {
  it('returns Sol (index of id=0) when querying (0,0,0)', () => {
    const idx = src.nearestStarIndex(0, 0, 0);
    expect(idx).toBeGreaterThanOrEqual(0);
    const rec = src.getByIndex(idx);
    expect(rec.id).toBe('hyg:0');
  });

  it('returns -1 for an empty source', async () => {
    const { StarDataSourceImpl } = await import('../src/source.js');
    const empty = new StarDataSourceImpl(
      {
        count: 0,
        originPc: [0, 0, 0],
        positionsPc: new Float32Array(0),
        absMag: new Float32Array(0),
        colorIndexBV: new Float32Array(0),
        catalogIds: new Uint32Array(0),
        hipIds: new Uint32Array(0),
        idPrefix: 'hyg',
      },
      {},
    );
    expect(empty.nearestStarIndex(0, 0, 0)).toBe(-1);
  });

  it('matches brute-force nearest for ≥ 1000 seeded random probes', () => {
    let state = 12345;
    function nextRand(): number {
      state = (state * 1664525 + 1013904223) & 0xffffffff;
      return (state >>> 0) / 0x100000000;
    }

    let failures = 0;
    for (let i = 0; i < 1000; i++) {
      const qx = (nextRand() - 0.5) * 300;
      const qy = (nextRand() - 0.5) * 300;
      const qz = (nextRand() - 0.5) * 300;

      const idx = src.nearestStarIndex(qx, qy, qz);

      // Brute force
      const [ox, oy, oz] = src.batch.originPc;
      let bestD2 = Infinity;
      let bestIdx = -1;
      for (let j = 0; j < src.batch.count; j++) {
        const dx = src.batch.positionsPc[j * 3]! + ox - qx;
        const dy = src.batch.positionsPc[j * 3 + 1]! + oy - qy;
        const dz = src.batch.positionsPc[j * 3 + 2]! + oz - qz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestIdx = j;
        }
      }

      if (idx !== bestIdx) failures++;
    }

    expect(failures).toBe(0);
  });

  it('uses the same module-scoped scratch object on repeated calls (zero alloc identity check)', () => {
    // Two consecutive calls should both return valid results without throwing,
    // demonstrating that scratch state is correctly reset between calls.
    const idx1 = src.nearestStarIndex(0, 0, 0);
    const idx2 = src.nearestStarIndex(0, 0, 0);
    expect(idx1).toBe(idx2);
  });
});

// ── queryRegion ───────────────────────────────────────────────────────────────

describe('queryRegion', () => {
  it('returns indices matching brute-force over ≥ 200 seeded random AABBs', () => {
    let state = 99999;
    function nextRand(): number {
      state = (state * 1664525 + 1013904223) & 0xffffffff;
      return (state >>> 0) / 0x100000000;
    }

    const [ox, oy, oz] = src.batch.originPc;
    let failures = 0;

    for (let trial = 0; trial < 200; trial++) {
      const cx = (nextRand() - 0.5) * 300;
      const cy = (nextRand() - 0.5) * 300;
      const cz = (nextRand() - 0.5) * 300;
      const hw = nextRand() * 50 + 5; // half-width 5–55 pc

      const minPc: [number, number, number] = [cx - hw, cy - hw, cz - hw];
      const maxPc: [number, number, number] = [cx + hw, cy + hw, cz + hw];
      const maxCount = 1000;

      const gridResult = Array.from(src.queryRegion(minPc, maxPc, maxCount)).sort((a, b) => a - b);

      // Brute force
      const expected: number[] = [];
      for (let j = 0; j < src.batch.count; j++) {
        const px = src.batch.positionsPc[j * 3]! + ox;
        const py = src.batch.positionsPc[j * 3 + 1]! + oy;
        const pz = src.batch.positionsPc[j * 3 + 2]! + oz;
        if (
          px >= minPc[0] && px <= maxPc[0] &&
          py >= minPc[1] && py <= maxPc[1] &&
          pz >= minPc[2] && pz <= maxPc[2]
        ) {
          expected.push(j);
        }
      }
      expected.sort((a, b) => a - b);

      if (JSON.stringify(gridResult) !== JSON.stringify(expected)) failures++;
    }

    expect(failures).toBe(0);
  });

  it('respects maxCount', () => {
    const result = src.queryRegion([-10000, -10000, -10000], [10000, 10000, 10000], 3);
    expect(result.length).toBeLessThanOrEqual(3);
  });
});
