import { describe, it, expect } from 'vitest';
import type { GalaxyGenParams, OctreeTileManifest, StarBatch } from '@cosmos/core-types';
import { encodeMortonKey, childCell } from '@cosmos/core-types';
import { createScaleFrameTree, createOriginManager } from '@cosmos/coords';
import type { OriginManager } from '@cosmos/coords';
import type { OctreeNode, OctreeSource } from '@cosmos/data';
import { createStreamingPolicy } from '../src/index.js';
import type { StreamingPolicy } from '../src/index.js';
import { createFakePool } from './helpers/fake-pool.js';
import type { FakePool } from './helpers/fake-pool.js';
import { tick } from './helpers/octree-fixture.js';

// ===========================================================================
// A hand-rolled fake OctreeSource that gives the test full control over the
// chosen cut (root descends to its terminal leaves) and exactly which tiles are
// READY. Tile geometry (center + half-extent) is set per leaf so the test can
// shape the projected-area weighting independently of the Morton layout.
// ===========================================================================
const ROOT = { level: 0, ix: 0, iy: 0, iz: 0 } as const;
const rootKey = encodeMortonKey(ROOT);
const childKey = (c: number): string => encodeMortonKey(childCell(ROOT, c));

interface LeafSpec {
  center: readonly [number, number, number];
  halfExtent: number;
  pointCount: number;
}

function makeNode(
  key: string,
  center: readonly [number, number, number],
  halfExtent: number,
  pointCount: number,
  childKeys: readonly string[],
): OctreeNode {
  return {
    key,
    childKeys,
    manifest: {
      key,
      isLeaf: childKeys.length === 0,
      childMask: 0,
      pointCount,
      centerUnits: center,
      halfExtentUnits: halfExtent,
    } as unknown as OctreeTileManifest,
  };
}

interface FakeOctree extends OctreeSource {
  /** Resolve the pending loadTile for `key`, flipping that chunk to READY. */
  ready(key: string): void;
  readonly leafKeys: readonly string[];
}

/**
 * Root cube straddles the camera so its SSE is effectively infinite ⇒ it always
 * descends; the leaves are terminal (no children) ⇒ they are always the cut. The
 * root tile itself is dispatched but deliberately never resolved here, so leaf
 * coverage is isolated (an unready leaf has no ready ancestor).
 */
function createFakeOctree(leaves: readonly LeafSpec[]): FakeOctree {
  const leafKeys = leaves.map((_, i) => childKey(i));
  const nodes: OctreeNode[] = [
    makeNode(rootKey, [0, 0, 0], 1000, 4, leafKeys),
    ...leaves.map((l, i) => makeNode(leafKeys[i]!, l.center, l.halfExtent, l.pointCount, [])),
  ];
  const map = new Map(nodes.map((n) => [n.key, n] as const));
  const resolvers = new Map<string, (b: StarBatch) => void>();

  return {
    root: map.get(rootKey)!,
    context: 'galaxy',
    rootHalfExtentUnits: 1000,
    idPrefix: 'fake',
    leafKeys,
    getNode: (k) => map.get(k),
    loadTile: (k) =>
      new Promise<StarBatch>((resolve) => {
        resolvers.set(k, resolve);
      }),
    ready(k) {
      const r = resolvers.get(k);
      if (!r) return;
      resolvers.delete(k);
      r({ count: map.get(k)!.manifest.pointCount } as unknown as StarBatch);
    },
  };
}

interface Ctx {
  policy: StreamingPolicy;
  origin: OriginManager;
  octree: FakeOctree;
  pool: FakePool;
}

function makeCtx(
  leaves: readonly LeafSpec[],
  procgen?: ReadonlyMap<string, GalaxyGenParams>,
): Ctx {
  const octree = createFakeOctree(leaves);
  const pool = createFakePool();
  const tree = createScaleFrameTree();
  const origin = createOriginManager(tree, { context: 'galaxy', local: [0, 0, 0] });
  const policy = createStreamingPolicy({
    origin,
    pool,
    octree,
    ...(procgen ? { procgenGalaxies: procgen } : {}),
    // Dispatch the whole little tree in one frame; coverage never depends on the cap.
    budgets: { maxInFlight: 64 },
  });
  return { policy, origin, octree, pool };
}

/**
 * One frame: first drain any just-resolved tile (so its `onReady` flips the chunk
 * to READY before this `update()` recomputes coverage), settle the camera, update,
 * then drain again so freshly dispatched `loadTile` promises are registered.
 */
async function frame(ctx: Ctx): Promise<void> {
  await tick(2);
  ctx.origin.setCameraPosition({ context: 'galaxy', local: [0, 0, 0] });
  ctx.policy.update(1080, 1000);
  await tick(2);
}

// Two equal-area leaves (same extent, same distance) so an unweighted and an
// area-weighted half are the same number — used for the 0.5 assertion.
const EQUAL_PAIR: LeafSpec[] = [
  { center: [0, 0, 100], halfExtent: 5, pointCount: 1000 },
  { center: [100, 0, 0], halfExtent: 5, pointCount: 1000 },
];

