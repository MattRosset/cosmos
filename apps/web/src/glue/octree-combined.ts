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
import { decodeMortonKey, encodeMortonKey, parentCell } from '@cosmos/core-types';
import type { OctreeNode, OctreeSource } from '@cosmos/data';
import { assertInvariant } from '@cosmos/diagnostics';

/** Per-source outcome of loading one combined cut tile — the input to the BUG-8
 *  post-condition (TASK-058). */
export interface TileContribution {
  /** Source provenance, for the diagnostic message. */
  readonly idPrefix: string;
  /** The source terminates in a NON-EMPTY leaf covering this cut cell, so the
   *  push-down is obliged to represent it (BUG-8). A source that is genuinely
   *  absent from the cut region is `false` — NOT a dropped source. */
  readonly expectedFromLeaf: boolean;
  /** The combined load produced a (possibly empty) batch for this source, or
   *  `null` when nothing was attempted. */
  readonly batch: StarBatch | null;
}

/**
 * Post-condition for one combined cut tile (TASK-058, BUG-8 class). Every source
 * that terminates in a non-empty LEAF above the cut MUST have been attempted (a
 * non-null batch — possibly `count: 0` if its points fell into a sibling cell);
 * the pre-fix owners-only rule returned `null` here, silently orphaning the
 * shallower catalog (HYG under a deep Gaia pack, or vice-versa).
 *
 * DEV throws (surfaces in the ErrorBoundary / e2e); prod reports `kind:'invariant'`
 * and continues to degrade. No-op on the happy path; cheap (reuses the already
 * computed ancestor) — no re-scan. It deliberately does NOT fire on an empty
 * sibling cell: an attempted-but-empty push-down is a non-null batch, so it passes.
 */
export function assertTileContributions(
  key: MortonKey,
  contributions: readonly TileContribution[],
): void {
  for (const c of contributions) {
    assertInvariant(
      !c.expectedFromLeaf || c.batch !== null,
      `combineOctreeSources orphaned source "${c.idPrefix}" at cut ${key}: a non-empty leaf above the cut contributed nothing (BUG-8 class)`,
      { key, source: c.idPrefix },
    );
  }
}

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

/**
 * Push-down (BUG-8 fix, docs/research/bug-8-combine-drops-source.md). When the cut
 * descends past the level at which a source TERMINATES (its deepest LEAF), that
 * source's points live in an ancestor node the policy no longer draws — they vanish.
 * Octree cells partition space, so every point of the leaf ancestor falls into exactly
 * ONE descendant cut cell. This re-homes the subset of `ancestor`'s points that lie
 * inside cut cell `cellCenter ± cellHalf`, rebased to the cell's origin so it concatenates
 * with the owning source's own tile (identical `originPc`, no double draw).
 */
function pushDownToCell(
  ancestor: StarBatch,
  cellCenter: readonly [number, number, number],
  cellHalf: number,
): StarBatch {
  const n = ancestor.count;
  const ox = ancestor.originPc[0]!;
  const oy = ancestor.originPc[1]!;
  const oz = ancestor.originPc[2]!;
  // Half-open bounds [c-h, c+h) per axis ⇒ a point on a shared face lands in exactly
  // one sibling cell (no duplication across the partition).
  const loX = cellCenter[0] - cellHalf, hiX = cellCenter[0] + cellHalf;
  const loY = cellCenter[1] - cellHalf, hiY = cellCenter[1] + cellHalf;
  const loZ = cellCenter[2] - cellHalf, hiZ = cellCenter[2] + cellHalf;

  // Two passes: count survivors, then fill (avoids growing typed arrays).
  const keep = new Uint32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) {
    const ax = ox + ancestor.positionsPc[i * 3]!;
    const ay = oy + ancestor.positionsPc[i * 3 + 1]!;
    const az = oz + ancestor.positionsPc[i * 3 + 2]!;
    if (ax >= loX && ax < hiX && ay >= loY && ay < hiY && az >= loZ && az < hiZ) {
      keep[m++] = i;
    }
  }

  const positionsPc = new Float32Array(m * 3);
  const absMag = new Float32Array(m);
  const colorIndexBV = new Float32Array(m);
  const catalogIds = new Uint32Array(m);
  const hipIds = new Uint32Array(m);
  for (let j = 0; j < m; j++) {
    const i = keep[j]!;
    // Rebase to the cut cell's centre so the pushed points share the cell's originPc.
    positionsPc[j * 3] = ox + ancestor.positionsPc[i * 3]! - cellCenter[0];
    positionsPc[j * 3 + 1] = oy + ancestor.positionsPc[i * 3 + 1]! - cellCenter[1];
    positionsPc[j * 3 + 2] = oz + ancestor.positionsPc[i * 3 + 2]! - cellCenter[2];
    absMag[j] = ancestor.absMag[i]!;
    colorIndexBV[j] = ancestor.colorIndexBV[i]!;
    catalogIds[j] = ancestor.catalogIds[i]!;
    hipIds[j] = ancestor.hipIds[i]!;
  }
  return {
    count: m,
    originPc: cellCenter,
    positionsPc,
    absMag,
    colorIndexBV,
    catalogIds,
    hipIds,
    idPrefix: ancestor.idPrefix,
  };
}

