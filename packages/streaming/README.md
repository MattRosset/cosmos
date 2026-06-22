# @cosmos/streaming

The §5.8 **policy brain**. Each frame, on the **main thread**, it decides which
octree tiles to fetch (via `@cosmos/data`), which procedural galaxy chunks to
generate (via the `@cosmos/workers` pool), the LOD of every visible aggregate, and
which chunks to evict — under hard §9 budgets with graceful degradation. It **does
not render and does not generate**: it orchestrates requests and hands ready
`StarBatch`es to `render-stars` / `render-galaxy` through a typed lifecycle
registry, and maintains the nearest-loaded-body distance `nav` reads.

Pure TypeScript — no Three.js, no React (boundary-lint enforced). Runs identically
in Node tests and the browser.

```ts
import { createStreamingPolicy } from '@cosmos/streaming';

const streaming = createStreamingPolicy({
  origin,                                  // @cosmos/coords OriginManager
  pool,                                    // @cosmos/workers WorkerPool
  octree,                                  // @cosmos/data OctreeSource
  procgenGalaxies: new Map([['proc:mw', { seed, starCount: 1_000_000 }]]),
});

// per frame, at PRIORITY_STREAMING, on the main thread:
streaming.update(viewportHeightPx, dtMs);

const unsub = streaming.onChunk((e) => {
  if (e.phase === 'ready') mount(e.chunkId, e.kind, e.batch); // batch is decoded
  if (e.phase === 'evict') unmount(e.chunkId);
});
// each mounted object: setRenderOffset(origin.toRenderSpace(chunkOrigin)) +
// setOpacity(visibleChunk.opacity) — see streaming.visible.
```

## Main-thread visibility, worker generation (§5.8)

The visible **cut**, octree culling, and screen-space-error projection are computed
in `update()` on the main thread — a one-frame-stale camera on a worker would cause
misses. **Only** tile decode and galaxy generation are dispatched off-thread (the
`OctreeSource` decodes in the pool; procgen runs `procgen.galaxy` in the pool).

## Screen-space-error LOD + hysteresis

For each octree node, its half-extent is projected to pixels at the camera distance
(`sse.ts`); `SSE = projectedPixelExtent / cbrt(pointCount)` (pixels between adjacent
represented points). Descend to children when `SSE` exceeds the threshold, else the
node is the chosen LOD. **Hysteresis** (`lodHysteresis`, default 15%): a node only
switches descend/ascend once `SSE` crosses the threshold by that margin, so a camera
oscillating around a boundary does not flap. Tile/chunk swaps **cross-fade** over
`crossFadeMs` (default 300 ms) via `VisibleChunk.opacity`. While a node's children
load, the deepest already-ready ancestor covers it (ADR-003 §3: coarse before fine).

## Typed lifecycle registry

`onChunk(cb)` subscribes to `ChunkLifecycleEvent`s and returns an unsubscribe:

| phase | when | `batch` |
|---|---|---|
| `request` | a fetch/generate was dispatched | `null` |
| `ready` | the decoded `StarBatch` arrived | the batch |
| `evict` | the chunk faded out or was LRU-evicted | `null` |

The event object is module-scoped scratch, mutated in place — **read its fields,
don't retain it**.

## Budgets & degradation order (§9)

`StreamBudgets`: `maxRenderedPoints` (≤ 2M), `maxDrawCalls` (≤ 300), `maxGpuBytes`
(≤ 350 MB), `maxInFlight` (4–8, default 6). When the cut would exceed the point or
draw budget, streaming **drops LOD first** — it collapses the deepest cut nodes into
their coarser (ready) parents — then reduces point count, before dropping frames.
`setQualityTier(tier)` scales the effective point cap from the `QUALITY_TIERS` table
(point count → then bloom → atmosphere → resolution scale; the last three are the
scene-host's levers). **Streaming owns point count + LOD only.**

Eviction is **LRU** over loaded chunks once `maxGpuBytes` is exceeded, and **never**
evicts a chunk on the current cut, an ancestor of the camera's node, or the node the
camera is inside (`lru.ts`).

## Request discipline

At most `maxInFlight` requests are in flight; new ones are issued coarse-then-near
first. When the camera moves so a node leaves the cut, its in-flight request is
cancelled (`AbortController` → `loadTile(signal)` for octree, `CancelToken` for
procgen). `stats.cancelledThisFrame` / `requestsThisFrame` / `inFlight` expose this
for the E2E perf gate.

## `nearestBodyDistanceM`

The distance, **in meters**, from the camera to the bounds of the nearest loaded
chunk (`Infinity` when nothing is loaded near the camera). Context units are scaled
to meters via `CONTEXT_UNIT_METERS`. The app glue (TASK-040) feeds it to
`nav.setDistanceToNearestSurface`.

## `catalogCoverage()`

A scalar in `[0,1]`: how much of the current visible cut the **real catalog**
(octree tiles) already covers. `1` ⇒ ready octree tiles fill the view, so the M4a
render-tier unification can fade the procedural galaxy cloud to `0` (replacing M3's
hard-coded `GAL_PROCGEN_FLOOR`); `0` ⇒ no catalog coverage, procgen fully visible.
See [`phase4-render-tier-handoff.md`](../../docs/research/phase4-render-tier-handoff.md)
§3 and ADR-006 §5.

It is a **read-only accessor over the state `update()` already computes** — it does
not traverse or fetch, and returns the value as of the last `update()`. Only octree
chunks count; **procgen chunks never contribute** (procgen is the filler being
superseded, not coverage). A cut node counts as covered when it is `ready` **or** a
coarser ancestor tile is `ready` — the same coarse-before-fine rule `buildCoverage()`
uses, since a ready ancestor visibly fills that screen region at a lower LOD.

**Area weighting.** Each cut tile contributes its **projected screen area** —
`projectedPixelExtent²` — not an equal vote, so a large near tile dominates a tiny
far one. Coverage is `Σ area(ready cut tiles) ÷ Σ area(all cut tiles)`. A single huge
near tile that is not yet ready therefore drags coverage well below `1` even when many
tiny far tiles are ready (and below an equal-*count* case where the near tile is the
one that is ready). The two accumulators are primitives folded into the existing cut
pass, so a settled cut adds no allocation, and `catalogCoverage()` itself just reads
the precomputed number.

## Allocation doctrine

The steady-state `update()` path (unchanging cut, everything loaded) allocates
nothing: all per-frame scratch (the visible array, the `VisibleChunk` view objects,
traversal stack, render-space vectors, the lifecycle event) is module/closure-scoped
and reused. The sanctioned **rare** allocations — like coords' `RebaseEvent` — are
the per-dispatch `AbortController`/`CancelToken`, the Morton parent-key strings
walked only while a cut is still loading, and the victim array on an over-budget
eviction frame. None occur on a settled cut.

## API

`createStreamingPolicy(opts) → StreamingPolicy` with `update`, `visible`,
`nearestBodyDistanceM`, `onChunk`, `setQualityTier`, `stats`, `catalogCoverage`,
`dispose`. Pure
helpers `projectedPixelExtent` / `screenSpaceError` (`sse.ts`), `selectLruVictims`
(`lru.ts`), `advanceFade` (`crossfade.ts`), and `effectiveMaxPoints` /
`estimateGpuBytes` (`budgets.ts`) are exported for reuse and testing.
