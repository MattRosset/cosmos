/**
 * Gaia DR3 reverse lookup (TASK-070): a real 64-bit `source_id` → the star's absolute
 * galactic-frame position (parsecs, Sol-origin), so the search palette can fly the camera
 * to any of the ~4.6M real stars by id. This is the REVERSE of the forward sidecar
 * (`gaia-sourceids.ts`, catalogId → source_id); the two are independent.
 *
 * Backing file: `gaia-sourceids-index.bin` (emitted next to the octree manifest by
 * `writeSourceIdIndex`, tools/pack-octree). Fixed 16-byte records sorted by source_id:
 * `(source_id: i64 LE, tileId: u32 LE, indexInTile: u32 LE)`, where `tileId` indexes the
 * on-disk `manifest.tiles` (BFS order) and `indexInTile` is the star's slot in that leaf
 * tile. Signed i64 matches the sidecar; real DR3 ids are positive so ordering is unambiguous.
 *
 * Lookup path (all lazy — zero cost until the first `resolve`):
 *   1. Binary-search the index by source_id. Preferred: HTTP **Range** requests (206) so the
 *      multi-MB real index is never fetched whole on a keystroke (~log2(N) 16-byte reads).
 *      If the server answers 200 (no range support — e.g. the `file://` test fetch, some dev
 *      servers), we fall back ONCE to a single full fetch and search the cached buffer.
 *   2. On a hit, load the plain on-disk octree tile `manifest.tiles[tileId]` (NOT the combined
 *      view — push-down reorders it, TASK-070 Step 0), decode it, and read the position at
 *      `indexInTile`, adding the tile centre to get the absolute galactic-pc position.
 *
 * Degrades like the sidecar (CLAUDE.md rule 1 — surface, never throw): any fetch/decode
 * failure warns once and every `resolve` returns null (search shows an empty state).
 */
import { resolveRelativeUrl } from './octree.js';
import { decodeTile } from './octree-decode.js';
import type { OctreeManifest } from '@cosmos/core-types';

/** Bytes per index record — MUST match `writeSourceIdIndex`. */
const RECORD_BYTES = 16;

export interface GaiaReverseHit {
  /** The matched DR3 source_id, echoed back as `bigint` (never `Number()`). */
  readonly sourceId: bigint;
  /** Absolute galactic-frame position, Sol-origin, parsecs — a galaxy-context fly target. */
  readonly positionPc: readonly [number, number, number];
}

export interface GaiaReverseLookup {
  /** Position for a DR3 source_id, or null if absent / index unavailable. Async: the
   *  index (and, on a hit, one octree tile) is fetched lazily. bigint end-to-end. */
  resolve(sourceId: bigint): Promise<GaiaReverseHit | null>;
}

/** Index access mode, resolved on first use from the server's Range support. */
type IndexAccess =
  | { readonly mode: 'range'; readonly recordCount: number }
  | { readonly mode: 'full'; readonly recordCount: number; readonly view: DataView };

interface IndexRecord {
  readonly sourceId: bigint;
  readonly tileId: number;
  readonly indexInTile: number;
}

function decodeRecord(view: DataView, byteOffset: number): IndexRecord {
  return {
    sourceId: view.getBigInt64(byteOffset, /* littleEndian */ true),
    tileId: view.getUint32(byteOffset + 8, true),
    indexInTile: view.getUint32(byteOffset + 12, true),
  };
}

/**
 * Returns the resolver synchronously; the FIRST `resolve` lazily fetches the index (via
 * Range if supported, else one full fetch) and the manifest, caching both promises so
 * concurrent/subsequent calls never refetch. A tile is fetched per hit and cached by tileId.
 */
