import { describe, it, expect, beforeAll } from 'vitest';
import type { ContextId, GalaxyGenParams } from '@cosmos/core-types';
import { createScaleFrameTree, createOriginManager } from '@cosmos/coords';
import type { OriginManager } from '@cosmos/coords';
import { loadOctreePack } from '@cosmos/data';
import type { OctreeSource } from '@cosmos/data';
import { createStreamingPolicy, effectiveMaxPoints, resolveBudgets } from '../src/index.js';
import type { StreamingPolicy, StreamingPolicyOptions } from '../src/index.js';
import { createFakePool } from './helpers/fake-pool.js';
import type { FakePool } from './helpers/fake-pool.js';
import { buildClusteredOctree, buildDenseOctree, tick } from './helpers/octree-fixture.js';

const at = (context: ContextId, local: [number, number, number]) => ({ context, local });
const camAt = (d: number): [number, number, number] => [100, 100, 100 + d];

interface Ctx {
  pool: FakePool;
  octree: OctreeSource;
  origin: OriginManager;
  policy: StreamingPolicy;
}

interface MakeOpts {
  fixture?: ReturnType<typeof buildClusteredOctree>;
  start?: [number, number, number];
  policy?: Partial<Omit<StreamingPolicyOptions, 'origin' | 'pool' | 'octree'>>;
}

async function makeCtx(opts: MakeOpts = {}): Promise<Ctx> {
  const fixture = opts.fixture ?? buildClusteredOctree();
  const pool = createFakePool();
  const octree = await loadOctreePack(fixture.manifestUrl, {
    fetchImpl: fixture.fetchImpl,
    pool,
  });
  const tree = createScaleFrameTree();
  const origin = createOriginManager(tree, at('galaxy', opts.start ?? camAt(100000)));
  const policy = createStreamingPolicy({ origin, pool, octree, ...opts.policy });
  return { pool, octree, origin, policy };
}

interface SettleOpts {
  viewport?: number;
  dt?: number;
  frames?: number;
}

/** Drive `frames` of: set camera → update → let loadTile reach the pool → flush. */
async function settle(
  ctx: Ctx,
  cam: [number, number, number],
  { viewport = 1080, dt = 1000, frames = 28 }: SettleOpts = {},
): Promise<void> {
  for (let i = 0; i < frames; i++) {
    ctx.origin.setCameraPosition(at('galaxy', cam));
    ctx.policy.update(viewport, dt);
    await tick(2);
    ctx.pool.flush();
    await tick(2);
  }
  ctx.origin.setCameraPosition(at('galaxy', cam));
  ctx.policy.update(viewport, dt);
}

const maxLod = (p: StreamingPolicy): number =>
  p.visible.reduce((m, v) => (v.kind === 'octree' && v.lod > m ? v.lod : m), 0);

// ===========================================================================
// SSE descent
// ===========================================================================
describe('SSE descent', () => {
  it('descends as the camera approaches and ascends on retreat; cut covers the frustum', async () => {
    const ctx = await makeCtx();

    await settle(ctx, camAt(100000)); // very far
    const lodFar = maxLod(ctx.policy);
    expect(ctx.policy.visible.length).toBeGreaterThan(0); // cut is non-empty

    await settle(ctx, camAt(8)); // close to the cluster
    const lodNear = maxLod(ctx.policy);
    expect(lodNear).toBeGreaterThan(lodFar);

    await settle(ctx, camAt(100000)); // retreat
    const lodBack = maxLod(ctx.policy);
    expect(lodBack).toBeLessThan(lodNear);
  });
});

// ===========================================================================
// In-flight cap + stale-request cancellation
// ===========================================================================
describe('request discipline (§5.8)', () => {
  it('never exceeds maxInFlight and cancels stale requests on camera reversal', async () => {
    const ctx = await makeCtx({ policy: { budgets: { maxInFlight: 3 } } });

    // Fast approach without ever flushing: requests pile but stay capped.
    for (let i = 0; i < 6; i++) {
      ctx.origin.setCameraPosition(at('galaxy', camAt(8)));
      ctx.policy.update(1080, 16);
      await tick(3);
      expect(ctx.policy.stats.inFlight).toBeLessThanOrEqual(3);
    }
    expect(ctx.pool.held).toBeGreaterThan(0);
    const inFlightBefore = ctx.policy.stats.inFlight;
    expect(inFlightBefore).toBeLessThanOrEqual(3);

    // Reverse hard: deep in-flight tiles leave the cut and must be cancelled.
    ctx.origin.setCameraPosition(at('galaxy', camAt(100000)));
    ctx.policy.update(1080, 16);
    expect(ctx.policy.stats.cancelledThisFrame).toBeGreaterThan(0);

    await tick(3);
    expect(ctx.pool.dispatches.some((d) => d.cancelled)).toBe(true);
    expect(ctx.policy.stats.inFlight).toBeLessThanOrEqual(3);
  });
});

