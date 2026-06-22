import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  OCTREE_FORMAT_VERSION,
  MAX_TILE_BYTES,
  MAX_POINTS_PER_TILE,
  INTERNAL_TILE_POINTS,
} from '@cosmos/core-types';
import { loadOctreePack } from '@cosmos/data';
import {
  convertGaiaRow,
  isHygDuplicate,
  ingestGaia,
  buildGaiaPack,
  assertAttribution,
  type GaiaSourceRow,
  type HygStar,
} from '../src/gaia-ingest';
import { OctreeManifestSchema } from '../src/schema';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SNAPSHOT = join(REPO_ROOT, 'tools/pack-octree/test/fixtures/gaia-dr3-mini.csv');
const GOLDEN = join(REPO_ROOT, 'tools/pack-octree/test/fixtures/gaia-golden-hash.json');
const HYG_PACK = join(REPO_ROOT, 'apps/web/public/packs');
const SAMPLE = join(REPO_ROOT, 'apps/web/public/packs/octree-gaia-sample');
const ATTRIBUTIONS = join(REPO_ROOT, 'ATTRIBUTIONS.md');

// J2000 ICRS→galactic rotation (IAU 1958) — transcribed to compute the expected
// conversion INDEPENDENTLY of the production code path (which imports it from
// pack-stars). If these drift apart the conversion test fails.
const R = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
] as const;
const DEG2RAD = Math.PI / 180;

function expectedGalactic(raDeg: number, decDeg: number, distPc: number): [number, number, number] {
  const ra = raDeg * DEG2RAD;
  const dec = decDeg * DEG2RAD;
  const e0 = Math.cos(dec) * Math.cos(ra);
  const e1 = Math.cos(dec) * Math.sin(ra);
  const e2 = Math.sin(dec);
  return [
    distPc * (R[0][0] * e0 + R[0][1] * e1 + R[0][2] * e2),
    distPc * (R[1][0] * e0 + R[1][1] * e1 + R[1][2] * e2),
    distPc * (R[2][0] * e0 + R[2][1] * e1 + R[2][2] * e2),
  ];
}

function fileFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const buf = readFileSync(fileURLToPath(href));
    if (href.endsWith('.json')) {
      return new Response(buf.toString('utf8'), { status: 200 });
    }
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    return new Response(ab, { status: 200 });
  }) as typeof fetch;
}

// ---------------------------------------------------------------------------
// Conversion (ADR-006 §2)
// ---------------------------------------------------------------------------

