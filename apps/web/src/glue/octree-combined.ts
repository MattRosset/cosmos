/**
 * Combined octree source (TASK-052, ADR-006 §5). The frozen `createStreamingPolicy`
 * consumes ONE `OctreeSource`; M4a must stream the HYG octree AND the Gaia DR3 octree
 * through the SAME policy (ADR-006 §5.2 "no catalog drawn twice", and a single visible
 * cut so `catalogCoverage()` reflects both). Both packs are emitted at the same
 * `rootHalfExtentUnits` and `context` (ADR-006 §4), so they share a Morton frame: a
 * tile key denotes the identical cell in either tree.
 *
 * This is app glue, not a parallel loader path — each tree is still loaded by the one
 * `loadOctreePack` (handoff §4); we only merge the resolved sources into a unified tree
 * the policy can walk. A node merges to the union of child keys + summed point count; a
 * tile loads from whichever trees carry that key and concatenates the decoded batches
 * (identical `originPc` since `centerUnits` is keyed by the shared cell, so no rebasing).
 */
import type { MortonKey, OctreeManifest, OctreeTileManifest, StarBatch } from '@cosmos/core-types';
import type { OctreeNode, OctreeSource } from '@cosmos/data';

/** Union of child keys across trees, preserving Morton order and de-duplicating. */
function unionChildKeys(nodes: readonly OctreeNode[]): readonly MortonKey[] {
  const seen = new Set<MortonKey>();
  const out: MortonKey[] = [];
  for (const n of nodes) {
    for (const k of n.childKeys) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

/** Merge the per-tree nodes for one key into a single node the policy can read. */
function mergeNode(key: MortonKey, nodes: readonly OctreeNode[]): OctreeNode {
  const first = nodes[0]!;
  let pointCount = 0;
  let childMask = 0;
  for (const n of nodes) {
    pointCount += n.manifest.pointCount;
    childMask |= n.manifest.childMask;
  }
  // centerUnits / halfExtentUnits are fixed by the key (shared frame), so the first
  // tree's values are authoritative; only the aggregate counts differ.
  const manifest: OctreeTileManifest = {
    ...first.manifest,
    pointCount,
    childMask,
    isLeaf: childMask === 0,
  };
  return { key, manifest, childKeys: unionChildKeys(nodes) };
}

/** Concatenate decoded tile batches that share an origin into one batch. */
function concatBatches(batches: readonly StarBatch[]): StarBatch {
  if (batches.length === 1) return batches[0]!;
  let count = 0;
  for (const b of batches) count += b.count;
  const positionsPc = new Float32Array(count * 3);
  const absMag = new Float32Array(count);
  const colorIndexBV = new Float32Array(count);
  const catalogIds = new Uint32Array(count);
  const hipIds = new Uint32Array(count);
  let p = 0;
  for (const b of batches) {
    positionsPc.set(b.positionsPc.subarray(0, b.count * 3), p * 3);
    absMag.set(b.absMag.subarray(0, b.count), p);
    colorIndexBV.set(b.colorIndexBV.subarray(0, b.count), p);
    catalogIds.set(b.catalogIds.subarray(0, b.count), p);
    hipIds.set(b.hipIds.subarray(0, b.count), p);
    p += b.count;
  }
  return {
    count,
    originPc: batches[0]!.originPc,
    positionsPc,
    absMag,
    colorIndexBV,
    catalogIds,
    hipIds,
    idPrefix: batches[0]!.idPrefix,
  };
}

/**
 * Combine ≥ 1 octree sources sharing a frame into one. With a single source this is a
 * pass-through (the HYG-only / debug paths); with two it presents the unified tree.
 */
export function combineOctreeSources(sources: readonly OctreeSource[]): OctreeSource {
  if (sources.length === 0) throw new Error('combineOctreeSources: no sources');
  if (sources.length === 1) return sources[0]!;

  const head = sources[0]!;
  for (const s of sources) {
    if (s.context !== head.context || s.rootHalfExtentUnits !== head.rootHalfExtentUnits) {
      throw new Error(
        'combineOctreeSources: sources must share context + rootHalfExtentUnits (ADR-006 §4)',
      );
    }
  }

  const nodeCache = new Map<MortonKey, OctreeNode | undefined>();

  function getNode(key: MortonKey): OctreeNode | undefined {
    if (nodeCache.has(key)) return nodeCache.get(key);
    const present: OctreeNode[] = [];
    for (const s of sources) {
      const n = s.getNode(key);
      if (n !== undefined) present.push(n);
    }
    const merged = present.length === 0 ? undefined : mergeNode(key, present);
    nodeCache.set(key, merged);
    return merged;
  }

  const root = getNode(head.root.key);
  if (root === undefined) throw new Error('combineOctreeSources: missing shared root');

  return {
    root,
    context: head.context as OctreeManifest['context'],
    rootHalfExtentUnits: head.rootHalfExtentUnits,
    idPrefix: head.idPrefix,
    getNode,
    async loadTile(key: MortonKey, opts?: { readonly signal?: AbortSignal }): Promise<StarBatch> {
      const owners = sources.filter((s) => s.getNode(key) !== undefined);
      if (owners.length === 0) throw new Error(`combineOctreeSources: unknown key ${key}`);
      const batches = await Promise.all(owners.map((s) => s.loadTile(key, opts)));
      return concatBatches(batches);
    },
  };
}