export function loadGaiaReverseLookup(
  manifestUrl: string,
  opts?: { readonly fetchImpl?: typeof fetch },
): GaiaReverseLookup {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  const indexUrl = resolveRelativeUrl(manifestUrl, 'gaia-sourceids-index.bin');

  let warned = false;
  function warnOnce(msg: string, err?: unknown): void {
    if (warned) return;
    warned = true;
    if (err !== undefined) console.warn(msg, err);
    else console.warn(msg);
  }

  // Cache the *promises* so concurrent first-calls share one fetch. A null resolution
  // means "unavailable" — cached so the warn fires exactly once.
  let accessPromise: Promise<IndexAccess | null> | undefined;
  let manifestPromise: Promise<OctreeManifest | null> | undefined;
  const tileCache = new Map<number, Promise<PositionReader | null>>();

  function fullAccessFromBuffer(buf: ArrayBuffer): IndexAccess {
    const recordCount = Math.floor(buf.byteLength / RECORD_BYTES);
    if (buf.byteLength % RECORD_BYTES !== 0) {
      warnOnce(
        `gaia-reverse-lookup: ${indexUrl} length ${buf.byteLength} is not a multiple of ${RECORD_BYTES} ` +
          `(truncated/corrupt index); ${buf.byteLength % RECORD_BYTES} trailing byte(s) ignored`,
      );
    }
    return { mode: 'full', recordCount, view: new DataView(buf) };
  }

  async function loadAccess(): Promise<IndexAccess | null> {
    try {
      const f = fetchImpl; // unbound local — real fetch rejects a non-global receiver (BUG-6)
      // Probe Range support with the first 16-byte record.
      const res = await f(indexUrl, { headers: { Range: `bytes=0-${RECORD_BYTES - 1}` } });
      if (!res.ok && res.status !== 206) {
        warnOnce(
          `gaia-reverse-lookup: fetch failed (${res.status} ${res.statusText}) for ${indexUrl}; Gaia search disabled`,
        );
        return null;
      }
      if (res.status === 206) {
        // Ranged: total record count comes from Content-Range `bytes 0-15/TOTAL`.
        const total = parseContentRangeTotal(res.headers.get('Content-Range'));
        if (total !== null && total % RECORD_BYTES === 0) {
          return { mode: 'range', recordCount: total / RECORD_BYTES };
        }
        // 206 without a usable total — do one full fetch below.
        const full = await f(indexUrl);
        if (!full.ok) {
          warnOnce(
            `gaia-reverse-lookup: fetch failed (${full.status} ${full.statusText}) for ${indexUrl}; Gaia search disabled`,
          );
          return null;
        }
        return fullAccessFromBuffer(await full.arrayBuffer());
      }
      // 200 (no range support): the probe already returned the whole file — reuse it.
      return fullAccessFromBuffer(await res.arrayBuffer());
    } catch (err) {
      warnOnce(`gaia-reverse-lookup: index load failed for ${indexUrl}; Gaia search disabled`, err);
      return null;
    }
  }

  /** Read one index record. Full mode slices the cached buffer; range mode fetches 16 bytes. */
  async function readRecord(access: IndexAccess, i: number): Promise<IndexRecord | null> {
    if (access.mode === 'full') {
      return decodeRecord(access.view, i * RECORD_BYTES);
    }
    try {
      const f = fetchImpl;
      const start = i * RECORD_BYTES;
      const res = await f(indexUrl, { headers: { Range: `bytes=${start}-${start + RECORD_BYTES - 1}` } });
      if (!res.ok && res.status !== 206) return null;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < RECORD_BYTES) return null;
      return decodeRecord(new DataView(buf), 0);
    } catch {
      return null;
    }
  }

  async function loadManifest(): Promise<OctreeManifest | null> {
    try {
      const f = fetchImpl;
      const res = await f(manifestUrl);
      if (!res.ok) {
        warnOnce(
          `gaia-reverse-lookup: manifest fetch failed (${res.status} ${res.statusText}) for ${manifestUrl}; Gaia search disabled`,
        );
        return null;
      }
      return (await res.json()) as OctreeManifest;
    } catch (err) {
      warnOnce(`gaia-reverse-lookup: manifest load failed for ${manifestUrl}; Gaia search disabled`, err);
      return null;
    }
  }

  /** Fetch + decode tile `tileId`, returning a reader for a slot's absolute position. */
  async function loadTilePositions(tileId: number): Promise<PositionReader | null> {
    if (manifestPromise === undefined) manifestPromise = loadManifest();
    const manifest = await manifestPromise;
    if (manifest === null) return null;
    const tile = manifest.tiles[tileId];
    if (tile === undefined) return null;
    try {
      const f = fetchImpl;
      const binUrl = resolveRelativeUrl(manifestUrl, tile.binUrl);
      const res = await f(binUrl);
      if (!res.ok) return null;
      const bin = await res.arrayBuffer();
      const { batch } = decodeTile(bin, tile, manifest.idPrefix);
      const [cx, cy, cz] = tile.centerUnits;
      return (slot: number): [number, number, number] | null => {
        if (slot < 0 || slot >= batch.count) return null;
        return [
          cx + batch.positionsPc[slot * 3]!,
          cy + batch.positionsPc[slot * 3 + 1]!,
          cz + batch.positionsPc[slot * 3 + 2]!,
        ];
      };
    } catch {
      return null;
    }
  }

  return {
    async resolve(sourceId: bigint): Promise<GaiaReverseHit | null> {
      if (accessPromise === undefined) accessPromise = loadAccess();
      const access = await accessPromise;
      if (access === null) return null;

      // Binary search (lower_bound) by source_id.
      let lo = 0;
      let hi = access.recordCount;
      let hit: IndexRecord | null = null;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const rec = await readRecord(access, mid);
        if (rec === null) return null; // a ranged read failed mid-search — degrade
        if (rec.sourceId < sourceId) {
          lo = mid + 1;
        } else {
          hi = mid;
          if (rec.sourceId === sourceId) hit = rec;
        }
      }
      if (hit === null) {
        if (lo >= access.recordCount) return null;
        const rec = await readRecord(access, lo);
        if (rec === null || rec.sourceId !== sourceId) return null;
        hit = rec;
      }

      let readerPromise = tileCache.get(hit.tileId);
      if (readerPromise === undefined) {
        readerPromise = loadTilePositions(hit.tileId);
        tileCache.set(hit.tileId, readerPromise);
      }
      const reader = await readerPromise;
      if (reader === null) return null;
      const positionPc = reader(hit.indexInTile);
      if (positionPc === null) return null;
      return { sourceId, positionPc };
    },
  };
}

/** Reads a slot's absolute galactic-pc position from a decoded tile, or null if out of range. */
type PositionReader = (slot: number) => [number, number, number] | null;

/** Parse the `/TOTAL` from a `Content-Range: bytes 0-15/2160` header, or null. */
function parseContentRangeTotal(header: string | null): number | null {
  if (header === null) return null;
  const m = /\/(\d+)\s*$/.exec(header.trim());
  if (m === null) return null;
  const total = Number(m[1]);
  return Number.isSafeInteger(total) ? total : null;
}
