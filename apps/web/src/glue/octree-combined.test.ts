import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import type {
  AppError,
  BufferSlice,
  MortonKey,
  OctreeTileManifest,
  StarBatch,
} from '@cosmos/core-types';
import { decodeMortonKey, encodeMortonKey, childCell } from '@cosmos/core-types';
import type { OctreeNode, OctreeSource } from '@cosmos/data';
import { __resetDiagnostics, setTransports } from '@cosmos/diagnostics';
import { assertTileContributions, combineOctreeSources } from './octree-combined';

/**
 * BUG-8 regression (docs/research/bug-8-combine-drops-source.md). `combineOctreeSources`
 * OR-ed child masks, so a node interior in EITHER source became interior in the union.
 * The policy's SSE descent then skips that node and loads the finer children — but the
 * source that TERMINATED there (a leaf) has no finer children, so its points vanish.
 * Bidirectional: the shallower source is always the victim (HYG under a deep Gaia pack,
 * Gaia under the shallow sample). These tests reproduce the drop against the original
 * owners-only rule and prove the push-down conserves every point.
 */

const ROOT_HALF = 8;
const EMPTY_SLICE: BufferSlice = { byteOffset: 0, byteLength: 0 };
const EMPTY_BUFFERS: OctreeTileManifest['buffers'] = {
  positionsPc: EMPTY_SLICE,
  absMag: EMPTY_SLICE,
  colorIndexBV: EMPTY_SLICE,
  catalogIds: EMPTY_SLICE,
  hipIds: EMPTY_SLICE,
};

/** Axis-aligned cube of a Morton key in root-half-extent units (matches pack ingest). */
function cellGeom(key: MortonKey): {
  center: readonly [number, number, number];
  half: number;
} {
  const { level, ix, iy, iz } = decodeMortonKey(key);
  const half = ROOT_HALF / 2 ** level;
  const axis = (i: number): number => -ROOT_HALF + half * (2 * i + 1);
  return { center: [axis(ix), axis(iy), axis(iz)], half };
}

interface Pt {
  readonly pos: readonly [number, number, number];
  readonly id: number;
}
interface NodeSpec {
  readonly childKeys: readonly MortonKey[];
  readonly points: readonly Pt[];
}

/** Build a faithful in-memory OctreeSource: getNode + loadTile that rebases absolute
 *  point positions to the node centre exactly as the real decoder does. */
function makeSource(idPrefix: string, specs: Map<MortonKey, NodeSpec>): OctreeSource {
  const nodes = new Map<MortonKey, OctreeNode>();
  for (const [key, spec] of specs) {
    const { center, half } = cellGeom(key);
    let childMask = 0;
    for (const ck of spec.childKeys) childMask |= 1 << (decodeMortonKey(ck).ix & 7); // mask presence (bit value irrelevant to these tests)
    const manifest: OctreeTileManifest = {
      key,
      isLeaf: spec.childKeys.length === 0,
      childMask: spec.childKeys.length === 0 ? 0 : childMask || 1,
      pointCount: spec.points.length,
      centerUnits: center,
      halfExtentUnits: half,
      binUrl: '',
      contentHashSha256: '',
      buffers: EMPTY_BUFFERS,
    };
    nodes.set(key, { key, manifest, childKeys: spec.childKeys });
  }
  const rootKey = [...specs.keys()][0]!;
  return {
    root: nodes.get(rootKey)!,
    context: 'galaxy',
    rootHalfExtentUnits: ROOT_HALF,
    idPrefix,
    getNode: (key) => nodes.get(key),
    loadTile: (key) => {
      const node = nodes.get(key);
      if (!node) return Promise.reject(new Error(`unknown ${key}`));
      const { center } = cellGeom(key);
      const pts = specs.get(key)!.points;
      const n = pts.length;
      const positionsPc = new Float32Array(n * 3);
      const catalogIds = new Uint32Array(n);
      for (let i = 0; i < n; i++) {
        positionsPc[i * 3] = pts[i]!.pos[0] - center[0];
        positionsPc[i * 3 + 1] = pts[i]!.pos[1] - center[1];
        positionsPc[i * 3 + 2] = pts[i]!.pos[2] - center[2];
        catalogIds[i] = pts[i]!.id;
      }
      const batch: StarBatch = {
        count: n,
        originPc: center,
        positionsPc,
        absMag: new Float32Array(n),
        colorIndexBV: new Float32Array(n),
        catalogIds,
        hipIds: new Uint32Array(n),
        idPrefix,
      };
      return Promise.resolve(batch);
    },
  };
}

/** Faithful copy of streaming/policy.ts selectOctree descent (SSE replaced by a depth
 *  cap): descend any interior node whose level < cap; otherwise it is a cut node. */