// ===========================================================================
// Hysteresis + cross-fade
// ===========================================================================
describe('hysteresis (§5.8)', () => {
  it('does not flap when oscillating within the 15% margin, and is direction-dependent', async () => {
    const ctx = await makeCtx();

    // d≈80000 ⇒ root SSE just below threshold; d≈60000 ⇒ inside the +15% margin.
    const opts = { frames: 8 } as const;
    await settle(ctx, camAt(80000), opts);
    expect(maxLod(ctx.policy)).toBe(0);

    // Oscillate across the boundary band — must NOT descend (no flapping).
    for (let i = 0; i < 3; i++) {
      await settle(ctx, camAt(60000), opts);
      expect(maxLod(ctx.policy)).toBe(0);
      await settle(ctx, camAt(80000), opts);
      expect(maxLod(ctx.policy)).toBe(0);
    }

    // Cross the full +15% margin ⇒ descend.
    await settle(ctx, camAt(40000), opts);
    const descended = maxLod(ctx.policy);
    expect(descended).toBeGreaterThan(0);

    // Returning to 60000 keeps the deeper LOD (hysteresis: same position, different
    // result depending on approach direction).
    await settle(ctx, camAt(60000), opts);
    expect(maxLod(ctx.policy)).toBeGreaterThan(0);
  });
});

describe('cross-fade (§5.8)', () => {
  it('ramps opacity 0→1 on enter and 1→0 on evict', async () => {
    const ctx = await makeCtx({ policy: { crossFadeMs: 300 } });

    // Far camera ⇒ the cut is just the root, so it stays the sole rendered chunk
    // and we can watch its opacity ramp cleanly over ~3 frames of 100 ms.
    ctx.origin.setCameraPosition(at('galaxy', camAt(100000)));
    ctx.policy.update(1080, 100); // dispatch root
    await tick(3);
    ctx.pool.flush();
    await tick(3);

    const op: number[] = [];
    for (let i = 0; i < 4; i++) {
      ctx.origin.setCameraPosition(at('galaxy', camAt(100000)));
      ctx.policy.update(1080, 100);
      const root = ctx.policy.visible.find((v) => v.chunkId === '0/0');
      if (root) op.push(root.opacity);
      await tick(1);
    }
    expect(op[0]).toBeGreaterThan(0);
    expect(op[0]).toBeLessThan(1);
    expect(op[op.length - 1]).toBe(1);
    for (let i = 1; i < op.length; i++) expect(op[i]).toBeGreaterThanOrEqual(op[i - 1]!);
  });

  it('evicts a chunk after it fades out of the cut', async () => {
    const ctx = await makeCtx({ policy: { crossFadeMs: 100 } });
    const evicted: string[] = [];
    ctx.policy.onChunk((e) => {
      if (e.phase === 'evict') evicted.push(e.chunkId);
    });

    await settle(ctx, camAt(8)); // deep cut loaded
    const leaf = ctx.policy.visible
      .filter((v) => v.kind === 'octree')
      .reduce((a, b) => (b.lod > a.lod ? b : a));
    expect(leaf.lod).toBeGreaterThan(0);

    await settle(ctx, camAt(100000)); // deep leaves leave the cut → fade → evict
    expect(evicted).toContain(leaf.chunkId);
  });
});

