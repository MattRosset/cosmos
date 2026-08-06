import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGaiaReverseLookup } from '../src/gaia-reverse-lookup.js';

/**
 * TASK-070 reverse lookup: a real DR3 source_id → the star's absolute galactic-pc position,
 * binary-searched in `gaia-sourceids-index.bin` and read from the on-disk octree tile.
 *
 * Buffers are synthesised in-memory (index + manifest + tile served via a fetch mock) rather
 * than reading `apps/web/public/...`: depending on the web app's asset layout from a
 * packages/data test is cross-package coupling (same discipline as gaia-sourceids.test.ts).
 * The REAL sample-pack round-trip is exercised by the pack-octree test, which owns the sample.
 */

const MANIFEST_URL = 'https://example.test/packs/octree-gaia/octree.json';

const RECORD_BYTES = 16;

interface Rec {
  readonly sourceId: bigint;
  readonly tileId: number;
  readonly indexInTile: number;
}

/** Build the sorted-by-source_id index buffer, mirroring `writeSourceIdIndex`. */
function buildIndex(recs: readonly Rec[]): ArrayBuffer {
  const sorted = [...recs].sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
  const buf = new ArrayBuffer(sorted.length * RECORD_BYTES);
  const dv = new DataView(buf);
  sorted.forEach((r, i) => {
    const o = i * RECORD_BYTES;
    dv.setBigInt64(o, BigInt.asIntN(64, r.sourceId), true);
    dv.setUint32(o + 8, r.tileId, true);
    dv.setUint32(o + 12, r.indexInTile, true);
  });
  return buf;
}

/** Build a single-leaf tile .bin + its manifest buffer descriptors (centre at origin). */
function buildTile(positions: readonly [number, number, number][]): {
  bin: ArrayBuffer;
  buffers: Record<string, { byteOffset: number; byteLength: number }>;
  pointCount: number;
} {
  const n = positions.length;
  const posLen = n * 3 * 4;
  const one = n * 4;
  const posOff = 0;
  const absOff = posOff + posLen;
  const colOff = absOff + one;
  const catOff = colOff + one;
  const hipOff = catOff + one;
  const bin = new ArrayBuffer(hipOff + one);
  const pos = new Float32Array(bin, posOff, n * 3);
  positions.forEach((p, i) => {
    pos[i * 3] = p[0];
    pos[i * 3 + 1] = p[1];
    pos[i * 3 + 2] = p[2];
  });
  return {
    bin,
    pointCount: n,
    buffers: {
      positionsPc: { byteOffset: posOff, byteLength: posLen },
      absMag: { byteOffset: absOff, byteLength: one },
      colorIndexBV: { byteOffset: colOff, byteLength: one },
      catalogIds: { byteOffset: catOff, byteLength: one },
      hipIds: { byteOffset: hipOff, byteLength: one },
    },
  };
}

interface Fixture {
  recs: Rec[];
  positions: [number, number, number][];
}

