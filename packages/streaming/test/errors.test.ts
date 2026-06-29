import { describe, it, expect, vi } from 'vitest';
import type { ContextId, ChunkLifecycleEvent, MortonKey } from '@cosmos/core-types';
import { createScaleFrameTree, createOriginManager } from '@cosmos/coords';
import type { OriginManager } from '@cosmos/coords';
import { loadOctreePack } from '@cosmos/data';
import type { OctreeSource, OctreeNode } from '@cosmos/data';
import { createStreamingPolicy, MAX_LOAD_ATTEMPTS } from '../src/index.js';
import type { StreamingPolicy } from '../src/index.js';
import { createFakePool } from './helpers/fake-pool.js';
import type { FakePool } from './helpers/fake-pool.js';
import { buildClusteredOctree, tick } from './helpers/octree-fixture.js';

const at = (context: ContextId, local: [number, number, number]) => ({ context, local });
const camAt = (d: number): [number, number, number] => [100, 100, 100 + d];
// Far from the (100,100,100) cluster ⇒ only the root '0/0' is the chosen cut.
const FAR = camAt(100000);

interface FaultOctree extends OctreeSource {
  /** When true, EVERY loadTile rejects as an AbortError (a normal navigation cancel). */
  abortAll: boolean;
  /** Keys whose loadTile rejects with a real Error('decode failed'). */
  readonly failKeys: Set<MortonKey>;
  /** Keys passed to loadTile, in call order (storm/backoff/retry assertions). */
  readonly loadCalls: MortonKey[];
}

/** Wrap a real OctreeSource so `loadTile` can be forced to reject (real failure) or
 *  reject as an AbortError (cancel); non-failing keys delegate to the real decode. */
function wrapFault(inner: OctreeSource): FaultOctree {
  const failKeys = new Set<MortonKey>();
  const loadCalls: MortonKey[] = [];
  const w: FaultOctree = {
    abortAll: false,
    failKeys,
    loadCalls,
    get root(): OctreeNode {
      return inner.root;
    },
    get context() {
      return inner.context;
    },
    get rootHalfExtentUnits() {
      return inner.rootHalfExtentUnits;
    },
    get idPrefix() {
      return inner.idPrefix;
    },
    getNode: (k) => inner.getNode(k),
    loadTile(key, opts) {
      loadCalls.push(key);
      if (w.abortAll) {
        return Promise.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      }
      if (failKeys.has(key)) {
        return Promise.reject(new Error('decode failed'));
      }
      return inner.loadTile(key, opts);
    },
  };
  return w;
}

interface Ctx {
  pool: FakePool;
  octree: FaultOctree;
  origin: OriginManager;
  policy: StreamingPolicy;
  errorEvents: ChunkLifecycleEvent[];
  reportSpy: ReturnType<typeof vi.fn>;
}

async function makeCtx(): Promise<Ctx> {
  const fixture = buildClusteredOctree();
  const pool = createFakePool();
  const inner = await loadOctreePack(fixture.manifestUrl, { fetchImpl: fixture.fetchImpl, pool });
  const octree = wrapFault(inner);
  const tree = createScaleFrameTree();
  const origin = createOriginManager(tree, at('galaxy', FAR));
  const errorEvents: ChunkLifecycleEvent[] = [];
  const reportSpy = vi.fn();
  const policy = createStreamingPolicy({ origin, pool, octree, reportError: reportSpy });
  policy.onChunk((e) => {
    // eventScratch is mutated in place — snapshot the fields the assertions read.
    if (e.phase === 'error') {
      errorEvents.push({ phase: e.phase, kind: e.kind, chunkId: e.chunkId, lod: e.lod, batch: e.batch, error: e.error ?? null });
    }
  });
  return { pool, octree, origin, policy, errorEvents, reportSpy };
}

/** One dispatch→reject cycle (no flush): update issues the request, tick lets the
 *  rejected loadTile promise's `.catch(onError)` run. */
async function failFrame(ctx: Ctx, cam: [number, number, number] = FAR): Promise<void> {
  ctx.origin.setCameraPosition(at('galaxy', cam));
  ctx.policy.update(1080, 16);
  await tick(2);
}

/** Full settle cycle WITH a pool flush, so non-failing tiles actually become ready. */
async function settle(ctx: Ctx, cam: [number, number, number], frames = 28): Promise<void> {
  for (let i = 0; i < frames; i++) {
    ctx.origin.setCameraPosition(at('galaxy', cam));
    ctx.policy.update(1080, 1000);
    await tick(2);
    ctx.pool.flush();
    await tick(2);
  }
  ctx.origin.setCameraPosition(at('galaxy', cam));
  ctx.policy.update(1080, 1000);
}

