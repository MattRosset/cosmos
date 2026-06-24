import type { MortonKey, OctreeManifest, OctreeTileManifest, StarBatch } from '@cosmos/core-types';
import {
  OCTREE_FORMAT_VERSION,
  encodeMortonKey,
  decodeMortonKey,
  childCell as computeChildCell,
} from '@cosmos/core-types';
import type { LoadOptions } from './load.js';
import type { WorkerPool } from '@cosmos/workers';
import { createCancelToken, WorkerCancelledError } from '@cosmos/workers';
import { decodeTile } from './octree-decode.js';

export class OctreeFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OctreeFormatError';
  }
}

export interface OctreeNode {
  readonly key: MortonKey;
  readonly manifest: OctreeTileManifest;
  /** Child keys present (ADR-003 childMask), in Morton order. */
  readonly childKeys: readonly MortonKey[];
}

export interface OctreeSource {
  readonly root: OctreeNode;
  readonly context: OctreeManifest['context'];
  readonly rootHalfExtentUnits: number;
  readonly idPrefix: string;
  getNode(key: MortonKey): OctreeNode | undefined;
  /**
   * Fetch (if needed) + decode one tile into a StarBatch. Cancellable via
   * AbortSignal (§5.8). Rejects with OctreeFormatError on hash/slice mismatch,
   * AbortError on abort.
   */
  loadTile(key: MortonKey, opts?: { readonly signal?: AbortSignal }): Promise<StarBatch>;
}

export interface LoadOctreeOptions extends LoadOptions {
  /** When present, tile decode is dispatched to this pool (§5.13). */
  readonly pool?: WorkerPool;
}

function resolveRelativeUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    const lastSlash = base.lastIndexOf('/');
    return lastSlash >= 0 ? base.slice(0, lastSlash + 1) + relative : relative;
  }
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function buildChildKeys(tile: OctreeTileManifest): readonly MortonKey[] {
  if (tile.childMask === 0) return [];
  const cell = decodeMortonKey(tile.key);
  const keys: MortonKey[] = [];
  for (let c = 0; c < 8; c++) {
    if (tile.childMask & (1 << c)) {
      keys.push(encodeMortonKey(computeChildCell(cell, c)));
    }
  }
  return keys;
}

class OctreeSourceImpl implements OctreeSource {
  readonly root: OctreeNode;
  readonly context: OctreeManifest['context'];
  readonly rootHalfExtentUnits: number;
  readonly idPrefix: string;

  private readonly _nodeMap: Map<MortonKey, OctreeNode>;
  private readonly _manifestUrl: string;
  private readonly _fetchImpl: typeof fetch;
  private readonly _pool: WorkerPool | undefined;

  constructor(
    manifest: OctreeManifest,
    manifestUrl: string,
    fetchImpl: typeof fetch,
    pool: WorkerPool | undefined,
  ) {
    this.context = manifest.context;
    this.rootHalfExtentUnits = manifest.rootHalfExtentUnits;
    this.idPrefix = manifest.idPrefix;
    this._manifestUrl = manifestUrl;
    this._fetchImpl = fetchImpl;
    this._pool = pool;

    this._nodeMap = new Map();
    for (const tile of manifest.tiles) {
      const node: OctreeNode = {
        key: tile.key,
        manifest: tile,
        childKeys: buildChildKeys(tile),
      };
      this._nodeMap.set(tile.key, node);
    }

    const rootTile = manifest.tiles[0];
    if (!rootTile) throw new OctreeFormatError('Manifest has no tiles');
    this.root = this._nodeMap.get(rootTile.key)!;
  }

  getNode(key: MortonKey): OctreeNode | undefined {
    return this._nodeMap.get(key);
  }

  async loadTile(key: MortonKey, opts?: { readonly signal?: AbortSignal }): Promise<StarBatch> {
    const signal = opts?.signal;

    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }

    const node = this._nodeMap.get(key);
    if (!node) throw new Error(`Unknown octree key: ${key}`);

    const tile = node.manifest;
    const binUrl = resolveRelativeUrl(this._manifestUrl, tile.binUrl);

    // Call through a local (unbound) reference, NOT `this._fetchImpl(...)`: the real
    // browser `fetch` throws "Illegal invocation" when invoked with a receiver other
    // than the global (here the OctreeSourceImpl instance). The manifest fetch in
    // loadOctreePack already calls it this way; tile loads must match or every tile
    // load rejects (BUG-6). A unit-test fetch mock doesn't enforce the receiver, so
    // this was invisible until run against a real browser.
    const fetchImpl = this._fetchImpl;
    const binRes = await fetchImpl(binUrl, signal ? { signal } : undefined);
    if (!binRes.ok) {
      throw new Error(`Failed to fetch tile ${key}: ${binRes.status} ${binRes.statusText}`);
    }

    const bin = await binRes.arrayBuffer();

    // Validate buffer slices before decode (§ common mistakes)
    const binLen = bin.byteLength;
    for (const [name, slice] of Object.entries(tile.buffers)) {
      const end = slice.byteOffset + slice.byteLength;
      if (slice.byteOffset < 0 || end > binLen) {
        throw new OctreeFormatError(
          `BufferSlice '${name}' [${slice.byteOffset}, ${end}) is out of bounds (bin is ${binLen} bytes)`,
        );
      }
    }

    // Verify content hash on raw bytes
    const actualHash = await sha256Hex(bin);
    if (actualHash !== tile.contentHashSha256) {
      throw new OctreeFormatError(
        `SHA-256 mismatch for tile ${key}: expected ${tile.contentHashSha256}, got ${actualHash}`,
      );
    }

    if (this._pool) {
      const token = createCancelToken();

      if (signal?.aborted) {
        token.cancel();
        return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      }

      const onAbort = (): void => token.cancel();
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        return await this._pool.dispatch(
          'octree.decode',
          { tile, idPrefix: this.idPrefix, bin },
          { transfer: [bin], token },
        );
      } catch (err) {
        if (err instanceof WorkerCancelledError) {
          throw signal?.reason ?? new DOMException('Aborted', 'AbortError');
        }
        throw err;
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    }

    const { batch } = decodeTile(bin, tile, this.idPrefix);
    return batch;
  }
}

/** Fetch + validate the manifest only (NOT the tiles). Tiles are fetched lazily by loadTile. */
export async function loadOctreePack(
  manifestUrl: string,
  opts?: LoadOctreeOptions,
): Promise<OctreeSource> {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  const pool = opts?.pool;

  const manifestRes = await fetchImpl(manifestUrl);
  if (!manifestRes.ok) {
    throw new Error(`Failed to fetch octree manifest: ${manifestRes.status} ${manifestRes.statusText}`);
  }

  const raw = (await manifestRes.json()) as { octreeFormatVersion?: unknown };

  if (raw.octreeFormatVersion !== OCTREE_FORMAT_VERSION) {
    throw new OctreeFormatError(
      `Unsupported octreeFormatVersion ${String(raw.octreeFormatVersion)}; expected ${String(OCTREE_FORMAT_VERSION)}`,
    );
  }

  const manifest = raw as unknown as OctreeManifest;

  if (!Array.isArray(manifest.tiles) || manifest.tiles.length === 0) {
    throw new OctreeFormatError('Manifest tiles must be a non-empty array');
  }

  return new OctreeSourceImpl(manifest, manifestUrl, fetchImpl, pool);
}
