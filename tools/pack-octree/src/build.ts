import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_OCTREE_LEVEL,
  MAX_POINTS_PER_TILE,
  MAX_TILE_BYTES,
  INTERNAL_TILE_POINTS,
  OCTREE_FORMAT_VERSION,
  encodeMortonKey,
  childCell as childCellFn,
} from '@cosmos/core-types';
import type { OctreeCell, OctreeManifest, OctreeTileManifest } from '@cosmos/core-types';
import { encodeTile } from './encode';
import { OctreeManifestSchema } from './schema';

export interface StarData {
  /** Absolute galaxy-frame parsecs. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly absMag: number;
  readonly colorIndexBV: number;
  readonly catalogId: number;
  readonly hipId: number;
}

export interface BuildOptions {
  /** Root cube half-extent in context units (must be power of two). Default: 65536. */
  rootHalfExtent?: number;
  /** Source catalog tag written into the manifest. Default: 'hyg-v41-octree'. */
  source?: string;
  /** idPrefix written into the manifest. Default: 'hyg-v41'. */
  idPrefix?: string;
  /** Override split threshold (for tests). Default: MAX_POINTS_PER_TILE. */
  maxPointsPerTile?: number;
  /** Override byte budget per tile (for tests). Default: MAX_TILE_BYTES. */
  maxTileBytes?: number;
  /** Override internal decimation count (for tests). Default: INTERNAL_TILE_POINTS. */
  internalTilePoints?: number;
}

/** positionsPc(3×f32) + absMag(f32) + colorIndexBV(f32) + catalogIds(u32) + hipIds(u32) */
const BYTES_PER_STAR = (3 + 1 + 1 + 1 + 1) * 4;

interface OctreeNode {
  cell: OctreeCell;
  center: readonly [number, number, number];
  halfExtent: number;
  /** ALL star indices in this subtree (kept on internal nodes for decimation). */
  starIndices: number[];
  /** null = leaf; array of 8 (some null) = internal. */
  children: (OctreeNode | null)[] | null;
  /** Stars actually encoded in this tile's .bin (set after decimation pass). */
  tileIndices: number[];
}

/**
 * Build a Morton-keyed linear octree from a flat star array and write tile .bin
 * files + octree.json into outDir.  Returns the validated OctreeManifest.
 *
 * ADR-003 §1–§4 semantics are transcribed verbatim; see the ADR for rationale.
 * Terminal leaves at MAX_OCTREE_LEVEL may legally exceed the point budget.
 */