// One large near tile + three tiny far tiles: the near tile dominates the area.
const NEAR_AND_FAR: LeafSpec[] = [
  { center: [0, 0, 10], halfExtent: 8, pointCount: 4000 }, // big near
  { center: [0, 0, 300], halfExtent: 1, pointCount: 100 }, // small far
  { center: [0, 300, 0], halfExtent: 1, pointCount: 100 },
  { center: [300, 0, 0], halfExtent: 1, pointCount: 100 },
];

describe('catalogCoverage()', () => {
  it('is 0 before any update and while nothing is ready', async () => {
    const ctx = makeCtx(EQUAL_PAIR);
    expect(ctx.policy.catalogCoverage()).toBe(0); // never updated

    await frame(ctx); // dispatched, nothing resolved yet
    await frame(ctx);
    expect(ctx.policy.catalogCoverage()).toBe(0);
  });

  it('is 1 when every cut tile is ready', async () => {
    const ctx = makeCtx(EQUAL_PAIR);
    await frame(ctx); // dispatch
    for (const k of ctx.octree.leafKeys) ctx.octree.ready(k);
    await frame(ctx); // recompute with leaves ready
    expect(ctx.policy.catalogCoverage()).toBe(1);
  });

  it('is the area-weighted ready fraction (~0.5 for one of two equal tiles)', async () => {
    const ctx = makeCtx(EQUAL_PAIR);
    await frame(ctx);
    ctx.octree.ready(ctx.octree.leafKeys[0]!); // exactly one of the equal pair
    await frame(ctx);
    expect(ctx.policy.catalogCoverage()).toBeCloseTo(0.5, 5);
  });

  it('weights by projected area: a large unready near tile drags coverage far below an equal-count far-ready case', async () => {
    // Case A: the big near tile is UNREADY, the three small far tiles are READY.
    const a = makeCtx(NEAR_AND_FAR);
    await frame(a);
    for (let i = 1; i < NEAR_AND_FAR.length; i++) a.octree.ready(a.octree.leafKeys[i]!);
    await frame(a);
    const covA = a.policy.catalogCoverage();

    // Case B: same count ready (3), but the big near tile IS ready and one far tile isn't.
    const b = makeCtx(NEAR_AND_FAR);
    await frame(b);
    b.octree.ready(b.octree.leafKeys[0]!); // big near
    b.octree.ready(b.octree.leafKeys[1]!);
    b.octree.ready(b.octree.leafKeys[2]!);
    await frame(b);
    const covB = b.policy.catalogCoverage();

    expect(covA).toBeLessThan(covB); // weighting, not unweighted 3/4 = 3/4
    expect(covA).toBeLessThan(0.5); // the missing near tile owns most of the area
    expect(covB).toBeGreaterThan(0.5);
  });

  it('counts a ready coarse ancestor as covering an unready child', async () => {
    // Two equal leaves, neither resolved, but the root ancestor IS resolved ⇒ the
    // catalog visibly fills both screen regions ⇒ full coverage.
    const ctx = makeCtx(EQUAL_PAIR);
    await frame(ctx);
    ctx.octree.ready(rootKey); // coarse ancestor only
    await frame(ctx);
    expect(ctx.policy.catalogCoverage()).toBe(1);
  });

  it('ignores procgen: a ready procgen chunk never counts toward coverage', async () => {
    const procgen = new Map<string, GalaxyGenParams>([['proc:mw', { seed: 7, starCount: 200 }]]);
    const ctx = makeCtx(EQUAL_PAIR, procgen);

    await frame(ctx); // dispatch octree leaves + the procgen chunk
    ctx.pool.flush(); // resolve ONLY the procgen worker dispatch — octree stays unready
    await frame(ctx);

    // The procgen chunk is ready and rendered, yet the catalog has zero coverage.
    expect(ctx.policy.visible.some((v) => v.kind === 'procgen')).toBe(true);
    expect(ctx.policy.catalogCoverage()).toBe(0); // procgen readiness is irrelevant
  });

  it('allocates nothing and stays stable when polled on a settled cut', async () => {
    const ctx = makeCtx(EQUAL_PAIR);
    await frame(ctx);
    for (const k of ctx.octree.leafKeys) ctx.octree.ready(k);
    await frame(ctx);

    const settled = ctx.policy.catalogCoverage();
    expect(settled).toBe(1);
    for (let i = 0; i < 1000; i++) {
      expect(ctx.policy.catalogCoverage()).toBe(settled); // precomputed read, no work
    }
    // A settled re-update issues no requests and leaves coverage untouched.
    await frame(ctx);
    expect(ctx.policy.stats.requestsThisFrame).toBe(0);
    expect(ctx.policy.catalogCoverage()).toBe(settled);
  });
});