function cutKeys(combined: OctreeSource, cap: number): MortonKey[] {
  const out: MortonKey[] = [];
  const stack: MortonKey[] = [combined.root.key];
  while (stack.length > 0) {
    const key = stack.pop()!;
    const node = combined.getNode(key)!;
    const level = decodeMortonKey(key).level;
    if (node.childKeys.length > 0 && level < cap) stack.push(...node.childKeys);
    else out.push(key);
  }
  return out;
}

async function loadCut(combined: OctreeSource, keys: readonly MortonKey[]): Promise<StarBatch[]> {
  return Promise.all(keys.map((k) => combined.loadTile(k)));
}

/** Total points across loaded cut tiles whose catalog id is in [lo, hi] — provenance is
 *  carried by id range, NOT idPrefix (concat collapses idPrefix; a known BUG-8 follow-up). */
function countInIdRange(batches: readonly StarBatch[], lo: number, hi: number): number {
  let n = 0;
  for (const b of batches) for (let i = 0; i < b.count; i++) {
    const id = b.catalogIds[i]!;
    if (id >= lo && id <= hi) n++;
  }
  return n;
}

/** The ORIGINAL (pre-fix) rule: load only sources that own the exact cut key. */
async function legacyLoadCut(
  sources: readonly OctreeSource[],
  keys: readonly MortonKey[],
): Promise<StarBatch[]> {
  const out: StarBatch[] = [];
  for (const k of keys) {
    for (const s of sources) if (s.getNode(k) !== undefined) out.push(await s.loadTile(k));
  }
  return out;
}

// --- topology: SHALLOW source terminates at level 1; DEEP source subdivides to level 2 ---
//   shallow ids: 1000..1003 (4 points, one per occupied level-2 sub-cell of "1/0")
//   deep ids:    1..4
const L1 = '1/0' as MortonKey; // level-1 cell, cube [-8,0)^3, centre (-4,-4,-4)

/** Build [shallow, deep] sharing root + "1/0"; `deepChildren` are the level-2 leaves. */
function buildPair(): { shallow: OctreeSource; deep: OctreeSource; deepChildren: MortonKey[] } {
  // Four level-2 sub-cells of "1/0" and a shallow point sitting in each.
  const subCells: { key: MortonKey; pt: readonly [number, number, number] }[] = [
    { key: '', pt: [-7, -7, -7] },
    { key: '', pt: [-3, -7, -7] },
    { key: '', pt: [-7, -3, -7] },
    { key: '', pt: [-3, -3, -3] },
  ];
  // Resolve each point to the level-2 key whose cube contains it.
  for (const sc of subCells) {
    sc.key = level2KeyContaining(sc.pt);
  }
  const deepChildren = subCells.map((s) => s.key);

  const shallow = makeSource(
    'hyg',
    new Map<MortonKey, NodeSpec>([
      ['0/0' as MortonKey, { childKeys: [L1], points: [] }],
      [L1, { childKeys: [], points: subCells.map((s, i) => ({ pos: s.pt, id: 1000 + i })) }],
    ]),
  );

  const deepSpecs = new Map<MortonKey, NodeSpec>([
    ['0/0' as MortonKey, { childKeys: [L1], points: [] }],
    [L1, { childKeys: deepChildren, points: [] }],
  ]);
  deepChildren.forEach((key, i) => {
    const { center } = cellGeom(key);
    deepSpecs.set(key, { childKeys: [], points: [{ pos: center, id: i + 1 }] });
  });
  const deep = makeSource('gaia', deepSpecs);
  return { shallow, deep, deepChildren };
}

/** Brute-force the level-2 key whose half-open cube contains `pt`. */
function level2KeyContaining(pt: readonly [number, number, number]): MortonKey {
  for (const child of L2_CANDIDATES) {
    const { center, half } = cellGeom(child);
    if (
      pt[0] >= center[0] - half && pt[0] < center[0] + half &&
      pt[1] >= center[1] - half && pt[1] < center[1] + half &&
      pt[2] >= center[2] - half && pt[2] < center[2] + half
    ) return child;
  }
  throw new Error(`no level-2 cell contains ${pt.join(',')}`);
}
// All 8 level-2 children of "1/0".
const L2_CANDIDATES: MortonKey[] = (() => {
  const parent = decodeMortonKey(L1);
  const keys: MortonKey[] = [];
  for (let c = 0; c < 8; c++) keys.push(encodeMortonKey(childCell(parent, c)));
  return keys;
})();

