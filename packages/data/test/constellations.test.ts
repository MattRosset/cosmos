import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { PackFormatError, loadStarPack } from '../src/index.js';
import {
  createConstellationSource,
  labelCandidates,
  loadConstellationPack,
} from '../src/constellations.js';
import type { StarDataSource } from '../src/index.js';
import { buildFixturePack, makeFileFetch } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const fetchImpl = makeFileFetch();

function fixtureUrl(name: string): string {
  return `file:///${join(FIXTURES, name).replace(/\\/g, '/')}`;
}

const constellationsUrl = fixtureUrl('constellations-mini.json');

let stars: StarDataSource;

beforeAll(async () => {
  const packDir = buildFixturePack();
  const manifestUrl = `file:///${packDir.replace(/\\/g, '/')}/manifest.json`;
  stars = await loadStarPack(manifestUrl, { fetchImpl: makeFileFetch() });
});

describe('loadConstellationPack', () => {
  it('loads a fixture pack', async () => {
    const pack = await loadConstellationPack(constellationsUrl, { fetchImpl });
    expect(pack.packFormatVersion).toBe(1);
    expect(pack.constellations).toHaveLength(1);
    expect(pack.constellations[0]!.code).toBe('Tst');
  });

  it('rejects a wrong packFormatVersion', async () => {
    const badFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ packFormatVersion: 999, source: 'x', constellations: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    await expect(loadConstellationPack('file:///bad.json', { fetchImpl: badFetch })).rejects.toThrow(
      PackFormatError,
    );
  });
});

describe('createConstellationSource', () => {
  it('resolves a 2-segment fixture, dropping the pair with a missing HIP', async () => {
    const pack = await loadConstellationPack(constellationsUrl, { fetchImpl });
    const source = createConstellationSource(pack, stars);

    const segs = source.segmentsPc();
    expect(segs).toBeInstanceOf(Float64Array);
    expect(segs.length).toBe(12);

    const idxSirius = stars.hipIndex(32349)!;
    const idxVega = stars.hipIndex(91262)!;
    const idxRigil = stars.hipIndex(71683)!;
    const sirius = stars.positionPcByIndex(idxSirius);
    const vega = stars.positionPcByIndex(idxVega);
    const rigil = stars.positionPcByIndex(idxRigil);

    expect(Array.from(segs.slice(0, 6))).toEqual([...sirius, ...vega]);
    expect(Array.from(segs.slice(6, 12))).toEqual([...rigil, ...sirius]);

    expect(source.segmentCodes()).toEqual(['Tst', 'Tst']);
    expect(source.segmentCodes().length).toBe(segs.length / 6);
  });

  it('returns the same array identity on repeated calls', async () => {
    const pack = await loadConstellationPack(constellationsUrl, { fetchImpl });
    const source = createConstellationSource(pack, stars);
    expect(source.segmentsPc()).toBe(source.segmentsPc());
  });
});

describe('labelCandidates', () => {
  it('returns named bodies ranked by priority (brightest first), capped at max', () => {
    const candidates = labelCandidates(stars, { max: 2 });
    expect(candidates).toHaveLength(2);
    for (const c of candidates) {
      expect(c.text).toBeTruthy();
      expect(c.positionPc).toHaveLength(3);
    }
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i]!.priority).toBeGreaterThanOrEqual(candidates[i - 1]!.priority);
    }
  });
});