describe('conversion', () => {
  // A known source: 100 mas parallax → 10 pc; G = 8.0; bp_rp = 1.0.
  const row: GaiaSourceRow = {
    sourceId: 123456789012345678n,
    ra: 101.287,
    dec: -16.716,
    parallaxMas: 100,
    gMag: 8.0,
    bpRp: 1.0,
  };

  it('maps RA/Dec/parallax to the expected galactic-pc position (within 1e-6)', () => {
    const star = convertGaiaRow(row)!;
    const [ex, ey, ez] = expectedGalactic(row.ra, row.dec, 1000 / row.parallaxMas);
    expect(Math.abs(star.x - ex)).toBeLessThan(1e-6);
    expect(Math.abs(star.y - ey)).toBeLessThan(1e-6);
    expect(Math.abs(star.z - ez)).toBeLessThan(1e-6);
  });

  it('computes absMag = G + 5·(log10(parallax_mas) − 2)', () => {
    const star = convertGaiaRow(row)!;
    // parallax 100 mas → d = 10 pc → absMag = G + 5 − 5·log10(10) = 8 + 5 − 5 = 8.0
    expect(star.absMag).toBeCloseTo(8.0 + 5 * (Math.log10(100) - 2), 10);
    expect(star.absMag).toBeCloseTo(8.0, 10);
  });

  it('computes colorIndexBV = clamp(0.85·bp_rp − 0.06, −0.4, 2.0)', () => {
    expect(convertGaiaRow(row)!.colorIndexBV).toBeCloseTo(0.85 * 1.0 - 0.06, 10);
    // clamp high
    expect(convertGaiaRow({ ...row, bpRp: 10 })!.colorIndexBV).toBe(2.0);
    // clamp low
    expect(convertGaiaRow({ ...row, bpRp: -5 })!.colorIndexBV).toBe(-0.4);
  });

  it('sets hipId = 0 and preserves the 64-bit source_id', () => {
    const star = convertGaiaRow(row)!;
    expect(star.hipId).toBe(0);
    expect(star.sourceId).toBe(123456789012345678n);
  });

  it('drops rows failing the magnitude cut or with non-positive parallax', () => {
    expect(convertGaiaRow({ ...row, gMag: 12.6 })).toBeNull();
    expect(convertGaiaRow({ ...row, parallaxMas: 0 })).toBeNull();
    expect(convertGaiaRow({ ...row, parallaxMas: -1 })).toBeNull();
    expect(convertGaiaRow({ ...row, ra: NaN })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dedup against HYG (ADR-006 §3)
// ---------------------------------------------------------------------------

describe('dedup', () => {
  const ref: GaiaSourceRow = {
    sourceId: 1n,
    ra: 150.0,
    dec: 12.0,
    parallaxMas: 20,
    gMag: 7.5,
    bpRp: 0.6,
  };
  const refStar = convertGaiaRow(ref)!;
  const hyg: HygStar[] = [{ x: refStar.x, y: refStar.y, z: refStar.z, absMag: refStar.absMag }];

  const arcsec = 1 / 3600;

  it('drops a Gaia source within 2″ AND 0.5 mag of an HYG star', () => {
    // exact same position + mag
    expect(isHygDuplicate(refStar, hyg)).toBe(true);
    // 1″ away, same mag → still inside tolerance
    const near = convertGaiaRow({ ...ref, dec: 12.0 + arcsec })!;
    expect(isHygDuplicate(near, hyg)).toBe(true);
  });

  it('keeps a Gaia source just outside the angular tolerance', () => {
    const far = convertGaiaRow({ ...ref, dec: 12.0 + 3 * arcsec })!;
    expect(isHygDuplicate(far, hyg)).toBe(false);
  });

  it('keeps a Gaia source outside the magnitude tolerance even at the same position', () => {
    const dim = convertGaiaRow({ ...ref, gMag: ref.gMag + 1.0 })!;
    expect(isHygDuplicate(dim, hyg)).toBe(false);
  });

  it('ingestGaia drops duplicates and assigns dense 0-based catalogIds in order', () => {
    const dup = { ...ref };
    const far = { ...ref, sourceId: 2n, dec: 12.0 + 3 * arcsec };
    const dim = { ...ref, sourceId: 3n, gMag: ref.gMag + 1.0 };
    const survivors = ingestGaia([dup, far, dim], hyg);
    expect(survivors.map((s) => s.sourceId)).toEqual([2n, 3n]);
    expect(survivors.map((s) => s.catalogId)).toEqual([0, 1]);
  });
});

// ---------------------------------------------------------------------------
// Attribution (ADR-006 §4)
// ---------------------------------------------------------------------------

describe('attribution', () => {
  it('passes when the Gaia credit is present in ATTRIBUTIONS.md', () => {
    expect(() => assertAttribution(ATTRIBUTIONS)).not.toThrow();
  });

  it('throws when the Gaia credit is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cosmos-attr-'));
    const path = join(dir, 'ATTRIBUTIONS.md');
    writeFileSync(path, '# nothing here\n');
    expect(() => assertAttribution(path)).toThrow(/ESA\/Gaia\/DPAC/);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Pack build: format, reproducibility, budget, round-trip
// ---------------------------------------------------------------------------

describe('gaia pack build', () => {
  let buildDir: string;

  beforeAll(() => {
    buildDir = mkdtempSync(join(tmpdir(), 'cosmos-gaia-build-'));
    buildGaiaPack({
      snapshotPath: SNAPSHOT,
      hygPackDir: HYG_PACK,
      outDir: buildDir,
      attributionsPath: ATTRIBUTIONS,
      sample: true,
    });
  });

  it('emits a manifest that validates as an OctreeManifest with the frozen Gaia fields', () => {
    const manifest = JSON.parse(readFileSync(join(buildDir, 'octree.json'), 'utf8'));
    expect(OctreeManifestSchema.safeParse(manifest).success).toBe(true);
    expect(manifest.octreeFormatVersion).toBe(OCTREE_FORMAT_VERSION);
    expect(manifest.source).toBe('gaia-dr3-bright');
    expect(manifest.idPrefix).toBe('gaia');
    expect(manifest.context).toBe('galaxy');
    expect(manifest.rootHalfExtentUnits).toBe(65536);
  });

  it('every tile is within MAX_TILE_BYTES / MAX_POINTS_PER_TILE; internal tiles are decimated', () => {
    const manifest = JSON.parse(readFileSync(join(buildDir, 'octree.json'), 'utf8'));
    for (const t of manifest.tiles) {
      const bytes =
        t.buffers.positionsPc.byteLength +
        t.buffers.absMag.byteLength +
        t.buffers.colorIndexBV.byteLength +
        t.buffers.catalogIds.byteLength +
        t.buffers.hipIds.byteLength;
      expect(bytes).toBeLessThanOrEqual(MAX_TILE_BYTES);
      expect(t.pointCount).toBeLessThanOrEqual(MAX_POINTS_PER_TILE);
      if (!t.isLeaf) {
        expect(t.pointCount).toBe(Math.min(INTERNAL_TILE_POINTS, t.pointCount));
        expect(t.pointCount).toBeLessThanOrEqual(INTERNAL_TILE_POINTS);
      }
    }
  });

  it('writes a BigInt64 source_id sidecar with one entry per surviving source', () => {
    const manifest = JSON.parse(readFileSync(join(buildDir, 'octree.json'), 'utf8'));
    const leafStars = manifest.tiles
      .filter((t: { isLeaf: boolean }) => t.isLeaf)
      .reduce((s: number, t: { pointCount: number }) => s + t.pointCount, 0);
    const sidecar = readFileSync(join(buildDir, 'gaia-sourceids.bin'));
    expect(sidecar.byteLength).toBe(leafStars * 8);
  });

  it('rebuilds byte-identically and matches the committed golden hashes (reproducible)', () => {
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    const json1 = readFileSync(join(buildDir, 'octree.json'));
    const json2 = readFileSync(join(SAMPLE, 'octree.json'));
    expect(json1.equals(json2)).toBe(true);

    const manifest = JSON.parse(json1.toString('utf8'));
    const byKey = new Map(golden.tiles.map((t: { key: string; contentHashSha256: string }) => [t.key, t.contentHashSha256]));
    for (const t of manifest.tiles) {
      expect(t.contentHashSha256).toBe(byKey.get(t.key));
    }
  });

  it('the committed sample is small (≤ 512 KB total)', () => {
    const manifest = JSON.parse(readFileSync(join(SAMPLE, 'octree.json'), 'utf8'));
    let total = readFileSync(join(SAMPLE, 'octree.json')).byteLength;
    total += readFileSync(join(SAMPLE, 'gaia-sourceids.bin')).byteLength;
    for (const t of manifest.tiles) {
      total += readFileSync(join(SAMPLE, t.binUrl)).byteLength;
    }
    expect(total).toBeLessThanOrEqual(512 * 1024);
  });

  it('round-trips through @cosmos/data loadOctreePack: a leaf decodes to a gaia StarBatch', async () => {
    const manifestUrl = `file:///${SAMPLE.replace(/\\/g, '/')}/octree.json`;
    const source = await loadOctreePack(manifestUrl, { fetchImpl: fileFetch() });
    expect(source.idPrefix).toBe('gaia');

    // Find a leaf and decode it.
    let leafKey = source.root.key;
    while (source.getNode(leafKey)!.childKeys.length > 0) {
      leafKey = source.getNode(leafKey)!.childKeys[0]!;
    }
    const batch = await source.loadTile(leafKey);
    expect(batch.idPrefix).toBe('gaia');
    expect(batch.count).toBeGreaterThan(0);
    expect(batch.positionsPc.length).toBe(batch.count * 3);
  });
});
