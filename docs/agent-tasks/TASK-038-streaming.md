# Task: `streaming` v1 — LOD policy, octree fetch/evict, procgen chunks, budgets

**ID:** TASK-038
**Target package:** `packages/streaming` (new)
**Size:** L — the policy brain; integration-heavy. Assign to the strongest
agent/human pair, **single-lane** (no other Phase 3 lane runs while this is
in-progress, like TASK-027).
**Phase:** 3 — lane (streaming)
**Depends on:** TASK-031, TASK-033, TASK-034, TASK-035

> Per architecture §7, `streaming` MUST NOT be built before at least two chunk
> producers exist (octree tiles + procgen) to validate the abstraction. Hence the
> dependency on both TASK-033 (procgen) and TASK-034 (octree tiles) — and TASK-035
> (the on-demand tile loader it drives). These are encoded as hard `Blocked by`.

## Goal

The policy brain of architecture §5.8: each frame, decide which octree tiles to
fetch (via `data` v3), which procedural galaxy chunks to request (via the worker
pool), the LOD level of every visible aggregate, and which chunks to evict — under
hard memory/draw-call/point **budgets** (§9: ≤ 350 MB GPU, ≤ 300 draw calls,
≤ 2M rendered points) with graceful degradation. It emits `ChunkLifecycleEvent`s
(`request | ready | evict`) through a typed registry and maintains the
nearest-body-distance scalar `nav` consumes. **It does not render and does not
generate** — it orchestrates and hands ready `StarBatch`es to consumers (§5.8).
Visibility is computed on the MAIN THREAD; generation/decode runs off-thread (§5.8).

## Frozen Interface

```ts
// public API of @cosmos/streaming
import type {
  ChunkLifecycleEvent, QualityTier, GalaxyGenParams,
} from '@cosmos/core-types';
import type { OctreeSource } from '@cosmos/data';
import type { WorkerPool } from '@cosmos/workers';
import type { OriginManager } from '@cosmos/coords';

/** §9 budgets — exceeded ⇒ graceful degradation (drop LOD, then point count). */
export interface StreamBudgets {
  readonly maxRenderedPoints: number; // §9 ≤ 2_000_000 at tier 'high'
  readonly maxDrawCalls: number;      // §9 ≤ 300
  readonly maxGpuBytes: number;       // §9 ≤ 350 * 1024 * 1024
  /** §5.8 in-flight request cap (4–8). */
  readonly maxInFlight: number;       // default 6
}

export interface StreamingPolicyOptions {
  readonly origin: OriginManager;
  readonly pool: WorkerPool;
  /** Octree source for the galaxy context (real catalog tiles). */
  readonly octree: OctreeSource;
  /** Procedural galaxy chunk params, keyed by galaxy id (procgen producer). */
  readonly procgenGalaxies?: ReadonlyMap<string, GalaxyGenParams>;
  readonly budgets?: Partial<StreamBudgets>;
  /** Initial quality tier (TASK-039 PerformanceMonitor updates it). */
  readonly initialTier?: QualityTier;
  /** §5.8 hysteresis: cross an LOD threshold by this fraction before switching. */
  readonly lodHysteresis?: number;    // default 0.15  (15%)
  /** §5.8 cross-fade duration for tile/chunk swaps, ms. */
  readonly crossFadeMs?: number;      // default 300
}

export interface VisibleChunk {
  readonly chunkId: string;
  readonly kind: 'octree' | 'procgen';
  readonly lod: number;
  /** Cross-fade alpha in [0,1] (rising on enter, falling on evict). */
  readonly opacity: number;
}

export interface StreamingPolicy {
  /**
   * Per frame (PRIORITY_STREAMING), on the MAIN THREAD. Computes the visible cut
   * by screen-space error, issues at most (maxInFlight − inFlight) new requests,
   * cancels stale in-flight requests for now-invisible chunks (AbortController +
   * worker CancelToken), advances cross-fades, and enforces budgets. ZERO
   * allocations on the steady-state path (scratch module-scoped); request/evict
   * event objects are the sanctioned rare allocations. `viewportHeightPx` feeds
   * the SSE projection.
   */
  update(viewportHeightPx: number, dtMs: number): void;
  /** Current visible cut (stable array, mutated in place per frame). */
  readonly visible: readonly VisibleChunk[];
  /** Nearest loaded-body distance to the camera, METERS (§5.8 → nav speed law).
   *  Infinity when nothing is loaded near the camera. */
  readonly nearestBodyDistanceM: number;
  /** Subscribe to lifecycle events; returns unsubscribe (§5.8 typed registry). */
  onChunk(cb: (e: ChunkLifecycleEvent) => void): () => void;
  setQualityTier(tier: QualityTier): void;
  /** Instrumentation counters for the E2E perf gate (§5.8). */
  readonly stats: {
    readonly inFlight: number;
    readonly loadedChunks: number;
    readonly renderedPoints: number;
    readonly drawCalls: number;
    readonly gpuBytesEstimate: number;
    readonly requestsThisFrame: number;
    readonly cancelledThisFrame: number;
  };
  dispose(): void;
}

export function createStreamingPolicy(opts: StreamingPolicyOptions): StreamingPolicy;
```