// ===========================================================================
// Eviction (LRU, never the camera's chunk)
// ===========================================================================
describe('eviction (§5.8)', () => {
  it('LRU-evicts stale chunks under a tiny GPU budget but never the camera chunk/ancestors', async () => {
    const ctx = await makeCtx({
      // Huge cross-fade ⇒ chunks that leave the cut linger as resident, unpinned,
      // so the LRU path (not the fade path) is what frees them.
      policy: { budgets: { maxGpuBytes: 1024 }, crossFadeMs: 1_000_000 },
    });
    const evicted: string[] = [];
    ctx.policy.onChunk((e) => {
      if (e.phase === 'evict') evicted.push(e.chunkId);
    });

    await settle(ctx, camAt(8));
    const deepLeaves = ctx.policy.visible.filter((v) => v.kind === 'octree' && v.lod > 1).map((v) => v.chunkId);
    expect(deepLeaves.length).toBeGreaterThan(0);
    const loadedNear = ctx.policy.stats.loadedChunks;

    // Retreat: the deep leaves are no longer on the cut and are LRU-evicted; root
    // (the camera's node now, and every node's ancestor) is pinned and survives.
    await settle(ctx, camAt(100000));
    expect(ctx.policy.stats.loadedChunks).toBeLessThan(loadedNear);
    expect(evicted.some((id) => deepLeaves.includes(id))).toBe(true);
    expect(evicted).not.toContain('0/0'); // root never evicted
    expect(ctx.policy.visible.some((v) => v.chunkId === '0/0')).toBe(true);
  });
});

// ===========================================================================
// Budget degradation
// ===========================================================================
describe('budget degradation (§9)', () => {
  let dense: ReturnType<typeof buildDenseOctree>;
  beforeAll(() => {
    dense = buildDenseOctree(600_000);
  });

  it('setQualityTier("low") drops rendered points below the cap via coarser LODs, not by dropping the camera chunk', async () => {
    const ctx = await makeCtx({ fixture: dense, start: [0, 0, 100000], policy: {} });

    const cam: [number, number, number] = [10, 10, 30];
    await settle(ctx, cam, { frames: 26 });
    const pointsHigh = ctx.policy.stats.renderedPoints;
    expect(pointsHigh).toBeGreaterThan(500_000); // tier 'high' renders the full cut

    ctx.policy.setQualityTier('low');
    await settle(ctx, cam, { frames: 12 });

    const cap = effectiveMaxPoints(resolveBudgets(), 'low'); // 500k
    expect(ctx.policy.stats.renderedPoints).toBeLessThanOrEqual(cap);
    expect(ctx.policy.stats.renderedPoints).toBeLessThan(pointsHigh);
    // The camera's region is still covered (degraded, not dropped).
    expect(ctx.policy.visible.length).toBeGreaterThan(0);
    expect(ctx.policy.nearestBodyDistanceM).toBeLessThan(Infinity);
  });

  // The DETERMINISTIC draw-call invariant. `enforceBudgets` collapses over-budget
  // covered nodes into their coarser parents "until within budget" — but only into a
  // parent that is already `ready`; when a parent is still loading it keeps the child
  // ("not collapsible — keep child", policy.ts), so the cut can transiently sit at
  // budget+K mid-flight while parents stream in. That transient is by design (a coarse
  // hole would be worse than one extra chunk) and is exactly what makes the m4a e2e's
  // PEAK-over-a-descent draw-call reading machine-dependent: a faster GPU samples more
  // frames and is likelier to catch the transient (docs/research/
  // m4a-drawcall-budget-transient.md). This test pins the invariant the budget actually
  // guarantees — once every parent is `ready`, the collapse is unobstructed and the cap
  // holds EXACTLY — with zero WebGL and zero frame-timing dependence.
  it('collapses draw calls to ≤ maxDrawCalls once every parent is ready (steady-state invariant)', async () => {
    const DRAW_CAP = 24;
    const cam: [number, number, number] = [10, 10, 30];

    // Baseline: the same settled cut under the default budget renders far more than
    // DRAW_CAP chunks — so the cap below has real collapsing to do (guards a trivial
    // pass where the fixture simply never exceeds the cap).
    const wide = await makeCtx({ fixture: dense, start: [0, 0, 100000], policy: {} });
    await settle(wide, cam, { frames: 26 });
    expect(wide.policy.stats.drawCalls).toBeGreaterThan(DRAW_CAP);

    // Under a tight draw-call budget, the fully-settled cut collapses to ≤ DRAW_CAP —
    // deterministically, with no "parent not ready" residue, because settle() flushed
    // every ancestor to `ready`.
    const ctx = await makeCtx({
      fixture: dense,
      start: [0, 0, 100000],
      policy: { budgets: { maxDrawCalls: DRAW_CAP } },
    });
    await settle(ctx, cam, { frames: 26 });

    expect(ctx.policy.stats.drawCalls).toBeLessThanOrEqual(DRAW_CAP);
    // Degraded, not dropped: the camera's region is still covered.
    expect(ctx.policy.visible.length).toBeGreaterThan(0);
    expect(ctx.policy.nearestBodyDistanceM).toBeLessThan(Infinity);
  });
});

