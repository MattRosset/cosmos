import { describe, expect, it, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  OCTREE_FORMAT_VERSION,
  encodeMortonKey,
  decodeMortonKey,
  childCell,
} from '@cosmos/core-types';
import type { OctreeManifest, StarPackManifest } from '@cosmos/core-types';
import { buildOctree } from '../src/build';
import type { StarData, BuildOptions } from '../src/build';
import { OctreeManifestSchema } from '../src/schema';

// ---------------------------------------------------------------------------
// Fixture: 24 stars, 3 per octant, with unique absMag for stable sort checks.
// ---------------------------------------------------------------------------

const FIXTURE_STARS: StarData[] = [];
for (let oct = 0; oct < 8; oct++) {
  const sx = (oct & 1) ? 1 : -1;
  const sy = ((oct >> 1) & 1) ? 1 : -1;
  const sz = ((oct >> 2) & 1) ? 1 : -1;
  for (let i = 0; i < 3; i++) {
    FIXTURE_STARS.push({
      x: sx * (100 + i * 10),
      y: sy * (200 + i * 10),
      z: sz * (300 + i * 10),
      absMag: oct * 3 + i + 1, // 1..24, unique
      colorIndexBV: 0.5,
      catalogId: oct * 100 + i + 1,
      hipId: oct * 10 + i + 1,
    });
  }
}

// Force a split at the root (24 > 5) but not in children (3 ≤ 5).
const SMALL_OPTS: BuildOptions = {
  rootHalfExtent: 1024,
  source: 'test-mini',
  idPrefix: 'test',
  maxPointsPerTile: 5,
  maxTileBytes: 5 * 28,
  internalTilePoints: 2,
};

/** Create a StarPackManifest + .bin from star data for CLI-path tests. */
function makeStarPack(stars: StarData[], dir: string): string {
  const N = stars.length;
  const posByteLen = N * 3 * 4;
  const absByteLen = N * 4;
  const colorByteLen = N * 4;
  const catByteLen = N * 4;
  const hipByteLen = N * 4;

  const posOff = 0;
  const absOff = posOff + posByteLen;
  const colorOff = absOff + absByteLen;
  const catOff = colorOff + colorByteLen;
  const hipOff = catOff + catByteLen;

  const buf = new ArrayBuffer(hipOff + hipByteLen);
  const pos = new Float32Array(buf, posOff, N * 3);
  const abs = new Float32Array(buf, absOff, N);
  const col = new Float32Array(buf, colorOff, N);
  const cat = new Uint32Array(buf, catOff, N);
  const hip = new Uint32Array(buf, hipOff, N);

  for (let i = 0; i < N; i++) {
    const s = stars[i]!;
    pos[i * 3] = s.x; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z;
    abs[i] = s.absMag;
    col[i] = s.colorIndexBV;
    cat[i] = s.catalogId;
    hip[i] = s.hipId;
  }

  const binData = Buffer.from(buf);
  const hash = createHash('sha256').update(binData).digest('hex');
  const binName = `stars.${hash.slice(0, 8)}.bin`;

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, binName), binData);
  writeFileSync(join(dir, 'names.json'), '{}\n');

  const sm: StarPackManifest = {
    packFormatVersion: 1,
    source: 'test-mini',
    contentHashSha256: hash,
    count: N,
    binUrl: binName,
    namesUrl: 'names.json',
    originPc: [0, 0, 0],
    buffers: {
      positionsPc: { byteOffset: posOff, byteLength: posByteLen },
      absMag: { byteOffset: absOff, byteLength: absByteLen },
      colorIndexBV: { byteOffset: colorOff, byteLength: colorByteLen },
      catalogIds: { byteOffset: catOff, byteLength: catByteLen },
      hipIds: { byteOffset: hipOff, byteLength: hipByteLen },
    },
  };

  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(sm, null, 2) + '\n');
  return manifestPath;
}

function tmpDir(tag: string) {
  return join(tmpdir(), `cosmos-octree-${tag}-${Date.now()}`);
}

// ---------------------------------------------------------------------------
// Shared build result (built once before all tests)
// ---------------------------------------------------------------------------

let outDir: string;
let manifest: OctreeManifest;

