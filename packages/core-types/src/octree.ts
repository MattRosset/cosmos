import type { BufferSlice } from './packs';
import type { ContextId } from './coords';

export const OCTREE_FORMAT_VERSION = 1;
/** ADR-003 §2: level cap (≤ 21 by Morton width; Phase 3 caps lower). */
export const MAX_OCTREE_LEVEL = 16;
/** ADR-003 §3: split thresholds (whichever binds first). */
export const MAX_POINTS_PER_TILE = 32768;
export const MAX_TILE_BYTES = 512 * 1024;
/** ADR-003 §3: decimated representative point count on internal tiles. */
export const INTERNAL_TILE_POINTS = 4096;

/** ADR-003 §2: node id as "<level>/<mortonDecimal>", e.g. "3/427". */
export type MortonKey = string;

/** Cell indices from the root cube's MIN corner, ix,iy,iz ∈ [0, 2^level). */
export interface OctreeCell {
  readonly level: number;
  readonly ix: number;
  readonly iy: number;
  readonly iz: number;
}

/** Spread bits of v: bit i → position 3i, using BigInt to avoid overflow above level 10. */
function spread3(v: bigint): bigint {
  let r = 0n;
  for (let i = 0n; i < 21n; i++) {
    r |= ((v >> i) & 1n) << (3n * i);
  }
  return r;
}

/** Compact bits: pick every 3rd bit — bit 3i → position i. Inverse of spread3. */
function compact3(v: bigint): bigint {
  let r = 0n;
  for (let i = 0n; i < 21n; i++) {
    r |= ((v >> (3n * i)) & 1n) << i;
  }
  return r;
}

/** Interleave (x = LSB of each triplet) → "<level>/<bigint decimal>". Pure. */
export function encodeMortonKey(cell: OctreeCell): MortonKey {
  const code =
    spread3(BigInt(cell.ix)) |
    (spread3(BigInt(cell.iy)) << 1n) |
    (spread3(BigInt(cell.iz)) << 2n);
  return `${cell.level}/${code.toString(10)}`;
}

/** Inverse of encodeMortonKey. Throws RangeError on malformed input. */
export function decodeMortonKey(key: MortonKey): OctreeCell {
  const slash = key.indexOf('/');
  if (slash === -1) throw new RangeError(`Malformed MortonKey: "${key}"`);
  const level = parseInt(key.slice(0, slash), 10);
  if (Number.isNaN(level) || level < 0 || level > MAX_OCTREE_LEVEL) {
    throw new RangeError(`Malformed MortonKey level: "${key}"`);
  }
  const code = BigInt(key.slice(slash + 1));
  return {
    level,
    ix: Number(compact3(code)),
    iy: Number(compact3(code >> 1n)),
    iz: Number(compact3(code >> 2n)),
  };
}

/** ADR-003 §2 child order: c∈[0,7], ix'=ix*2+(c&1), iy'=iy*2+((c>>1)&1),
 *  iz'=iz*2+((c>>2)&1). Throws if cell.level >= MAX_OCTREE_LEVEL. */
export function childCell(cell: OctreeCell, child: number): OctreeCell {
  if (cell.level >= MAX_OCTREE_LEVEL) {
    throw new RangeError(
      `Cannot descend below MAX_OCTREE_LEVEL (${MAX_OCTREE_LEVEL})`,
    );
  }
  return {
    level: cell.level + 1,
    ix: cell.ix * 2 + (child & 1),
    iy: cell.iy * 2 + ((child >> 1) & 1),
    iz: cell.iz * 2 + ((child >> 2) & 1),
  };
}

/** Parent cell (level-1). Throws RangeError if cell.level === 0. */
export function parentCell(cell: OctreeCell): OctreeCell {
  if (cell.level === 0) throw new RangeError('Root cell (level 0) has no parent');
  return {
    level: cell.level - 1,
    ix: cell.ix >> 1,
    iy: cell.iy >> 1,
    iz: cell.iz >> 1,
  };
}

/** Reuses the same attribute layout as StarPackManifest.buffers (ADR-003 §3). */
export interface OctreeTileBuffers {
  /** Float32Array, 3 × pointCount, context units RELATIVE to the node center. */
  readonly positionsPc: BufferSlice;
  /** Float32Array, pointCount — absolute visual magnitude. */
  readonly absMag: BufferSlice;
  /** Float32Array, pointCount — B–V color index. */
  readonly colorIndexBV: BufferSlice;
  /** Uint32Array, pointCount — source-catalog id. */
  readonly catalogIds: BufferSlice;
  /** Uint32Array, pointCount — Hipparcos number, 0 = none. */
  readonly hipIds: BufferSlice;
}

export interface OctreeTileManifest {
  readonly key: MortonKey;
  readonly isLeaf: boolean;
  /** ADR-003 §4: bit c set ⇒ child c exists. 0 on leaves. */
  readonly childMask: number;
  readonly pointCount: number;
  /** Node cube center, CONTEXT UNITS (galaxy ⇒ parsecs), f64. */
  readonly centerUnits: readonly [number, number, number];
  /** Half side length of the node cube, context units, f64. */
  readonly halfExtentUnits: number;
  /** URL relative to the octree manifest's location. */
  readonly binUrl: string;
  /** Lowercase hex SHA-256 of this tile's .bin (reproducible builds, §11). */
  readonly contentHashSha256: string;
  readonly buffers: OctreeTileBuffers;
}

export interface OctreeManifest {
  readonly octreeFormatVersion: typeof OCTREE_FORMAT_VERSION;
  /** Source catalog tag, e.g. "gaia-dr3-bright". */
  readonly source: string;
  /** Context the tree lives in (Phase 3: 'galaxy'). */
  readonly context: ContextId;
  /** ADR-003 §1: root cube half-extent, context units (power of two). */
  readonly rootHalfExtentUnits: number;
  /** BodyId of point i in any tile = `${idPrefix}:${catalogIds[i]}`. */
  readonly idPrefix: string;
  /** Every node in the tree (root first), keyed by MortonKey for the loader. */
  readonly tiles: readonly OctreeTileManifest[];
}
