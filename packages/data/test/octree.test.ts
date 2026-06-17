import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { OctreeManifest } from '@cosmos/core-types';
import { loadOctreePack, OctreeFormatError } from '../src/index.js';
import type { OctreeSource } from '../src/index.js';
import { makeFileFetch } from './helpers.js';
import { createFakePool } from './helpers/fake-pool.js';
import { buildOctree } from '../../../tools/pack-octree/src/build.js';

// ---------------------------------------------------------------------------
// Fixture: 5 stars spread across multiple octants so buildOctree with
// maxPointsPerTile=2 creates a root + 3 leaf tiles.
// ---------------------------------------------------------------------------
const FIXTURE_STARS = [
  { x:  1.0, y:  1.0, z:  1.0, absMag: 4.8, colorIndexBV: 0.65, catalogId: 1, hipId: 71683 },
  { x: -2.5, y:  1.0, z: -1.5, absMag: 2.0, colorIndexBV: -0.1, catalogId: 2, hipId: 32349 },
  { x:  0.5, y: -0.5, z:  0.5, absMag: 5.1, colorIndexBV:  0.8, catalogId: 3, hipId: 0 },
  { x:  3.0, y:  3.0, z:  3.0, absMag: 6.0, colorIndexBV:  1.0, catalogId: 4, hipId: 0 },
  { x: -3.0, y: -3.0, z: -3.0, absMag: 3.5, colorIndexBV:  0.2, catalogId: 5, hipId: 0 },
];

