import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SystemsPackManifest } from '@cosmos/core-types';
import { SYSTEMS_PACK_FORMAT_VERSION } from '@cosmos/core-types';
import { loadSystemsPack, SystemsPackFormatError } from '../src/index.js';
import { makeFileFetch } from './helpers.js';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const fetchImpl = makeFileFetch();

function fixtureUrl(name: string): string {
  return `file:///${join(FIXTURES, name).replace(/\\/g, '/')}`;
}

const exoUrl = fixtureUrl('systems-exo-fixture.json');
const solUrl = fixtureUrl('systems-sol-fixture.json');

describe('loadSystemsPack — round-trip (exo fixture)', () => {
  it('loads without error', async () => {
    const src = await loadSystemsPack(exoUrl, { fetchImpl });
    expect(src).toBeDefined();
    expect(src.systems.length).toBe(3);
  });

  it('getSystem resolves by system id', async () => {
    const src = await loadSystemsPack(exoUrl, { fetchImpl });
    const sys = src.getSystem('exo:trappist-1');
    expect(sys).toBeDefined();
    expect(sys!.name).toBe('TRAPPIST-1');
  });

  it('getSystem returns undefined for unknown id', async () => {
    const src = await loadSystemsPack(exoUrl, { fetchImpl });
    expect(src.getSystem('exo:unknown')).toBeUndefined();
  });

  it('getBody returns host star by star id', async () => {
    const src = await loadSystemsPack(exoUrl, { fetchImpl });
    const body = src.getBody('exo:trappist-1');
    expect(body).toBeDefined();
    expect(body!.kind).toBe('star');
    expect((body as { name?: string }).name).toBe('TRAPPIST-1');
  });

  it('getBody returns planet by body id', async () => {
    const src = await loadSystemsPack(exoUrl, { fetchImpl });
    const body = src.getBody('exo:trappist-1:e');
    expect(body).toBeDefined();
    expect(body!.kind).toBe('planet');
    expect((body as { name?: string }).name).toBe('TRAPPIST-1 e');
  });

  it('getBody returns undefined for unknown id', async () => {
    const src = await loadSystemsPack(exoUrl, { fetchImpl });
    expect(src.getBody('exo:nobody')).toBeUndefined();
  });

  it('systemOfBody resolves host star', async () => {
    const src = await loadSystemsPack(exoUrl, { fetchImpl });
    const sys = src.systemOfBody('exo:trappist-1');
    expect(sys).toBeDefined();
    expect(sys!.id).toBe('exo:trappist-1');
  });

  it('systemOfBody resolves planet', async () => {
    const src = await loadSystemsPack(exoUrl, { fetchImpl });
    const sys = src.systemOfBody('exo:trappist-1:e');
    expect(sys).toBeDefined();
    expect(sys!.id).toBe('exo:trappist-1');
  });

  it('systemOfBody returns undefined for unknown id', async () => {
    const src = await loadSystemsPack(exoUrl, { fetchImpl });
    expect(src.systemOfBody('exo:nobody')).toBeUndefined();
  });
});

describe('loadSystemsPack — sol fixture (star id differs from system id)', () => {
  it('getBody resolves sol host star by star id "hyg:0"', async () => {
    const src = await loadSystemsPack(solUrl, { fetchImpl });
    const body = src.getBody('hyg:0');
    expect(body).toBeDefined();
    expect(body!.kind).toBe('star');
  });

  it('getBody resolves sol planet', async () => {
    const src = await loadSystemsPack(solUrl, { fetchImpl });
    const body = src.getBody('sol:earth');
    expect(body).toBeDefined();
    expect(body!.kind).toBe('planet');
  });

  it('systemOfBody("hyg:0") returns sol system', async () => {
    const src = await loadSystemsPack(solUrl, { fetchImpl });
    const sys = src.systemOfBody('hyg:0');
    expect(sys).toBeDefined();
    expect(sys!.id).toBe('sol');
  });
});

describe('loadSystemsPack — version guard', () => {
  it('rejects wrong packFormatVersion with SystemsPackFormatError', async () => {
    const badManifest = {
      packFormatVersion: 99 as typeof SYSTEMS_PACK_FORMAT_VERSION,
      source: 'test',
      generatedAtIso: '2026-01-01T00:00:00.000Z',
      systems: [],
    } satisfies SystemsPackManifest;

    const badFetch: typeof fetch = async () =>
      new Response(JSON.stringify(badManifest), { status: 200 });

    await expect(
      loadSystemsPack('http://test/manifest.json', { fetchImpl: badFetch }),
    ).rejects.toBeInstanceOf(SystemsPackFormatError);
  });
});

describe('loadSystemsPack — schema validation', () => {
  it('rejects a planet with eccentricity >= 1 with SystemsPackFormatError', async () => {
    const badManifest: SystemsPackManifest = {
      packFormatVersion: SYSTEMS_PACK_FORMAT_VERSION,
      source: 'test',
      generatedAtIso: '2026-01-01T00:00:00.000Z',
      systems: [
        {
          id: 'exo:bad',
          name: 'Bad',
          star: {
            id: 'exo:bad',
            kind: 'star',
            positionPc: [0, 0, 0],
            absMag: 5,
            colorIndexBV: 0.5,
          },
          bodies: [
            {
              id: 'exo:bad:p',
              kind: 'planet',
              parentId: 'exo:bad',
              radiusKm: 6371,
              elements: {
                semiMajorAxisAu: 1,
                eccentricity: 1.0,
                inclinationRad: 0,
                ascendingNodeLongitudeRad: 0,
                argumentOfPeriapsisRad: 0,
                meanAnomalyAtEpochRad: 0,
                epochJD: 2451545,
                muKm3S2: 1.327e11,
              },
            },
          ],
        },
      ],
    };

    const badFetch: typeof fetch = async () =>
      new Response(JSON.stringify(badManifest), { status: 200 });

    await expect(
      loadSystemsPack('http://test/manifest.json', { fetchImpl: badFetch }),
    ).rejects.toBeInstanceOf(SystemsPackFormatError);
  });

  it('accepts a planet without elements (elements field absent)', async () => {
    const manifest: SystemsPackManifest = {
      packFormatVersion: SYSTEMS_PACK_FORMAT_VERSION,
      source: 'test',
      generatedAtIso: '2026-01-01T00:00:00.000Z',
      systems: [
        {
          id: 'exo:ok',
          name: 'Ok',
          star: {
            id: 'exo:ok',
            kind: 'star',
            positionPc: [0, 0, 0],
            absMag: 5,
            colorIndexBV: 0.5,
          },
          bodies: [
            {
              id: 'exo:ok:p',
              kind: 'planet',
              parentId: 'exo:ok',
              radiusKm: 6371,
            },
          ],
        },
      ],
    };

    const goodFetch: typeof fetch = async () =>
      new Response(JSON.stringify(manifest), { status: 200 });

    await expect(
      loadSystemsPack('http://test/manifest.json', { fetchImpl: goodFetch }),
    ).resolves.toBeDefined();
  });
});
