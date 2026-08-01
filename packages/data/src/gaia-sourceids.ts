/**
 * Gaia DR3 source_id sidecar resolver (TASK-087 D1, carve-out of TASK-069; see
 * docs/research/gaia-pick-identity-gap.md). Maps a pack-global Gaia `catalogId` to the
 * real 64-bit DR3 `source_id`. The sidecar `gaia-sourceids.bin` is a flat, header-less
 * `BigInt64Array` (signed i64, little-endian) written by `writeSourceIdSidecar`
 * (tools/pack-octree/src/gaia-ingest.ts) and indexed by the dense `catalogId`. All real
 * DR3 ids are positive `< 2^63`, so the signed decode is lossless; we keep `bigint`
 * end-to-end and NEVER `Number()` (an id > 2^53 would silently corrupt).
 *
 * There is no live consumer today — this is built ahead of the octree-stream pick
 * (Task B), which will turn a picked Gaia star's `catalogId` into its DR3 identity. The
 * unit tests are the contract Task B consumes.
 */
import { resolveRelativeUrl } from './octree.js';

export interface GaiaSourceIdResolver {
  /** Real DR3 source_id for a pack-global catalogId, or null if absent / out of range /
   *  sidecar unavailable. ASYNC because the sidecar is lazy-loaded on first call.
   *  bigint end-to-end — never Number(). */
  resolve(catalogId: number): Promise<bigint | null>;
}

/**
 * Returns the resolver synchronously; the FIRST `resolve` triggers a single fetch of
 * `gaia-sourceids.bin` (resolved against `manifestUrl`, next to the manifest) and caches
 * the decoded `BigInt64Array`. Concurrent/subsequent `resolve` calls await the same cached
 * load promise (never N fetches). On fetch/decode failure it warns ONCE and every `resolve`
 * resolves to null (degrade to no-identity, never throw/reject).
 */
export function loadGaiaSourceIds(
  manifestUrl: string,
  opts?: { readonly fetchImpl?: typeof fetch },
): GaiaSourceIdResolver {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  const url = resolveRelativeUrl(manifestUrl, 'gaia-sourceids.bin');

  // Cache the load *promise* on first resolve so concurrent calls share one fetch. A null
  // resolution means "unavailable" — cached so the warn fires exactly once.
  let loadPromise: Promise<BigInt64Array | null> | undefined;

  async function load(): Promise<BigInt64Array | null> {
    try {
      // Call `fetch` through a local unbound reference, never `opts.fetchImpl(url)`: the
      // real browser `fetch` throws "Illegal invocation" with a non-global receiver
      // (BUG-6, octree.ts:130-137). A unit-test mock does not enforce the receiver, so
      // this is invisible until a real browser run.
      const f = fetchImpl;
      const res = await f(url);
      if (!res.ok) {
        console.warn(
          `gaia-sourceids: fetch failed (${res.status} ${res.statusText}) for ${url}; Gaia identity disabled`,
        );
        return null;
      }
      const buf = await res.arrayBuffer();
      // Header-less signed i64 LE; length param guards a non-multiple-of-8 buffer (which
      // the plain `new BigInt64Array(buf)` ctor would throw on). A misaligned length means
      // a truncated/corrupt sidecar: surface it (don't degrade silently — CLAUDE.md rule 1)
      // but still serve the fully-decoded ids rather than throwing.
      if (buf.byteLength % 8 !== 0) {
        console.warn(
          `gaia-sourceids: ${url} length ${buf.byteLength} is not a multiple of 8 ` +
            `(truncated/corrupt sidecar); ${buf.byteLength % 8} trailing byte(s) ignored`,
        );
      }
      return new BigInt64Array(buf, 0, Math.floor(buf.byteLength / 8));
    } catch (err) {
      console.warn(`gaia-sourceids: load failed for ${url}; Gaia identity disabled`, err);
      return null;
    }
  }

  return {
    async resolve(catalogId: number): Promise<bigint | null> {
      if (loadPromise === undefined) loadPromise = load();
      const arr = await loadPromise;
      if (arr === null) return null;
      if (!Number.isInteger(catalogId) || catalogId < 0 || catalogId >= arr.length) {
        return null;
      }
      return arr[catalogId]!;
    },
  };
}
