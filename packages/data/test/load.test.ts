import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { StarPackManifest } from '@cosmos/core-types';
import { STAR_PACK_FORMAT_VERSION } from '@cosmos/core-types';
import { loadStarPack, PackFormatError } from '../src/index.js';
import { buildFixturePack, makeFileFetch } from './helpers.js';

let packDir: string;
let manifestUrl: string;
let fetchImpl: typeof fetch;

beforeAll(() => {
  packDir = buildFixturePack();
  manifestUrl = `file:///${packDir.replace(/\\/g, '/')}/manifest.json`;
  fetchImpl = makeFileFetch();
});

describe('loadStarPack — round-trip', () => {
  it('loads without error and returns a StarDataSource', async () => {
    const src = await loadStarPack(manifestUrl, { fetchImpl });
    expect(src).toBeDefined();
  });

  it('batch.count equals fixture CSV kept-star count (7)', async () => {
    const src = await loadStarPack(manifestUrl, { fetchImpl });
    expect(src.batch.count).toBe(7);
  });

  it('batch.idPrefix is "hyg"', async () => {
    const src = await loadStarPack(manifestUrl, { fetchImpl });
    expect(src.batch.idPrefix).toBe('hyg');
  });

  it('batch.originPc is [0, 0, 0]', async () => {
    const src = await loadStarPack(manifestUrl, { fetchImpl });
    expect(Array.from(src.batch.originPc)).toEqual([0, 0, 0]);
  });

  it('catalogIds and hipIds arrays have the correct length', async () => {
    const src = await loadStarPack(manifestUrl, { fetchImpl });
    expect(src.batch.catalogIds.length).toBe(7);
    expect(src.batch.hipIds.length).toBe(7);
  });

  it('absolute positions are within f32 tolerance of expected distances', async () => {
    const src = await loadStarPack(manifestUrl, { fetchImpl });
    // Sirius (catalogId=2) is at ~2.64 pc
    const sirius = src.getBody('hyg:2');
    expect(sirius).not.toBeNull();
    const dist = Math.hypot(...(sirius!.positionPc as [number, number, number]));
    expect(Math.abs(dist - 2.6371) / 2.6371).toBeLessThan(0.001);
  });

  it('names round-trip: Sirius name is "Sirius"', async () => {
    const src = await loadStarPack(manifestUrl, { fetchImpl });
    const sirius = src.getBody('hyg:2');
    expect(sirius?.name).toBe('Sirius');
  });

  it('unnamed star (id=5) has name=undefined', async () => {
    const src = await loadStarPack(manifestUrl, { fetchImpl });
    const unnamed = src.getBody('hyg:5');
    expect(unnamed?.name).toBeUndefined();
  });
});

describe('loadStarPack — version guard', () => {
  it('rejects with PackFormatError when packFormatVersion !== expected', async () => {
    const badManifest: StarPackManifest = {
      ...(JSON.parse(
        readFileSync(join(packDir, 'manifest.json'), 'utf8'),
      ) as StarPackManifest),
      packFormatVersion: 2 as typeof STAR_PACK_FORMAT_VERSION,
    };

    const badFetch: typeof fetch = async input => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href.endsWith('manifest.json')) {
        return new Response(JSON.stringify(badManifest), { status: 200 });
      }
      return fetchImpl(input);
    };

    await expect(loadStarPack(manifestUrl, { fetchImpl: badFetch })).rejects.toBeInstanceOf(
      PackFormatError,
    );
  });
});

describe('loadStarPack — hash guard', () => {
  it('rejects with PackFormatError when the bin has a corrupted byte', async () => {
    const manifest: StarPackManifest = JSON.parse(
      readFileSync(join(packDir, 'manifest.json'), 'utf8'),
    ) as StarPackManifest;
    const binPath = join(packDir, manifest.binUrl);

    const corruptFetch: typeof fetch = async input => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href.endsWith('.bin')) {
        const buf = readFileSync(binPath);
        // flip one byte
        buf[0] = buf[0]! ^ 0xff;
        return new Response(buf.buffer as ArrayBuffer, { status: 200 });
      }
      return fetchImpl(input);
    };

    await expect(loadStarPack(manifestUrl, { fetchImpl: corruptFetch })).rejects.toBeInstanceOf(
      PackFormatError,
    );
  });
});
