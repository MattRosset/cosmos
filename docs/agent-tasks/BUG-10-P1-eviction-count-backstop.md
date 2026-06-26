# BUG-10 P1 — evict-by-count backstop + `maxLoadedChunks` budget

**Type:** defensive hardening (not an active bug). **Priority:** low. **Lane:** `streaming`
(§7-sensitive — single-lane; do not run beside another streaming task). **Size:** S.

> Read first: `docs/research/bug-10-streaming-density-wall.md` (esp. §9b the P0 fix, and the
> "Residency re-measured" subsection — it is the evidence base for everything below).
> Master spec: `docs/architecture.md` §5.8 (streaming policy) + §9 (budgets). If this brief
> conflicts with the architecture or an ADR, the architecture wins — stop and report.

## Why this is NOT urgent (read before deciding to do it)

Measured 2026-06-25 on the real 3M Gaia pack: **residency is already bounded.** As the camera
moves, tiles that leave the cut fade out and are evicted by the *graceful* path
([policy.ts](../../packages/streaming/src/policy.ts) `update()` step 6 — the
`c.status === 'ready' && c.desiredEpoch !== frame && c.opacity === 0` branch). Flying Sol → 18 kpc,
`evictionsTotal` rose 0 → 699 and resident `trackedChunks` fell 885 → 186, with the fade tail
shrinking. There is **no residency leak**.

The single real gap: the **byte-gated LRU** (step 5) only fires when resident GPU bytes exceed
`budgets.maxGpuBytes` = 350 MB. At `GPU_BYTES_PER_POINT` = 20 ([budgets.ts](../../packages/streaming/src/budgets.ts))
that is ~17.5M resident points. A 3M pack is ~60 MB, so the byte-LRU is **effectively dead** for
any pack we currently build. It only becomes load-bearing for a pack whose *simultaneous working
set* exceeds ~17M points (the full all-sky deep Gaia, or several dense regions co-resident). This
task adds a count-based backstop so that case degrades gracefully instead of relying on a 350 MB
trip that a light-but-numerous pack may never hit.

**Do this only if** you are about to ship/test a pack materially denser than the 3M, or you want
the policy hardened defensively. Otherwise leave it; the graceful path covers the real workload.

## Problem statement

`enforceBudgets` (post-P0) caps *drawn* points/draws. Step-6 graceful evict caps residency under
motion. But neither caps the **count of resident chunks** directly, and the byte-LRU backstop is
unreachable at realistic pack sizes. A pathological pack could therefore pin a very large working
set (e.g. parked in an ultra-dense region whose cut alone is thousands of tiles) without any
count ceiling, and the only relief — the 350 MB byte trip — may never engage.

## Deliverables (modify ONLY these + their tests)

1. **`packages/streaming/src/budgets.ts`**
   - Add `maxLoadedChunks: number` to `StreamBudgets` and `DEFAULT_BUDGETS`. Pick a default that
     is safely above a healthy dense-pack working set so it never bites normal use — the 3M cut is
     754 and full residency 885; the 1M is 396. Suggest **`maxLoadedChunks: 2048`** (≈ 2× the 3M
     full pack, ~40 MB; comfortably above any single-view working set, low enough to bound a
     pathological multi-region accumulation). Document the reasoning in the doc comment.
   - Thread it through `resolveBudgets`.

2. **`packages/streaming/src/lru.ts`**
   - Add a count-aware victim selector (or extend `selectLruVictims`) that evicts oldest *unpinned*
     chunks until the resident **count** ≤ a cap, mirroring the existing bytes-based logic. Keep the
     pinned predicate semantics identical (never evict a pinned chunk even if that leaves the count
     over cap — correctness over the cap, exactly as the bytes path does).

3. **`packages/streaming/src/policy.ts`** — in `update()` step 5 (the eviction block):
   - After the existing byte-LRU, also trigger eviction when `countReady() > budgets.maxLoadedChunks`
     (or fold both triggers into one pass). Reuse the same `pinned` predicate already there
     (`desiredEpoch === frame || coverageEpoch === frame || cameraInside(c)`). The existing
     `evictChunk` path emits `evict` and frees — reuse it so the scene unmounts correctly.
   - Do **not** regress the steady-state allocation doctrine: no per-frame allocation when under
     budget (early-out before building any victim array; reuse scratch like the bytes path).

## Acceptance

- **New unit tests** (`packages/streaming/test/lru.test.ts` + a `policy.test.ts` case):
  - count-based victim selection evicts oldest-first until count ≤ cap; never selects a pinned item.
  - a policy fed more distinct ready chunks than `maxLoadedChunks`, with most *off the cut*, evicts
    down to ≤ cap and never evicts a cut/coverage/camera-pinned chunk (assert via `evict` events +
    `stats.loadedChunks`).
  - regression guard: with a small cut well under the cap, **zero** evictions fire and
    `evictionsTotal` stays 0 (don't over-evict the common case — this is the whole point).
- **Existing tests stay green**, especially `policy.test.ts` "budget degradation" and the LRU
  retreat test (`evicted` contains the deep leaves, never `'0/0'`).
- `pnpm verify` exits 0. `@cosmos/streaming` coverage not materially reduced.

## Validation (optional, live — the empirical proof)

The instrumentation is already in place (committed with P0): `window.__cosmos.streaming` exposes
`trackedChunks`, `loadedChunks`, `evictionsTotal`, `cutSize`. To exercise the new cap you need a
pack whose working set exceeds `maxLoadedChunks` — either build a denser pack (the full ~4.7M
subset, see the research doc §"build it yourself") or temporarily lower `maxLoadedChunks` to,
say, 300 in a local build and confirm: parked at Sol with the 3M, `loadedChunks` plateaus at the
cap (not 885) and `evictionsTotal` climbs, while frame time and the visible field stay stable
(pinned cut never evicted). Point `GAIA_OCTREE_MANIFEST_URL`
([App.tsx:116](../../apps/web/src/App.tsx)) at the local pack to test; revert it.

## Out of scope / do not do here

- Frustum culling or a cut node-budget (that is the separate P2; it bounds the *cut*, this bounds
  *residency*). They compose but are different changes.
- Re-tuning `maxGpuBytes` or `GPU_BYTES_PER_POINT`.
- Any change to the graceful step-6 evict — it works; don't touch it.