/** Serve index + manifest + tile. `honorRange` toggles 206 range support vs 200-only. */
function serve(
  fx: Fixture,
  opts: { honorRange: boolean; indexOverride?: ArrayBuffer } = { honorRange: true },
): typeof fetch {
  const tile = buildTile(fx.positions);
  const index = opts.indexOverride ?? buildIndex(fx.recs);
  const manifest = {
    octreeFormatVersion: 1,
    source: 'test',
    context: 'galaxy',
    rootHalfExtentUnits: 65536,
    idPrefix: 'gaia',
    tiles: [
      {
        key: '0/0',
        isLeaf: true,
        childMask: 0,
        pointCount: tile.pointCount,
        centerUnits: [0, 0, 0],
        halfExtentUnits: 65536,
        binUrl: 'tiles/t0.bin',
        contentHashSha256: 'x',
        buffers: tile.buffers,
      },
    ],
  };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/octree.json')) {
      return new Response(JSON.stringify(manifest), { status: 200 });
    }
    if (url.endsWith('/gaia-sourceids-index.bin')) {
      const range = (init?.headers as Record<string, string> | undefined)?.['Range'];
      if (opts.honorRange && range) {
        const m = /bytes=(\d+)-(\d+)/.exec(range);
        const s = Number(m![1]);
        const e = Number(m![2]);
        const slice = index.slice(s, Math.min(e + 1, index.byteLength));
        return new Response(slice, {
          status: 206,
          headers: { 'Content-Range': `bytes ${s}-${e}/${index.byteLength}` },
        });
      }
      return new Response(index.slice(0), { status: 200 });
    }
    if (url.endsWith('/tiles/t0.bin')) {
      return new Response(tile.bin.slice(0), { status: 200 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

// A fixture: 5 stars, ids include one > 2^53 to prove no Number() truncation.
const POSITIONS: [number, number, number][] = [
  [1, 2, 3],
  [-8.5, 18.25, 21.2],
  [100, -50, 7.5],
  [0, 0, 0],
  [-23.8, -23.7, 37.0],
];
const IDS = [
  10000001n,
  4000000000000000137n, // > 2^53
  4000000000000009590n,
  12345678901234567n,
  4000000000000019591n,
];
const FIXTURE: Fixture = {
  positions: POSITIONS,
  recs: IDS.map((sourceId, i) => ({ sourceId, tileId: 0, indexInTile: i })),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadGaiaReverseLookup — resolve (range mode)', () => {
  it('resolves each known source_id to its exact position (binary search, 206 ranges)', async () => {
    const lookup = loadGaiaReverseLookup(MANIFEST_URL, { fetchImpl: serve(FIXTURE, { honorRange: true }) });
    for (let i = 0; i < IDS.length; i++) {
      const hit = await lookup.resolve(IDS[i]!);
      expect(hit).not.toBeNull();
      expect(hit!.sourceId).toBe(IDS[i]!); // bigint echoed exactly, incl. > 2^53
      expect(hit!.positionPc[0]).toBeCloseTo(POSITIONS[i]![0], 4);
      expect(hit!.positionPc[1]).toBeCloseTo(POSITIONS[i]![1], 4);
      expect(hit!.positionPc[2]).toBeCloseTo(POSITIONS[i]![2], 4);
    }
  });

  it('an id > 2^53 round-trips exactly as bigint', async () => {
    const lookup = loadGaiaReverseLookup(MANIFEST_URL, { fetchImpl: serve(FIXTURE, { honorRange: true }) });
    const hit = await lookup.resolve(4000000000000000137n);
    expect(hit?.sourceId.toString()).toBe('4000000000000000137');
  });

  it('an absent id resolves to null (miss)', async () => {
    const lookup = loadGaiaReverseLookup(MANIFEST_URL, { fetchImpl: serve(FIXTURE, { honorRange: true }) });
    expect(await lookup.resolve(999999999999999999n)).toBeNull();
    // Below the smallest and above the largest — both null.
    expect(await lookup.resolve(1n)).toBeNull();
    expect(await lookup.resolve(9000000000000000000n)).toBeNull();
  });
});

describe('loadGaiaReverseLookup — resolve (full-fetch fallback, no range support)', () => {
  it('resolves via a single full fetch when the server answers 200', async () => {
    const lookup = loadGaiaReverseLookup(MANIFEST_URL, { fetchImpl: serve(FIXTURE, { honorRange: false }) });
    const hit = await lookup.resolve(4000000000000009590n);
    expect(hit).not.toBeNull();
    expect(hit!.positionPc[0]).toBeCloseTo(100, 4);
    expect(await lookup.resolve(42n)).toBeNull();
  });

  it('a truncated index (length not a multiple of 16) warns once and serves whole records', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const full = buildIndex(FIXTURE.recs);
    const truncated = full.slice(0, full.byteLength - 4); // drop 4 trailing bytes
    const lookup = loadGaiaReverseLookup(MANIFEST_URL, {
      fetchImpl: serve(FIXTURE, { honorRange: false, indexOverride: truncated }),
    });
    // The first 4 records are intact and still resolvable.
    const hit = await lookup.resolve(10000001n);
    expect(hit).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('loadGaiaReverseLookup — degrade paths', () => {
  it('a 404 index → every resolve null, warns once, never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = (async () => new Response(null, { status: 404 })) as typeof fetch;
    const lookup = loadGaiaReverseLookup(MANIFEST_URL, { fetchImpl });
    expect(await lookup.resolve(10000001n)).toBeNull();
    expect(await lookup.resolve(4000000000000000137n)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a rejected fetch (network error) → null, warns once, no reject', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const lookup = loadGaiaReverseLookup(MANIFEST_URL, { fetchImpl });
    await expect(lookup.resolve(10000001n)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a hit whose tile fails to fetch resolves to null (no throw)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Serve index + manifest, but 404 the tile bin.
    const base = serve(FIXTURE, { honorRange: true });
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/tiles/t0.bin')) return new Response(null, { status: 404 });
      return base(input, init);
    }) as typeof fetch;
    const lookup = loadGaiaReverseLookup(MANIFEST_URL, { fetchImpl });
    expect(await lookup.resolve(10000001n)).toBeNull();
    warn.mockRestore();
  });

  it('a hit with indexInTile out of the tile range resolves to null', async () => {
    // One record pointing past the (single-point) tile's bounds.
    const fx: Fixture = { positions: [[1, 1, 1]], recs: [{ sourceId: 7n, tileId: 0, indexInTile: 5 }] };
    const lookup = loadGaiaReverseLookup(MANIFEST_URL, { fetchImpl: serve(fx, { honorRange: false }) });
    expect(await lookup.resolve(7n)).toBeNull();
  });

  it('a hit with a tileId absent from the manifest resolves to null', async () => {
    const fx: Fixture = { positions: [[1, 1, 1]], recs: [{ sourceId: 7n, tileId: 9, indexInTile: 0 }] };
    const lookup = loadGaiaReverseLookup(MANIFEST_URL, { fetchImpl: serve(fx, { honorRange: false }) });
    expect(await lookup.resolve(7n)).toBeNull();
  });
});