// ===========================================================================
// Lifecycle events
// ===========================================================================
describe('lifecycle registry (§5.8)', () => {
  it('fires request → ready (carrying a StarBatch) → evict; unsubscribe works', async () => {
    const ctx = await makeCtx({ policy: { crossFadeMs: 100 } });
    const log: Array<{ phase: string; id: string; count: number | null }> = [];
    const unsub = ctx.policy.onChunk((e) =>
      log.push({ phase: e.phase, id: e.chunkId, count: e.batch ? e.batch.count : null }),
    );

    await settle(ctx, camAt(8));
    const req = log.find((l) => l.phase === 'request' && l.id === '0/0');
    const ready = log.find((l) => l.phase === 'ready' && l.id === '0/0');
    expect(req).toBeDefined();
    expect(ready).toBeDefined();
    expect(ready!.count).toBeGreaterThan(0); // ready carried the decoded batch

    const leaf = ctx.policy.visible
      .filter((v) => v.kind === 'octree')
      .reduce((a, b) => (b.lod > a.lod ? b : a));

    await settle(ctx, camAt(100000));
    expect(log.some((l) => l.phase === 'evict' && l.id === leaf.chunkId)).toBe(true);

    unsub();
    const n = log.length;
    await settle(ctx, camAt(8));
    expect(log.length).toBe(n); // no events after unsubscribe
  });
});

// ===========================================================================
// nearestBodyDistanceM
// ===========================================================================
describe('nearestBodyDistanceM', () => {
  it('is Infinity with nothing loaded and shrinks as the camera approaches', async () => {
    const ctx = await makeCtx();
    expect(ctx.policy.nearestBodyDistanceM).toBe(Infinity);

    // One update, no flush ⇒ nothing ready yet ⇒ still Infinity.
    ctx.origin.setCameraPosition(at('galaxy', camAt(8)));
    ctx.policy.update(1080, 16);
    expect(ctx.policy.nearestBodyDistanceM).toBe(Infinity);

    await settle(ctx, camAt(5000));
    const far = ctx.policy.nearestBodyDistanceM;
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(Infinity);

    await settle(ctx, camAt(50));
    const near = ctx.policy.nearestBodyDistanceM;
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(far);
  });
});

// ===========================================================================
// Procgen lifecycle
// ===========================================================================
describe('procgen chunks', () => {
  it('requests, generates and renders a procedural galaxy chunk', async () => {
    const procgenGalaxies = new Map<string, GalaxyGenParams>([
      ['proc:mw', { seed: 7, starCount: 200 }],
    ]);
    const ctx = await makeCtx({ policy: { procgenGalaxies } });
    const readies: string[] = [];
    ctx.policy.onChunk((e) => {
      if (e.phase === 'ready' && e.kind === 'procgen') readies.push(e.chunkId);
    });

    await settle(ctx, camAt(50));
    expect(readies).toContain('gal7:sec0');
    expect(ctx.policy.visible.some((v) => v.kind === 'procgen' && v.chunkId === 'gal7:sec0')).toBe(true);
  });
});

// ===========================================================================
// Zero-allocation steady state
// ===========================================================================
describe('zero-allocation steady state', () => {
  it('reuses the visible array and VisibleChunk objects across an unchanging cut', async () => {
    const ctx = await makeCtx();
    await settle(ctx, camAt(50));

    const visibleRef = ctx.policy.visible;
    const firstObjs = visibleRef.map((v) => v);

    ctx.origin.setCameraPosition(at('galaxy', camAt(50)));
    ctx.policy.update(1080, 1000);

    expect(ctx.policy.visible).toBe(visibleRef); // same array identity
    expect(ctx.policy.visible.length).toBe(firstObjs.length);
    for (let i = 0; i < firstObjs.length; i++) {
      expect(ctx.policy.visible[i]).toBe(firstObjs[i]); // same VisibleChunk identity
    }
    expect(ctx.policy.stats.requestsThisFrame).toBe(0);
    expect(ctx.policy.stats.cancelledThisFrame).toBe(0);
  });
});
