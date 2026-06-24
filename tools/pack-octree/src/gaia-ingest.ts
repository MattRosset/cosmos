import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { StarPackManifest } from '@cosmos/core-types';
// Reuse the HYG ICRS→galactic rotation (ADR-006 §2 / ADR-001): both catalogs
// MUST land in the identical frame. Do not re-derive the rotation here.
import { galacticPositionPc } from '../../pack-stars/src/convert';
import { buildOctree } from './build';
import type { StarData } from './build';

const DEG2RAD = Math.PI / 180;

/** ADR-006 §1 magnitude cut. */
export const MAG_CUT_G = 12.5;
/**
 * ADR-006 §4 CI sample: a region-clipped subset kept small enough to commit.
 * `--sample` retains only sources within this galactic distance of Sol; on the
 * full ~2–3M snapshot this clips the distant majority, on the mini fixture
 * (all nearby) it is effectively a no-op.
 */
export const SAMPLE_MAX_DIST_PC = 600;

/** ADR-006 §3 dedup tolerances. */
export const DEDUP_ARCSEC = 2;
export const DEDUP_MAG = 0.5;
const DEDUP_RAD = (DEDUP_ARCSEC / 3600) * DEG2RAD;
const DEDUP_COS = Math.cos(DEDUP_RAD);

/** Required Gaia DR3 columns (ADR-006 §1). */
export interface GaiaSourceRow {
  /** Gaia 64-bit source_id (does NOT fit Uint32 — sidecar only). */
  readonly sourceId: bigint;
  /** ICRS right ascension, degrees. */
  readonly ra: number;
  /** ICRS declination, degrees. */
  readonly dec: number;
  /** Parallax, milliarcsec. */
  readonly parallaxMas: number;
  /** Phot G mean magnitude. */
  readonly gMag: number;
  /** BP−RP color. */
  readonly bpRp: number;
}

/** A converted Gaia source in the canonical galactic-Cartesian frame. */
export interface GaiaStar extends StarData {
  /** Preserved original 64-bit source_id (→ gaia-sourceids.bin sidecar). */
  readonly sourceId: bigint;
}

/** Minimal HYG record needed for dedup (galactic-pc position + magnitude). */
export interface HygStar {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly absMag: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Convert one Gaia row to a galactic-Cartesian star, or null if it fails the
 * magnitude cut / has no usable parallax (ADR-006 §1–§2). `catalogId`/`sourceId`
 * are NOT assigned here — the caller assigns the dense index after dedup.
 */
export function convertGaiaRow(row: GaiaSourceRow): Omit<GaiaStar, 'catalogId'> | null {
  if (!Number.isFinite(row.parallaxMas) || row.parallaxMas <= 0) return null;
  if (!Number.isFinite(row.gMag) || row.gMag > MAG_CUT_G) return null;
  if (!Number.isFinite(row.ra) || !Number.isFinite(row.dec)) return null;

  const distPc = 1000 / row.parallaxMas;
  const [x, y, z] = galacticPositionPc(row.ra * DEG2RAD, row.dec * DEG2RAD, distPc);

  // absMag = G + 5·(log10(parallax_mas) − 2) = G + 5 − 5·log10(d_pc)
  const absMag = row.gMag + 5 * (Math.log10(row.parallaxMas) - 2);
  const bpRp = Number.isFinite(row.bpRp) ? row.bpRp : 0;
  const colorIndexBV = clamp(0.85 * bpRp - 0.06, -0.4, 2.0);

  return { x, y, z, absMag, colorIndexBV, hipId: 0, sourceId: row.sourceId };
}

/**
 * True if `g` duplicates any HYG star: angular separation ≤ 2″ AND |Δmag| ≤ 0.5
 * (ADR-006 §3). Angular separation is frame-independent, so it is measured
 * directly between the shared galactic-Cartesian direction vectors.
 */
export function isHygDuplicate(g: Pick<GaiaStar, 'x' | 'y' | 'z' | 'absMag'>, hyg: readonly HygStar[]): boolean {
  const gLen = Math.hypot(g.x, g.y, g.z);
  if (gLen === 0) return false;
  for (const h of hyg) {
    if (Math.abs(g.absMag - h.absMag) > DEDUP_MAG) continue;
    const hLen = Math.hypot(h.x, h.y, h.z);
    if (hLen === 0) continue;
    const cos = (g.x * h.x + g.y * h.y + g.z * h.z) / (gLen * hLen);
    if (cos >= DEDUP_COS) return true;
  }
  return false;
}

/**
 * Magnitude-sorted HYG index with cached direction lengths. Dedup is the build's
 * bottleneck: the naïve `isHygDuplicate` scans all ~109k HYG stars per Gaia source —
 * O(gaia × hyg), ~31 min on the full ~3M catalog. The `|Δmag| ≤ DEDUP_MAG` guard rejects
 * almost every pair, so we instead binary-search the magnitude window once. EXACT: the
 * stars iterated are precisely those `isHygDuplicate`'s mag guard would keep, the dup
 * decision is order-independent (first angular hit ⇒ true), so the drop set — and the
 * byte-reproducible output — is identical (covered by the golden-hash test).
 */
interface HygMagIndex {
  readonly mags: Float64Array; // ascending
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly zs: Float64Array;
  readonly lens: Float64Array; // |(x,y,z)|, all > 0
}

function buildHygMagIndex(hyg: readonly HygStar[]): HygMagIndex {
  const usable = hyg
    .map((h) => ({ h, len: Math.hypot(h.x, h.y, h.z) }))
    .filter((e) => e.len > 0)
    .sort((a, b) => a.h.absMag - b.h.absMag);
  const n = usable.length;
  const mags = new Float64Array(n);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const zs = new Float64Array(n);
  const lens = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const e = usable[i]!;
    mags[i] = e.h.absMag;
    xs[i] = e.h.x;
    ys[i] = e.h.y;
    zs[i] = e.h.z;
    lens[i] = e.len;
  }
  return { mags, xs, ys, zs, lens };
}