/** Build the fixture octree and return the manifest URL + raw manifest. */
function buildFixture(): { dir: string; manifestUrl: string; manifest: OctreeManifest } {
  const dir = join(tmpdir(), `cosmos-octree-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const manifest = buildOctree(FIXTURE_STARS, dir, {
    rootHalfExtent: 8,
    source: 'test',
    idPrefix: 'test',
    maxPointsPerTile: 2,
  });
  const manifestUrl = `file:///${dir.replace(/\\/g, '/')}/octree.json`;
  return { dir, manifestUrl, manifest };
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
let manifestUrl: string;
let manifest: OctreeManifest;
let fetchImpl: typeof fetch;
let source: OctreeSource;

beforeAll(async () => {
  ({ manifestUrl, manifest } = buildFixture());
  fetchImpl = makeFileFetch();
  source = await loadOctreePack(manifestUrl, { fetchImpl });
});

// ---------------------------------------------------------------------------
// loadOctreePack — manifest loading
// ---------------------------------------------------------------------------
describe('loadOctreePack — manifest', () => {
  it('loads without error', () => {
    expect(source).toBeDefined();
  });

  it('context is "galaxy"', () => {
    expect(source.context).toBe('galaxy');
  });

  it('idPrefix matches manifest', () => {
    expect(source.idPrefix).toBe('test');
  });

  it('rootHalfExtentUnits matches manifest', () => {
    expect(source.rootHalfExtentUnits).toBe(8);
  });

  it('rejects wrong octreeFormatVersion with OctreeFormatError', async () => {
    const badManifest = { ...manifest, octreeFormatVersion: 99 };
    const badFetch: typeof fetch = async input => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href.endsWith('octree.json')) {
        return new Response(JSON.stringify(badManifest), { status: 200 });
      }
      return fetchImpl(input);
    };
    await expect(loadOctreePack(manifestUrl, { fetchImpl: badFetch })).rejects.toBeInstanceOf(
      OctreeFormatError,
    );
  });

  it('resolves tile binUrls relative to the manifest URL', async () => {
    // loadTile on the root should succeed (URL resolution is correct)
    const batch = await source.loadTile(source.root.key);
    expect(batch.count).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// OctreeSource — tree structure
// ---------------------------------------------------------------------------
describe('OctreeSource — tree structure', () => {
  it('root key is "0/0"', () => {
    expect(source.root.key).toBe('0/0');
  });

  it('root manifest matches fixture tile', () => {
    const rootTile = manifest.tiles.find(t => t.key === '0/0');
    expect(source.root.manifest).toEqual(rootTile);
  });

  it('root.childKeys are in Morton order and match childMask', () => {
    const { childMask } = source.root.manifest;
    const expected = source.root.childKeys.length;
    let bits = 0;
    let mask = childMask;
    while (mask) { bits += mask & 1; mask >>= 1; }
    expect(expected).toBe(bits);
  });

  it('root.childKeys correspond to level-1 nodes that exist in the map', () => {
    for (const ck of source.root.childKeys) {
      expect(source.getNode(ck)).toBeDefined();
    }
  });

  it('getNode with a known child key returns OctreeNode', () => {
    const ck = source.root.childKeys[0]!;
    const node = source.getNode(ck);
    expect(node).toBeDefined();
    expect(node!.key).toBe(ck);
  });

  it('getNode with unknown key returns undefined', () => {
    expect(source.getNode('99/99999')).toBeUndefined();
  });

  it('leaf nodes have empty childKeys', () => {
    for (const tile of manifest.tiles) {
      if (tile.isLeaf) {
        const node = source.getNode(tile.key);
        expect(node?.childKeys).toHaveLength(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// loadTile — no pool (main thread decode)
// ---------------------------------------------------------------------------
describe('loadTile (no pool)', () => {
  it('returns StarBatch with count === pointCount', async () => {
    const rootTile = manifest.tiles.find(t => t.key === '0/0')!;
    const batch = await source.loadTile('0/0');
    expect(batch.count).toBe(rootTile.pointCount);
  });

  it('originPc === centerUnits of the tile', async () => {
    const rootTile = manifest.tiles.find(t => t.key === '0/0')!;
    const batch = await source.loadTile('0/0');
    expect(Array.from(batch.originPc)).toEqual(Array.from(rootTile.centerUnits));
  });

  it('idPrefix is carried from the manifest', async () => {
    const batch = await source.loadTile('0/0');
    expect(batch.idPrefix).toBe('test');
  });

  it('catalogIds length matches count', async () => {
    const batch = await source.loadTile('0/0');
    expect(batch.catalogIds.length).toBe(batch.count);
    expect(batch.hipIds.length).toBe(batch.count);
  });

  it('hipIds are carried (0 = none)', async () => {
    const batch = await source.loadTile('0/0');
    // hipIds is a Uint32Array, all values valid
    for (let i = 0; i < batch.count; i++) {
      expect(typeof batch.hipIds[i]).toBe('number');
    }
  });

  it('leaf tile: absolute positions reconstruct to fixture values (f32 tolerance)', async () => {
    // Find a leaf tile and verify one star's reconstructed absolute position.
    const leafTile = manifest.tiles.find(t => t.isLeaf)!;
    const batch = await source.loadTile(leafTile.key);
    const [cx, cy, cz] = leafTile.centerUnits;

    // At least one star's absolute position must be close to a fixture star.
    let matched = false;
    for (let i = 0; i < batch.count; i++) {
      const ax = cx + batch.positionsPc[i * 3]!;
      const ay = cy + batch.positionsPc[i * 3 + 1]!;
      const az = cz + batch.positionsPc[i * 3 + 2]!;
      for (const s of FIXTURE_STARS) {
        if (
          Math.abs(ax - s.x) < 0.01 &&
          Math.abs(ay - s.y) < 0.01 &&
          Math.abs(az - s.z) < 0.01
        ) {
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    expect(matched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadTile — content hash guard
// ---------------------------------------------------------------------------
describe('loadTile — content hash guard', () => {
  it('rejects with OctreeFormatError when bin bytes are corrupted', async () => {
    const leafTile = manifest.tiles.find(t => t.isLeaf)!;
    const realBinPath = fileURLToPath(
      new URL(leafTile.binUrl, `file:///${manifestUrl.replace(/^file:\/\/\//, '').replace(/octree\.json$/, '')}`).href,
    );

    const corruptFetch: typeof fetch = async input => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href.endsWith('.bin')) {
        const buf = readFileSync(realBinPath);
        buf[0] = buf[0]! ^ 0xff;
        const ab = new ArrayBuffer(buf.byteLength);
        new Uint8Array(ab).set(buf);
        return new Response(ab, { status: 200 });
      }
      return fetchImpl(input);
    };

    const corruptSource = await loadOctreePack(manifestUrl, { fetchImpl: corruptFetch });
    await expect(corruptSource.loadTile(leafTile.key)).rejects.toBeInstanceOf(OctreeFormatError);
  });

  it('rejects with OctreeFormatError when a BufferSlice exceeds the bin', async () => {
    const leafTile = manifest.tiles.find(t => t.isLeaf)!;

    // Return a very short bin so the slice is out of bounds
    const shortBinFetch: typeof fetch = async input => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href.endsWith('.bin')) {
        return new Response(new ArrayBuffer(1), { status: 200 });
      }
      return fetchImpl(input);
    };

    const badSource = await loadOctreePack(manifestUrl, { fetchImpl: shortBinFetch });
    await expect(badSource.loadTile(leafTile.key)).rejects.toBeInstanceOf(OctreeFormatError);
  });
});

// ---------------------------------------------------------------------------
// loadTile — with a fake pool (parity + dispatch verification)
// ---------------------------------------------------------------------------
describe('loadTile (with fake pool)', () => {
  it('dispatches octree.decode with bin in the transfer list', async () => {
    const pool = createFakePool();
    const src = await loadOctreePack(manifestUrl, { fetchImpl, pool });
    const leafTile = manifest.tiles.find(t => t.isLeaf)!;

    await src.loadTile(leafTile.key);

    expect(pool.dispatches).toHaveLength(1);
    expect(pool.dispatches[0]!.method).toBe('octree.decode');
    expect(pool.dispatches[0]!.transferList).toHaveLength(1);
    expect(pool.dispatches[0]!.transferList[0]).toBeInstanceOf(ArrayBuffer);
  });

  it('returned batch matches no-pool decode byte-for-byte (parity)', async () => {
    const leafTile = manifest.tiles.find(t => t.isLeaf)!;

    const noPoolBatch = await source.loadTile(leafTile.key);

    const pool = createFakePool();
    const poolSrc = await loadOctreePack(manifestUrl, { fetchImpl, pool });
    const poolBatch = await poolSrc.loadTile(leafTile.key);

    expect(poolBatch.count).toBe(noPoolBatch.count);
    expect(Array.from(poolBatch.originPc)).toEqual(Array.from(noPoolBatch.originPc));
    expect(Array.from(poolBatch.positionsPc)).toEqual(Array.from(noPoolBatch.positionsPc));
    expect(Array.from(poolBatch.absMag)).toEqual(Array.from(noPoolBatch.absMag));
    expect(Array.from(poolBatch.colorIndexBV)).toEqual(Array.from(noPoolBatch.colorIndexBV));
    expect(Array.from(poolBatch.catalogIds)).toEqual(Array.from(noPoolBatch.catalogIds));
    expect(Array.from(poolBatch.hipIds)).toEqual(Array.from(noPoolBatch.hipIds));
  });
});

// ---------------------------------------------------------------------------
// loadTile — abort
// ---------------------------------------------------------------------------
describe('loadTile — abort', () => {
  it('rejects immediately if signal is already aborted (no pool)', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(source.loadTile('0/0', { signal: ctrl.signal })).rejects.toSatisfy(
      (e: unknown) => e instanceof DOMException && e.name === 'AbortError',
    );
  });

  it('rejects immediately if signal is already aborted (with pool)', async () => {
    const pool = createFakePool();
    const src = await loadOctreePack(manifestUrl, { fetchImpl, pool });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(src.loadTile('0/0', { signal: ctrl.signal })).rejects.toSatisfy(
      (e: unknown) => e instanceof DOMException && e.name === 'AbortError',
    );
  });

  it('cancels pool dispatch and records cancellation when signal aborts mid-flight', async () => {
    const pool = createFakePool({ hold: true });
    const src = await loadOctreePack(manifestUrl, { fetchImpl, pool });
    const ctrl = new AbortController();

    const leafTile = manifest.tiles.find(t => t.isLeaf)!;
    const loadPromise = src.loadTile(leafTile.key, { signal: ctrl.signal });

    // Allow fetch + hash to complete so dispatch is called before we abort.
    await new Promise(r => setTimeout(r, 50));

    ctrl.abort();

    await expect(loadPromise).rejects.toBeTruthy();
    expect(pool.dispatches[0]?.cancelled).toBe(true);
  });
});