export function buildOctree(
  stars: StarData[],
  outDir: string,
  options: BuildOptions = {},
): OctreeManifest {
  const rootHalfExtent = options.rootHalfExtent ?? 65536;
  const source = options.source ?? 'hyg-v41-octree';
  const idPrefix = options.idPrefix ?? 'hyg-v41';
  const maxPts = options.maxPointsPerTile ?? MAX_POINTS_PER_TILE;
  const maxBytes = options.maxTileBytes ?? MAX_TILE_BYTES;
  const internalPts = options.internalTilePoints ?? INTERNAL_TILE_POINTS;

  if (rootHalfExtent <= 0 || (rootHalfExtent & (rootHalfExtent - 1)) !== 0) {
    throw new RangeError(`rootHalfExtent must be a power of two, got ${rootHalfExtent}`);
  }

  // --- Phase 1: split tree (BFS) ---
  const root: OctreeNode = {
    cell: { level: 0, ix: 0, iy: 0, iz: 0 },
    center: [0, 0, 0],
    halfExtent: rootHalfExtent,
    starIndices: stars.map((_, i) => i),
    children: null,
    tileIndices: [],
  };

  const splitQueue: OctreeNode[] = [root];
  while (splitQueue.length > 0) {
    const node = splitQueue.shift()!;
    const n = node.starIndices.length;
    const shouldSplit =
      (n > maxPts || n * BYTES_PER_STAR > maxBytes) && node.cell.level < MAX_OCTREE_LEVEL;

    if (!shouldSplit) continue;

    node.children = Array(8).fill(null) as (OctreeNode | null)[];
    const buckets: number[][] = Array.from({ length: 8 }, () => []);

    for (const si of node.starIndices) {
      const s = stars[si]!;
      const bx = s.x >= node.center[0] ? 1 : 0;
      const by = s.y >= node.center[1] ? 1 : 0;
      const bz = s.z >= node.center[2] ? 1 : 0;
      // ADR-003 §2 child order: c = (ix_bit) | (iy_bit << 1) | (iz_bit << 2)
      const c = bx | (by << 1) | (bz << 2);
      buckets[c]!.push(si);
    }

    const childHalf = node.halfExtent / 2;
    for (let c = 0; c < 8; c++) {
      if (buckets[c]!.length === 0) continue;
      const cc = childCellFn(node.cell, c);
      const childCenter: [number, number, number] = [
        node.center[0] + ((c & 1) ? childHalf : -childHalf),
        node.center[1] + (((c >> 1) & 1) ? childHalf : -childHalf),
        node.center[2] + (((c >> 2) & 1) ? childHalf : -childHalf),
      ];
      const child: OctreeNode = {
        cell: cc,
        center: childCenter,
        halfExtent: childHalf,
        starIndices: buckets[c]!,
        children: null,
        tileIndices: [],
      };
      node.children[c] = child;
      splitQueue.push(child);
    }
    // node.starIndices is kept for internal-tile decimation below
  }

  // --- Phase 2: collect BFS order (root first) ---
  const allNodes: OctreeNode[] = [];
  const bfsQueue: OctreeNode[] = [root];
  while (bfsQueue.length > 0) {
    const node = bfsQueue.shift()!;
    allNodes.push(node);
    if (node.children) {
      for (const child of node.children) {
        if (child) bfsQueue.push(child);
      }
    }
  }

  // --- Phase 3: compute tileIndices (leaf = own points; internal = decimated subset) ---
  for (const node of allNodes) {
    if (!node.children) {
      node.tileIndices = node.starIndices;
    } else {
      // Brightest-N by (absMag ASC, catalogId ASC) from the entire subtree (ADR-003 §3).
      const allPts = collectLeafPoints(node);
      allPts.sort((a, b) => {
        const da = stars[a]!.absMag - stars[b]!.absMag;
        if (da !== 0) return da;
        return stars[a]!.catalogId - stars[b]!.catalogId;
      });
      node.tileIndices = allPts.slice(0, Math.min(internalPts, allPts.length));
    }
  }

  // --- Phase 4: encode tiles and build manifest ---
  const tilesDir = join(outDir, 'tiles');
  mkdirSync(tilesDir, { recursive: true });

  const tileMans: OctreeTileManifest[] = [];
  for (const node of allNodes) {
    const key = encodeMortonKey(node.cell);
    const isLeaf = !node.children;
    let childMask = 0;
    if (node.children) {
      for (let c = 0; c < 8; c++) {
        if (node.children[c]) childMask |= 1 << c;
      }
    }

    const { bin, buffers, contentHashSha256 } = encodeTile(stars, node.tileIndices, node.center);

    const mortonDecimal = key.slice(key.indexOf('/') + 1);
    const tileFilename = `${node.cell.level}_${mortonDecimal}.bin`;
    writeFileSync(join(tilesDir, tileFilename), bin);

    tileMans.push({
      key,
      isLeaf,
      childMask,
      pointCount: node.tileIndices.length,
      centerUnits: [...node.center] as [number, number, number],
      halfExtentUnits: node.halfExtent,
      binUrl: `tiles/${tileFilename}`,
      contentHashSha256,
      buffers,
    });
  }

  const manifest: OctreeManifest = {
    octreeFormatVersion: OCTREE_FORMAT_VERSION,
    source,
    context: 'galaxy',
    rootHalfExtentUnits: rootHalfExtent,
    idPrefix,
    tiles: tileMans,
  };

  // --- Phase 5: validate and write manifest ---
  const result = OctreeManifestSchema.safeParse(manifest);
  if (!result.success) {
    throw new Error(`Manifest validation failed:\n${JSON.stringify(result.error.issues, null, 2)}`);
  }

  writeFileSync(join(outDir, 'octree.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function collectLeafPoints(node: OctreeNode): number[] {
  if (!node.children) return node.starIndices.slice();
  const pts: number[] = [];
  for (const child of node.children) {
    if (child) pts.push(...collectLeafPoints(child));
  }
  return pts;
}