/** Concatenate decoded tile batches that share an origin into one batch. Empty
 *  parts (a push-down that re-homed zero points) are dropped first so they neither
 *  allocate nor disturb the shared `originPc`. */
function concatBatches(input: readonly StarBatch[]): StarBatch {
  const batches = input.filter((b) => b.count > 0);
  if (batches.length === 1) return batches[0]!;
  if (batches.length === 0) {
    const head = input[0]!; // ≥1 part always passed in; keep its origin/prefix for the empty result.
    return {
      count: 0,
      originPc: head.originPc,
      positionsPc: new Float32Array(0),
      absMag: new Float32Array(0),
      colorIndexBV: new Float32Array(0),
      catalogIds: new Uint32Array(0),
      hipIds: new Uint32Array(0),
      idPrefix: head.idPrefix,
    };
  }
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

  /** Deepest node `s` actually has on the path from `key` up to the root. The cut may
   *  sit below where `s` terminates; that terminal node (if a LEAF) is the one whose
   *  points must be pushed down into `key`. Returns null if `s` has nothing on the path. */
  function deepestAncestorNode(s: OctreeSource, key: MortonKey): OctreeNode | null {
    let cell = decodeMortonKey(key);
    for (;;) {
      const n = s.getNode(encodeMortonKey(cell));
      if (n !== undefined) return n;
      if (cell.level === 0) return null;
      cell = parentCell(cell);
    }
  }

  // Decoded-batch cache (per source+key): a shallow leaf ancestor is shared by many
  // sibling cut cells, so decode it ONCE (handoff §4 / BUG-8: "fetched once across
  // sibling cut cells") and filter the cached batch per cell.
  const decodeCache = new Map<string, Promise<StarBatch>>();
  function loadCached(s: OctreeSource, si: number, key: MortonKey): Promise<StarBatch> {
    const ck = `${si}|${key}`;
    let p = decodeCache.get(ck);
    if (p === undefined) {
      // NB: deliberately NOT forwarding the cut cell's AbortSignal — a shared ancestor
      // must outlive any single cut cell's abort. Per-cell aborts are handled by the
      // policy discarding the result, not by cancelling the shared fetch.
      p = s.loadTile(key);
      decodeCache.set(ck, p);
    }
    return p;
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
      const cutNode = getNode(key);
      if (cutNode === undefined) throw new Error(`combineOctreeSources: unknown key ${key}`);
      const cellCenter = cutNode.manifest.centerUnits;
      const cellHalf = cutNode.manifest.halfExtentUnits;

      const contributions = await Promise.all(
        sources.map(async (s, si): Promise<TileContribution> => {
          // (a) Source owns this exact cut node → load its own tile.
          const own = s.getNode(key);
          if (own !== undefined) {
            return {
              idPrefix: s.idPrefix,
              expectedFromLeaf: own.manifest.isLeaf && own.manifest.pointCount > 0,
              batch: await s.loadTile(key, opts),
            };
          }
          // (b) Source terminates above the cut. Push down its deepest LEAF ancestor's
          //     points (BUG-8). An INTERNAL ancestor means the source pruned its subtree
          //     toward `key` (only a decimated rep exists) → nothing real to contribute.
          const anc = deepestAncestorNode(s, key);
          const expectedFromLeaf = anc !== null && anc.manifest.isLeaf && anc.manifest.pointCount > 0;
          if (anc === null || !anc.manifest.isLeaf) {
            return { idPrefix: s.idPrefix, expectedFromLeaf: false, batch: null };
          }
          const ancBatch = await loadCached(s, si, anc.key);
          return { idPrefix: s.idPrefix, expectedFromLeaf, batch: pushDownToCell(ancBatch, cellCenter, cellHalf) };
        }),
      );

      // Post-condition (TASK-058): no non-empty leaf above this cut was silently dropped.
      assertTileContributions(key, contributions);

      const batches = contributions.map((c) => c.batch).filter((b): b is StarBatch => b !== null);
      if (batches.length === 0) throw new Error(`combineOctreeSources: unknown key ${key}`);
      return concatBatches(batches);
    },
  };
}