## Fixed semantics (transcribe, don't redesign — §5.8 / ADR-003)

- **Screen-space-error LOD** (ADR-003 §5, §5.8): for each candidate octree node,
  project its `halfExtentUnits` to pixels at the camera distance
  (`pixelSize = nodePixelExtent / pointSpacing`); descend to children when above the
  SSE threshold, else the node is the chosen LOD. Procgen galaxies pick a LOD level
  the same way (coarse particle cloud → impostor at extreme distance, see
  `render-galaxy`).
- **Hysteresis** (§5.8): require crossing an LOD threshold by `lodHysteresis` (15%)
  before switching levels; cross-fade tile/chunk swaps over `crossFadeMs` (~0.3 s) —
  `VisibleChunk.opacity` ramps the consumer's `setOpacity`.
- **Request discipline** (§5.8): at most `maxInFlight` (4–8) in-flight requests;
  prioritize by screen-space error (largest projected size / nearest first); cancel
  stale in-flight requests when the camera moves so they leave the visible cut
  (`AbortController` → `loadTile(signal)` and the worker `CancelToken`).
- **Eviction** (§5.8): LRU over loaded chunks once a budget is exceeded; **never
  evict a chunk on the current cut or an ancestor of the camera's node** (never evict
  the chunk the camera is inside).
- **Budgets + graceful degradation** (§9): when `renderedPoints`/`drawCalls`/
  `gpuBytes` would exceed budget, drop LOD (coarser tiles) first, then reduce point
  count, before dropping frames; `setQualityTier` scales `maxRenderedPoints` from the
  `QUALITY_TIERS` table (TASK-031) — degradation order: point count → bloom →
  atmosphere → resolution scale (the last two are scene-host's job; streaming owns
  point count + LOD).
- **Visibility on main thread** (§5.8): the cut, frustum/octree culling, and SSE are
  computed in `update` on the main thread; ONLY generation/decode is dispatched to
  the pool (a 1-frame-stale camera on the worker would cause misses).
- **nearestBodyDistanceM**: min over loaded chunk bounds of the camera↔chunk distance
  in meters (via `origin`); fed to `nav.setDistanceToNearestSurface` by the glue
  (TASK-040). Infinity when empty.

## Inputs / Outputs

- **Inputs:** a real `OctreeSource` (fixture pack), a fake/real `WorkerPool`, a real
  `OriginManager`, optional procgen galaxy params.
- **Outputs:** `ChunkLifecycleEvent`s; a `visible` cut; `nearestBodyDistanceM`;
  `stats` counters. Ready batches flow to `render-stars`/`render-galaxy` mounts via
  the app glue (TASK-040).

## Constraints & Forbidden Actions

- Do not modify `core-types`, `coords`, `data`, `workers`, `procgen`, or any
  `render-*`. API friction ⇒ `blocked` + report (a fix is a reviewed task against
  the owning package).
- Allowed dependencies: `@cosmos/core-types`, `@cosmos/coords` (types + OriginManager
  usage), `@cosmos/data` (`OctreeSource`), `@cosmos/workers` (`WorkerPool`). **No
  Three.js** (streaming does not render — it hands raw `StarBatch`es out; §5.8) and
  **no React**.
- No allocations in the steady-state `update()` path (scratch module-scoped); only
  rare request/evict events and the rare LOD-change bookkeeping may allocate —
  document each like coords' RebaseEvent.