describe('combineOctreeSources push-down (BUG-8)', () => {
  it('original owners-only rule DROPS the shallow source once the cut descends past it', async () => {
    const { shallow, deep } = buildPair();
    const combined = combineOctreeSources([shallow, deep]);
    const cut = cutKeys(combined, 2); // close camera → descend to level 2
    expect(cut.every((k) => decodeMortonKey(k).level === 2)).toBe(true);

    const legacy = await legacyLoadCut([shallow, deep], cut);
    expect(countInIdRange(legacy, 1, 4)).toBe(4); // deep survives
    expect(countInIdRange(legacy, 1000, 1003)).toBe(0); // BUG-8: shallow orphaned
  });

  it('push-down CONSERVES every shallow point across the deep cut', async () => {
    const { shallow, deep } = buildPair();
    const combined = combineOctreeSources([shallow, deep]);
    const cut = cutKeys(combined, 2);

    const loaded = await loadCut(combined, cut);
    expect(countInIdRange(loaded, 1, 4)).toBe(4); // deep intact
    expect(countInIdRange(loaded, 1000, 1003)).toBe(4); // shallow re-homed, not dropped
  });

  it('is order-independent (deep listed first)', async () => {
    const { shallow, deep } = buildPair();
    const combined = combineOctreeSources([deep, shallow]);
    const cut = cutKeys(combined, 2);
    const loaded = await loadCut(combined, cut);
    expect(countInIdRange(loaded, 1000, 1003)).toBe(4);
    expect(countInIdRange(loaded, 1, 4)).toBe(4);
  });

  it('no double-draw: each pushed point lands in exactly one cut cell', async () => {
    const { shallow, deep } = buildPair();
    const combined = combineOctreeSources([shallow, deep]);
    const cut = cutKeys(combined, 2);
    const loaded = await loadCut(combined, cut);
    // total shallow points across ALL cut cells equals the original count (no dup).
    expect(countInIdRange(loaded, 1000, 1003)).toBe(4);
  });

  it('far view (cut stops at the shared interior parent) loads both sources', async () => {
    const { shallow, deep } = buildPair();
    const combined = combineOctreeSources([shallow, deep]);
    const cut = cutKeys(combined, 1); // stop at level 1 → the shared "1/0" node
    expect(cut).toEqual([L1]);
    const loaded = await loadCut(combined, cut);
    // shallow owns "1/0" (its leaf) → its 4 points; deep is interior here → 0 own points.
    expect(countInIdRange(loaded, 1000, 1003)).toBe(4);
  });

  it('single source is a pass-through', () => {
    const { shallow } = buildPair();
    expect(combineOctreeSources([shallow])).toBe(shallow);
  });
});

/**
 * TASK-058: the BUG-8 drop is now an asserted post-condition. `assertTileContributions`
 * is the cheap per-tile guard `loadTile` runs — a source terminating in a non-empty leaf
 * above the cut MUST contribute a (possibly empty) batch, never `null`.
 */
describe('combineOctreeSources BUG-8 invariant (TASK-058)', () => {
  const reports: AppError[] = [];

  beforeEach(() => {
    __resetDiagnostics();
    reports.length = 0;
    setTransports([(e) => reports.push(e)]);
  });
  afterEach(() => {
    setTransports([]);
    __resetDiagnostics();
  });

  const dummyBatch = (idPrefix: string): StarBatch => ({
    count: 0,
    originPc: [0, 0, 0],
    positionsPc: new Float32Array(0),
    absMag: new Float32Array(0),
    colorIndexBV: new Float32Array(0),
    catalogIds: new Uint32Array(0),
    hipIds: new Uint32Array(0),
    idPrefix,
  });

  it('OLD owners-only drop (leaf source → null batch) trips assertInvariant in DEV', () => {
    // The pre-fix rule returned null for a non-owner; reproduce that shape.
    expect(() =>
      assertTileContributions('2/0' as MortonKey, [
        { idPrefix: 'gaia', expectedFromLeaf: true, batch: dummyBatch('gaia') },
        { idPrefix: 'hyg', expectedFromLeaf: true, batch: null }, // orphaned shallow source
      ]),
    ).toThrow(/orphaned source "hyg"/);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.kind).toBe('invariant');
    expect(reports[0]?.context?.source).toBe('hyg');
  });

  it('push-down case (every leaf source attempted, even if empty) does NOT trip', () => {
    // An attempted-but-empty sibling cell is a non-null batch → legitimate, must pass.
    expect(() =>
      assertTileContributions('2/0' as MortonKey, [
        { idPrefix: 'gaia', expectedFromLeaf: true, batch: dummyBatch('gaia') },
        { idPrefix: 'hyg', expectedFromLeaf: true, batch: dummyBatch('hyg') },
      ]),
    ).not.toThrow();
    expect(reports).toHaveLength(0);
  });

  it('a source genuinely absent from the cut (expectedFromLeaf:false) is not a drop', () => {
    expect(() =>
      assertTileContributions('2/0' as MortonKey, [
        { idPrefix: 'gaia', expectedFromLeaf: true, batch: dummyBatch('gaia') },
        { idPrefix: 'hyg', expectedFromLeaf: false, batch: null }, // pruned/decimated → fine
      ]),
    ).not.toThrow();
    expect(reports).toHaveLength(0);
  });

  it('the real push-down load reports zero invariants (happy path is a no-op)', async () => {
    const { shallow, deep } = buildPair();
    const combined = combineOctreeSources([shallow, deep]);
    await loadCut(combined, cutKeys(combined, 2));
    expect(reports).toHaveLength(0);
  });
});