beforeAll(() => {
  outDir = tmpDir('main');
  manifest = buildOctree(FIXTURE_STARS, outDir, SMALL_OPTS);
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe('schema', () => {
  it('emitted manifest validates against OctreeManifestSchema', () => {
    const r = OctreeManifestSchema.safeParse(manifest);
    expect(r.success).toBe(true);
  });

  it('octreeFormatVersion === OCTREE_FORMAT_VERSION', () => {
    expect(manifest.octreeFormatVersion).toBe(OCTREE_FORMAT_VERSION);
  });

  it('corrupted tile byte-length fails validation', () => {
    const corrupted = {
      ...manifest,
      tiles: manifest.tiles.map((t) =>
        t.isLeaf
          ? {
              ...t,
              buffers: {
                ...t.buffers,
                // Force total bytes above MAX_TILE_BYTES
                positionsPc: { byteOffset: 0, byteLength: 600 * 1024 },
              },
            }
          : t,
      ),
    };
    expect(OctreeManifestSchema.safeParse(corrupted).success).toBe(false);
  });

  it('leaf with non-zero childMask fails validation', () => {
    const corrupted = {
      ...manifest,
      tiles: manifest.tiles.map((t) =>
        t.isLeaf ? { ...t, childMask: 1 } : t,
      ),
    };
    expect(OctreeManifestSchema.safeParse(corrupted).success).toBe(false);
  });

  it('internal node with zero childMask fails validation', () => {
    const corrupted = {
      ...manifest,
      tiles: manifest.tiles.map((t) =>
        !t.isLeaf ? { ...t, childMask: 0 } : t,
      ),
    };
    expect(OctreeManifestSchema.safeParse(corrupted).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('two independent builds produce identical octree.json', () => {
    const d1 = tmpDir('det1');
    const d2 = tmpDir('det2');
    buildOctree(FIXTURE_STARS, d1, SMALL_OPTS);
    buildOctree(FIXTURE_STARS, d2, SMALL_OPTS);
    const j1 = readFileSync(join(d1, 'octree.json'), 'utf8');
    const j2 = readFileSync(join(d2, 'octree.json'), 'utf8');
    expect(j1).toBe(j2);
  });

  it('two independent builds produce identical tile SHA-256 hashes', () => {
    const d1 = tmpDir('det3');
    const d2 = tmpDir('det4');
    const m1 = buildOctree(FIXTURE_STARS, d1, SMALL_OPTS);
    const m2 = buildOctree(FIXTURE_STARS, d2, SMALL_OPTS);
    for (let i = 0; i < m1.tiles.length; i++) {
      expect(m1.tiles[i]!.contentHashSha256).toBe(m2.tiles[i]!.contentHashSha256);
    }
  });
});

// ---------------------------------------------------------------------------
// Tiling correctness
// ---------------------------------------------------------------------------

describe('tiling correctness', () => {
  it('every input star appears in exactly one leaf tile', () => {
    const leaves = manifest.tiles.filter((t) => t.isLeaf);
    const seen = new Set<number>();

    for (const tile of leaves) {
      const bin = readFileSync(join(outDir, tile.binUrl));
      const buf = bin.buffer.slice(
        bin.byteOffset,
        bin.byteOffset + bin.byteLength,
      ) as ArrayBuffer;
      const catIds = new Uint32Array(
        buf,
        tile.buffers.catalogIds.byteOffset,
        tile.pointCount,
      );
      for (const id of catIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }

    const expectedIds = new Set(FIXTURE_STARS.map((s) => s.catalogId));
    expect(seen).toEqual(expectedIds);
  });

  it('reconstructed absolute positions match input within f32 epsilon', () => {
    const leaves = manifest.tiles.filter((t) => t.isLeaf);
    const byId = new Map(FIXTURE_STARS.map((s) => [s.catalogId, s]));

    for (const tile of leaves) {
      const bin = readFileSync(join(outDir, tile.binUrl));
      const buf = bin.buffer.slice(
        bin.byteOffset,
        bin.byteOffset + bin.byteLength,
      ) as ArrayBuffer;
      const positions = new Float32Array(
        buf,
        tile.buffers.positionsPc.byteOffset,
        tile.pointCount * 3,
      );
      const catIds = new Uint32Array(
        buf,
        tile.buffers.catalogIds.byteOffset,
        tile.pointCount,
      );
      const [cx, cy, cz] = tile.centerUnits;
      for (let i = 0; i < tile.pointCount; i++) {
        const s = byId.get(catIds[i]!)!;
        // positions are relative to tile center; reconstruct absolute
        const ax = cx + positions[i * 3]!;
        const ay = cy + positions[i * 3 + 1]!;
        const az = cz + positions[i * 3 + 2]!;
        expect(Math.abs(ax - s.x)).toBeLessThan(0.01);
        expect(Math.abs(ay - s.y)).toBeLessThan(0.01);
        expect(Math.abs(az - s.z)).toBeLessThan(0.01);
      }
    }
  });

  it('no leaf exceeds maxPointsPerTile (unless at MAX_OCTREE_LEVEL)', () => {
    const leaves = manifest.tiles.filter((t) => t.isLeaf);
    for (const tile of leaves) {
      const cell = decodeMortonKey(tile.key);
      if (cell.level < 16) {
        expect(tile.pointCount).toBeLessThanOrEqual(SMALL_OPTS.maxPointsPerTile!);
      }
    }
  });

  it('no tile .bin exceeds maxTileBytes', () => {
    for (const tile of manifest.tiles) {
      const totalBytes =
        tile.buffers.positionsPc.byteLength +
        tile.buffers.absMag.byteLength +
        tile.buffers.colorIndexBV.byteLength +
        tile.buffers.catalogIds.byteLength +
        tile.buffers.hipIds.byteLength;
      expect(totalBytes).toBeLessThanOrEqual(SMALL_OPTS.maxTileBytes!);
    }
  });

  it('all positions in tile .bin are within the node half-extent', () => {
    for (const tile of manifest.tiles) {
      const bin = readFileSync(join(outDir, tile.binUrl));
      const buf = bin.buffer.slice(
        bin.byteOffset,
        bin.byteOffset + bin.byteLength,
      ) as ArrayBuffer;
      const positions = new Float32Array(
        buf,
        tile.buffers.positionsPc.byteOffset,
        tile.pointCount * 3,
      );
      const h = tile.halfExtentUnits + 0.01; // f32 tolerance
      for (let i = 0; i < tile.pointCount; i++) {
        expect(Math.abs(positions[i * 3]!)).toBeLessThanOrEqual(h);
        expect(Math.abs(positions[i * 3 + 1]!)).toBeLessThanOrEqual(h);
        expect(Math.abs(positions[i * 3 + 2]!)).toBeLessThanOrEqual(h);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Morton / keys
// ---------------------------------------------------------------------------

describe('Morton / keys', () => {
  it('every tile key round-trips via decodeMortonKey / encodeMortonKey', () => {
    for (const tile of manifest.tiles) {
      const cell = decodeMortonKey(tile.key);
      expect(encodeMortonKey(cell)).toBe(tile.key);
    }
  });

  it('child keys derive from parents via childCell', () => {
    const keySet = new Set(manifest.tiles.map((t) => t.key));
    for (const tile of manifest.tiles) {
      if (tile.isLeaf) continue;
      const parentCell = decodeMortonKey(tile.key);
      for (let c = 0; c < 8; c++) {
        if (tile.childMask & (1 << c)) {
          const cc = childCell(parentCell, c);
          expect(keySet.has(encodeMortonKey(cc))).toBe(true);
        }
      }
    }
  });

  it('childMask bits exactly match present children', () => {
    const keySet = new Set(manifest.tiles.map((t) => t.key));
    for (const tile of manifest.tiles) {
      const parentCell = decodeMortonKey(tile.key);
      for (let c = 0; c < 8; c++) {
        const childKey = encodeMortonKey(childCell(parentCell, c));
        const bit = (tile.childMask >> c) & 1;
        if (tile.isLeaf) {
          expect(bit).toBe(0);
        } else {
          expect(bit).toBe(keySet.has(childKey) ? 1 : 0);
        }
      }
    }
  });

  it('manifest is root-first (key "0/0")', () => {
    expect(manifest.tiles[0]!.key).toBe('0/0');
  });

  it('root is internal (all 8 octants populated)', () => {
    const root = manifest.tiles[0]!;
    expect(root.isLeaf).toBe(false);
    expect(root.childMask).toBe(0xff);
  });
});

// ---------------------------------------------------------------------------
// Internal decimation
// ---------------------------------------------------------------------------

describe('internal decimation', () => {
  it('internal node carries exactly min(internalTilePoints, subtreeCount) points', () => {
    const internals = manifest.tiles.filter((t) => !t.isLeaf);
    expect(internals.length).toBeGreaterThan(0);
    for (const tile of internals) {
      const bin = readFileSync(join(outDir, tile.binUrl));
      const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
      const catIds = new Uint32Array(buf, tile.buffers.catalogIds.byteOffset, tile.pointCount);
      expect(catIds.length).toBe(tile.pointCount);
      expect(tile.pointCount).toBe(
        Math.min(SMALL_OPTS.internalTilePoints!, FIXTURE_STARS.length),
      );
    }
  });

  it('internal node points are the brightest by (absMag ASC, catalogId ASC)', () => {
    const root = manifest.tiles[0]!;
    expect(root.isLeaf).toBe(false);

    // Brute-force: sort all 24 fixture stars the same way, take top 2
    const sorted = [...FIXTURE_STARS].sort((a, b) => {
      const da = a.absMag - b.absMag;
      if (da !== 0) return da;
      return a.catalogId - b.catalogId;
    });
    const expected = sorted.slice(0, SMALL_OPTS.internalTilePoints!).map((s) => s.catalogId);

    const bin = readFileSync(join(outDir, root.binUrl));
    const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;
    const catIds = Array.from(
      new Uint32Array(buf, root.buffers.catalogIds.byteOffset, root.pointCount),
    );

    expect(new Set(catIds)).toEqual(new Set(expected));
  });
});

// ---------------------------------------------------------------------------
// Hash correctness
// ---------------------------------------------------------------------------

describe('hashes', () => {
  it('contentHashSha256 equals actual SHA-256 of each tile .bin', () => {
    for (const tile of manifest.tiles) {
      const bin = readFileSync(join(outDir, tile.binUrl));
      const actual = createHash('sha256').update(bin).digest('hex');
      expect(actual).toBe(tile.contentHashSha256);
    }
  });
});

// ---------------------------------------------------------------------------
// StarPackManifest input path (simulates the CLI read step)
// ---------------------------------------------------------------------------

describe('StarPackManifest input path', () => {
  it('reads a StarPackManifest and produces a valid octree', () => {
    const packDir = tmpDir('input-pack');
    makeStarPack(FIXTURE_STARS, packDir);

    // Read the pack back the same way the CLI does
    const sm: StarPackManifest = JSON.parse(
      readFileSync(join(packDir, 'manifest.json'), 'utf8'),
    ) as StarPackManifest;
    const binData = readFileSync(join(packDir, sm.binUrl));
    const buf = binData.buffer.slice(
      binData.byteOffset,
      binData.byteOffset + binData.byteLength,
    ) as ArrayBuffer;

    const [ox, oy, oz] = sm.originPc;
    const count = sm.count;
    const positions = new Float32Array(buf, sm.buffers.positionsPc.byteOffset, count * 3);
    const absMags = new Float32Array(buf, sm.buffers.absMag.byteOffset, count);
    const colorBVs = new Float32Array(buf, sm.buffers.colorIndexBV.byteOffset, count);
    const catIds = new Uint32Array(buf, sm.buffers.catalogIds.byteOffset, count);
    const hipIds = new Uint32Array(buf, sm.buffers.hipIds.byteOffset, count);

    const stars: StarData[] = [];
    for (let i = 0; i < count; i++) {
      stars.push({
        x: ox + positions[i * 3]!,
        y: oy + positions[i * 3 + 1]!,
        z: oz + positions[i * 3 + 2]!,
        absMag: absMags[i]!,
        colorIndexBV: colorBVs[i]!,
        catalogId: catIds[i]!,
        hipId: hipIds[i]!,
      });
    }

    const oct = buildOctree(stars, tmpDir('input-out'), { ...SMALL_OPTS, idPrefix: sm.source });
    const r = OctreeManifestSchema.safeParse(oct);
    expect(r.success).toBe(true);
    expect(oct.tiles.filter((t) => t.isLeaf).reduce((s, t) => s + t.pointCount, 0)).toBe(
      FIXTURE_STARS.length,
    );
  });
});

// ---------------------------------------------------------------------------
// rootHalfExtent validation
// ---------------------------------------------------------------------------

describe('rootHalfExtent validation', () => {
  it('throws for non-power-of-two rootHalfExtent', () => {
    expect(() => buildOctree([], tmpDir('invalid'), { rootHalfExtent: 65537 })).toThrow(
      /power of two/,
    );
  });
});