describe('streaming error lifecycle (TASK-057)', () => {
  it('abort is NOT an error: rejecting AbortError emits no error event and never counts', async () => {
    const ctx = await makeCtx();
    ctx.octree.abortAll = true;

    for (let i = 0; i < 5; i++) await failFrame(ctx);

    expect(ctx.errorEvents.length).toBe(0);
    expect(ctx.policy.stats.errorCount).toBe(0);
    expect(ctx.policy.stats.failedChunks).toBe(0);
    expect(ctx.reportSpy).not.toHaveBeenCalled();
    // The chunk was actually dispatched (and aborted) — not a no-op.
    expect(ctx.octree.loadCalls.length).toBeGreaterThan(0);
  });

  it('a real failure emits exactly one error event (phase/kind/context) and reports once', async () => {
    const ctx = await makeCtx();
    ctx.octree.failKeys.add('0/0' as MortonKey);

    await failFrame(ctx);

    expect(ctx.errorEvents.length).toBe(1);
    const e = ctx.errorEvents[0]!;
    expect(e.phase).toBe('error');
    expect(e.batch).toBeNull();
    expect(e.error).not.toBeNull();
    expect(e.error!.kind).toBe('streaming');
    expect(e.error!.message).toBe('decode failed');
    expect(e.error!.context?.chunkId).toBe('0/0');
    expect(e.error!.context?.kind).toBe('octree');

    expect(ctx.policy.stats.errorCount).toBe(1);
    expect(ctx.reportSpy).toHaveBeenCalledTimes(1);
    expect(ctx.reportSpy).toHaveBeenCalledWith(
      expect.any(Error),
      'streaming',
      expect.objectContaining({ chunkId: '0/0', kind: 'octree' }),
    );
  });

  it('backs off after MAX_LOAD_ATTEMPTS: the chunk goes failed and stops re-requesting', async () => {
    const ctx = await makeCtx();
    ctx.octree.failKeys.add('0/0' as MortonKey);

    for (let i = 0; i < MAX_LOAD_ATTEMPTS; i++) await failFrame(ctx);

    expect(ctx.policy.stats.errorCount).toBe(MAX_LOAD_ATTEMPTS);
    expect(ctx.policy.stats.failedChunks).toBeGreaterThanOrEqual(1);
    expect(ctx.errorEvents.length).toBe(MAX_LOAD_ATTEMPTS);

    // The storm is dead: over the next 10 frames loadTile is NOT called again for '0/0'.
    const callsBefore = ctx.octree.loadCalls.length;
    for (let i = 0; i < 10; i++) await failFrame(ctx);
    expect(ctx.octree.loadCalls.length).toBe(callsBefore);
    expect(ctx.policy.stats.errorCount).toBe(MAX_LOAD_ATTEMPTS); // no new counts either
  });

  it('a failed tile does not raise catalogCoverage (it is a gap, never counted ready)', async () => {
    // Baseline: a healthy root settles to full catalog coverage.
    const ok = await makeCtx();
    await settle(ok, FAR, 6);
    expect(ok.policy.catalogCoverage()).toBeGreaterThan(0);

    // Permanently-failing root ⇒ no ready tile anywhere ⇒ coverage stays 0.
    const bad = await makeCtx();
    bad.octree.failKeys.add('0/0' as MortonKey);
    for (let i = 0; i < MAX_LOAD_ATTEMPTS; i++) await failFrame(bad);
    expect(bad.policy.stats.failedChunks).toBeGreaterThanOrEqual(1);
    expect(bad.policy.catalogCoverage()).toBe(0);
    // ...and a failed chunk is never rendered.
    expect(bad.policy.visible.length).toBe(0);
  });

  it('retry release: a failed deep tile that leaves and re-enters the cut is retried fresh', async () => {
    const ctx = await makeCtx();

    // Approach so the cut descends to leaves; pick the deepest octree leaf to fail.
    await settle(ctx, camAt(8));
    const leaf = ctx.policy.visible
      .filter((v) => v.kind === 'octree')
      .reduce((a, b) => (b.lod > a.lod ? b : a));
    expect(leaf.lod).toBeGreaterThan(0);

    // Evict it first (retreat) so a fresh dispatch is needed, then fail that key
    // permanently and let it back off to `failed` on the next approach.
    await settle(ctx, FAR);
    ctx.octree.failKeys.add(leaf.chunkId as MortonKey);
    await settle(ctx, camAt(8));
    expect(ctx.policy.stats.failedChunks).toBeGreaterThanOrEqual(1);
    expect(ctx.policy.stats.errorCount).toBeGreaterThanOrEqual(MAX_LOAD_ATTEMPTS);

    // Retreat: the failed leaf leaves the cut and is released (removed).
    await settle(ctx, FAR);
    expect(ctx.policy.stats.failedChunks).toBe(0);

    // Heal the fetch, approach again: the node re-enters as a FRESH chunk and a new
    // load attempt is made (loadTile called again for that id), now succeeding.
    ctx.octree.failKeys.clear();
    const callsBefore = ctx.octree.loadCalls.filter((k) => k === leaf.chunkId).length;
    await settle(ctx, camAt(8));
    const callsAfter = ctx.octree.loadCalls.filter((k) => k === leaf.chunkId).length;
    expect(callsAfter).toBeGreaterThan(callsBefore);
    expect(ctx.policy.visible.some((v) => v.chunkId === leaf.chunkId)).toBe(true);
  });
});