/** First index `i` with `mags[i] >= target` (mags ascending). */
function lowerBound(mags: Float64Array, target: number): number {
  let lo = 0;
  let hi = mags.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (mags[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Indexed equivalent of {@link isHygDuplicate}; identical result, windowed scan. */
function isHygDuplicateIndexed(
  g: Pick<GaiaStar, 'x' | 'y' | 'z' | 'absMag'>,
  idx: HygMagIndex,
): boolean {
  const gLen = Math.hypot(g.x, g.y, g.z);
  if (gLen === 0) return false;
  const { mags, xs, ys, zs, lens } = idx;
  const hiMag = g.absMag + DEDUP_MAG;
  for (let i = lowerBound(mags, g.absMag - DEDUP_MAG); i < mags.length && mags[i]! <= hiMag; i++) {
    const cos = (g.x * xs[i]! + g.y * ys[i]! + g.z * zs[i]!) / (gLen * lens[i]!);
    if (cos >= DEDUP_COS) return true;
  }
  return false;
}

export interface ParsedSnapshot {
  readonly rows: readonly GaiaSourceRow[];
}

/** Parse a cached Gaia DR3 snapshot CSV (the columns the ADQL query selects). */
export function parseSnapshotCsv(csv: string): ParsedSnapshot {
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  const rows: GaiaSourceRow[] = records.map((r) => ({
    sourceId: BigInt(r['source_id'] ?? '0'),
    ra: parseFloat(r['ra'] ?? ''),
    dec: parseFloat(r['dec'] ?? ''),
    parallaxMas: parseFloat(r['parallax'] ?? ''),
    gMag: parseFloat(r['phot_g_mean_mag'] ?? ''),
    bpRp: parseFloat(r['bp_rp'] ?? ''),
  }));
  return { rows };
}

/** Read an HYG star pack (manifest.json + .bin) as dedup input (ADR-006 §3). */
export function readHygPack(packDir: string): HygStar[] {
  const manifest = JSON.parse(
    readFileSync(join(packDir, 'manifest.json'), 'utf8'),
  ) as StarPackManifest;
  const bin = readFileSync(join(packDir, manifest.binUrl));
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer;

  const [ox, oy, oz] = manifest.originPc;
  const n = manifest.count;
  const pos = new Float32Array(buf, manifest.buffers.positionsPc.byteOffset, n * 3);
  const absMag = new Float32Array(buf, manifest.buffers.absMag.byteOffset, n);

  const stars: HygStar[] = [];
  for (let i = 0; i < n; i++) {
    stars.push({
      x: ox + pos[i * 3]!,
      y: oy + pos[i * 3 + 1]!,
      z: oz + pos[i * 3 + 2]!,
      absMag: absMag[i]!,
    });
  }
  return stars;
}

/**
 * Run the full ADR-006 §1–§3 ingest: convert + magnitude-cut + (optional sample
 * region-clip) + HYG dedup. Surviving sources keep their snapshot order and are
 * assigned a dense 0-based `catalogId` (= sidecar index). Deterministic.
 */
export function ingestGaia(
  rows: readonly GaiaSourceRow[],
  hyg: readonly HygStar[],
  options: { readonly sample?: boolean } = {},
): GaiaStar[] {
  const sample = options.sample ?? false;
  const hygIndex = buildHygMagIndex(hyg);
  const stars: GaiaStar[] = [];
  let catalogId = 0;
  for (const row of rows) {
    const converted = convertGaiaRow(row);
    if (converted === null) continue;
    if (sample && Math.hypot(converted.x, converted.y, converted.z) > SAMPLE_MAX_DIST_PC) {
      continue;
    }
    if (isHygDuplicateIndexed(converted, hygIndex)) continue;
    stars.push({ ...converted, catalogId: catalogId++ });
  }
  return stars;
}

/** Write the BigInt64 source_id sidecar (ADR-006 §2), indexed by dense catalogId. */
export function writeSourceIdSidecar(stars: readonly GaiaStar[], outDir: string): void {
  const arr = new BigInt64Array(stars.length);
  for (const s of stars) arr[s.catalogId] = BigInt.asIntN(64, s.sourceId);
  writeFileSync(join(outDir, 'gaia-sourceids.bin'), Buffer.from(arr.buffer));
}

/**
 * ADR-006 §4: the build fails if the Gaia/ESA/DPAC credit is absent from
 * ATTRIBUTIONS.md. Returns silently when present, throws otherwise.
 */
export function assertAttribution(attributionsPath: string): void {
  const text = readFileSync(attributionsPath, 'utf8');
  if (!/ESA\/Gaia\/DPAC/.test(text)) {
    throw new Error(
      `Gaia attribution missing: "ESA/Gaia/DPAC" not found in ${attributionsPath} (ADR-006 §4)`,
    );
  }
}

export interface BuildGaiaPackOptions {
  readonly snapshotPath: string;
  readonly hygPackDir: string;
  readonly outDir: string;
  readonly attributionsPath: string;
  /** Emit the region-clipped CI sample (ADR-006 §4). */
  readonly sample?: boolean;
}

export interface BuildGaiaPackResult {
  readonly tileCount: number;
  readonly leafStarCount: number;
  readonly survivingSources: number;
  readonly droppedDuplicates: number;
}

/**
 * End-to-end Gaia pack build: read snapshot + HYG, convert/dedup, emit an
 * ADR-003 octree pack (manifest + tiles) plus the source_id sidecar, after
 * verifying the Gaia attribution is present. Reuses the existing octree splitter
 * unchanged — no Gaia-specific tile format (ADR-006 §4).
 */
export function buildGaiaPack(options: BuildGaiaPackOptions): BuildGaiaPackResult {
  assertAttribution(options.attributionsPath);

  const { rows } = parseSnapshotCsv(readFileSync(options.snapshotPath, 'utf8'));
  const hyg = readHygPack(options.hygPackDir);
  const stars = ingestGaia(rows, hyg, { sample: options.sample ?? false });

  const converted = rows.reduce((n, r) => (convertGaiaRow(r) ? n + 1 : n), 0);

  const manifest = buildOctree(stars, options.outDir, {
    rootHalfExtent: 65536,
    source: 'gaia-dr3-bright',
    idPrefix: 'gaia',
  });
  writeSourceIdSidecar(stars, options.outDir);

  const leaves = manifest.tiles.filter((t) => t.isLeaf);
  return {
    tileCount: manifest.tiles.length,
    leafStarCount: leaves.reduce((s, t) => s + t.pointCount, 0),
    survivingSources: stars.length,
    droppedDuplicates: converted - stars.length,
  };
}