- No `Math.random()`. Do not compute visibility on the worker (§5.8). Do not exceed
  the in-flight cap. Do not evict the camera's chunk.

## Common Mistakes (architecture §5.8 — copy kept verbatim)

- LOD popping with no hysteresis — require crossing thresholds by 15% before
  switching, and cross-fade star tiles over ~0.3 s.
- Unbounded in-flight requests (cap at 4–8; cancel stale ones on fast camera
  movement via AbortController + worker-side cancellation tokens).
- Evicting the chunk the camera is inside.
- Computing visibility on worker (1-frame-stale camera causes misses) — visibility
  on main thread, generation on worker.
- Plus: holding decoded batches forever (LRU + budget eviction is the whole point);
  blocking `update()` on a pending `loadTile` (it is async — request and continue);
  forgetting to drop the cancelled-request count into `stats` (the E2E gate asserts
  the cap via these counters).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/streaming test` — `test/policy.test.ts` (Node; fixture
   octree, a deterministic fake `WorkerPool` that resolves dispatches on demand, a
   real `OriginManager`, a scripted camera path):
   - **SSE descent:** as the camera approaches, `visible` LOD levels increase
     (descend the tree) and decrease on retreat; the chosen cut covers the frustum.
   - **In-flight cap (§5.8):** during a fast scripted fly-through, `stats.inFlight`
     never exceeds `maxInFlight`; stale requests are cancelled
     (`stats.cancelledThisFrame > 0` when the camera reverses) and the fake pool
     records the cancellations.
   - **Hysteresis:** oscillating the camera around an LOD boundary produces NO LOD
     flapping until the 15% margin is crossed; cross-fade `opacity` ramps 0→1 over
     `crossFadeMs` on enter and 1→0 on evict.
   - **Eviction:** force a tiny `maxGpuBytes`; LRU evicts least-recent chunks; the
     chunk containing the camera and its ancestors are NEVER evicted (assert).
   - **Budget degradation:** drop `maxRenderedPoints` (via `setQualityTier('low')`)
     → `stats.renderedPoints` falls below the cap by choosing coarser LODs, not by
     dropping the camera's chunk.
   - **Lifecycle events:** `onChunk` fires `request` then `ready` (carrying a
     `StarBatch`) then `evict` for a chunk over its lifetime; `ready.batch` is the
     decoded batch; unsubscribe works.
   - **nearestBodyDistanceM:** matches `origin`-computed distance to the nearest
     loaded chunk; `Infinity` when none loaded.
   - **Zero-allocation steady state:** a non-changing-cut `update()` allocates
     nothing (same-identity scratch checks).
2. **Coverage gate:** statement coverage ≥ 85% on `src`.
3. `pnpm verify` exits 0 (boundary lint: no Three.js, no React).

## Deliverables

- `packages/streaming/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/streaming/src/policy.ts` (the per-frame brain), `src/sse.ts`
  (screen-space-error projection, pure), `src/lru.ts` (eviction), `src/budgets.ts`
  (budget enforcement + tier table application), `src/crossfade.ts`, `src/index.ts`
- `packages/streaming/test/policy.test.ts`, `test/sse.test.ts`, `test/lru.test.ts`,
  `test/helpers/fake-pool.ts`, `test/fixtures/octree-*.json`
- `packages/streaming/README.md` (< 150 lines; document the typed registry, the
  budget/degradation order, and the main-thread-visibility / worker-generation split)

## Context Files

- `docs/architecture.md` §5.8 (whole section), §9 (budgets + degradation order),
  §3 (per-frame data flow)
- `docs/decisions/ADR-003-octree-tiling.md` §5 (SSE LOD), §3 (tile payloads)
- `packages/data/src/octree.ts` / `README.md` (`OctreeSource`, `loadTile` signal),
  `packages/workers/src/index.ts` (`WorkerPool`, `CancelToken`),
  `packages/coords/src/origin.ts` (`toRenderSpace`, `cameraUniverse`),
  `packages/core-types/src/streaming.ts` + `src/quality.ts` (event + tier types),
  `packages/core-types/src/procgen.ts` (`GalaxyGenParams`)
- `docs/agent-tasks/TASK-027-nav-context-switch.md` (the "strongest agent /
  exclusive lane" precedent + rare-allocation documentation style)
