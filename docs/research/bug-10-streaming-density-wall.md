# BUG-10 — the dense Gaia pack overwhelms streaming (deep research)

Focused investigation of why moving the camera with a dense (~3M, levels 0–11) Gaia pack
thrashes until the tab hangs. Continuation of `gaia-visibility-real-pack-and-perf.md` §6.
The deeper goal behind the bug: load the **real local density** ("lugar 2"), see what the
galaxy looks like from the inside, and decide whether procgen still belongs there.

Status: research only, no code changed. `combineOctreeSources` is at HEAD (the BUG-8
push-down is **reverted**, so push-down amplification is **not** in the current tree —
see §3).

---

## 0a. Current state — verified before any work (2026-06-25)

Inspected the working tree directly; this is the *actual* state, which differs from the prior
handoff's assumptions:

- **`main` is clean** (only this doc untracked). No streaming/octree changes pending.
- **The app is wired to the 135-star sample.** `App.tsx` **hardcodes**
  `GAIA_OCTREE_MANIFEST_URL = '/packs/octree-gaia-sample/octree.json'`
  ([App.tsx:116](../../apps/web/src/App.tsx), used in 4 `loadOctreePack` call sites). The
  `VITE_GAIA_OCTREE_URL` env override from the prior thread was **reverted** — there is **no**
  `apps/web/.env.local` and **no** `apps/web/src/vite-env.d.ts`. So swapping packs today means
  editing that constant (or re-adding the env override), not dropping an `.env.local`.
- **The real packs are gone from disk.** `apps/web/public/packs/octree-gaia/` is **empty** and
  `tools/pack-octree/snapshots/` is **empty** — the 469k and 3M local packs *and* the Gaia
  snapshot CSVs were deleted (consistent with the handoff's "ship only validated, discard the
  rest" decision).
- **⇒ BUG-10 is not currently reproducible.** Reproducing it requires rebuilding first:
  1. re-pull a Gaia snapshot from the ESA TAP (handoff §4 has the async ADQL query),
  2. rebuild the pack with `pnpm --filter @cosmos/pack-octree build:gaia` (absolute paths),
  3. re-point the manifest URL (swap the `App.tsx` constant or re-add the env override).

  The two committable build-tool fixes (`collectLeafPoints` stack overflow, dedup index) needed
  to build the real catalog at all **are** in the tree (`tools/pack-octree`), so step 2 works.

This is the baseline the rest of the doc analyses: the *code paths* below exist and are current,
but the *dense pack that triggers them* must be rebuilt before any measurement (§5–§6).

---

## 0. TL;DR

> **UPDATE (2026-06-25, measured live — see §11): the real frame-time killer is
> `enforceBudgets`, an O(cut²) collapse running every frame — 99.6% of the cost.** Not
> eviction, not residency, not rendering. The original four-lever analysis below was written
> from code reading; the levers are real (eviction never fires, the whole pack goes resident)
> but they are *memory/residency* issues, not what makes it 1.2 fps. Read §11 first, then the
> levers as context. The fix is to rewrite `enforceBudgets` from O(n²) to O(n log n); frustum
> culling / cut-budget are no longer required for the frame-time wall.

The render path is fine. The **working-set management** is not. Four levers compound:

1. **Eviction never fires** — it is gated on GPU *bytes* (350 MB ≈ 17M pts), but a 3M pack
   is ~60 MB. So nothing is ever evicted: loaded tiles only ever accumulate. **This is the
   primary cause** and the cheapest to fix (evict/cap by *count*).
2. **No frustum culling** — `update()` only gets `viewportHeightPx`, never a camera frustum,
   so the SSE descent loads tiles in *all directions*, including behind the camera. Inside an
   all-sky pack that is roughly a 2–4× working-set multiplier of pure waste.
3. **The cut is unbounded** — `selectOctree` is a full DFS that descends every node whose SSE
   exceeds threshold, with no node/point budget. Deep + dense ⇒ hundreds of cut tiles, all
   turned into pending loads.
4. **The cut is unstable under motion** — every frame re-descends from root; as the camera
   moves the fringe constantly cancels + re-requests, pinning the 6 decode workers and
   churning GPU uploads.

Recommended: **instrument the four levers, bisect which dominates, fix the dominant one
first** (almost certainly #1), rather than building the full best-first refactor blind. A
count-based eviction + a cut/node budget is likely enough to unblock the density goal; frustum
culling is the larger structural win to schedule next.

---

## 1. The pipeline — how a tile becomes pixels

Per frame, on the main thread, `GalaxyScene` calls `streaming.update(viewportPx, dtMs)`
([GalaxyScene.tsx:371](../../apps/web/src/scene/GalaxyScene.tsx)). Inside
`createStreamingPolicy.update()` ([policy.ts:536](../../packages/streaming/src/policy.ts)):

1. **`selectOctree`** ([policy.ts:374]) — DFS from `octree.root`. For each visited node:
   `ensureOctreeChunk` (creates/looks up a `Chunk`), `measure` (`origin.toRenderSpace` →
   `distUnits`), project to a pixel extent, compute SSE, and **descend** if
   `sse > threshold·(1±hysteresis)`. Nodes that stop descending are pushed to `targetList`
   (the *cut*). No frustum test, no node cap.
2. **cancel stale** ([policy.ts:551]) — chunks not desired this frame are cancelled (if
   in-flight) or dropped (if pending).
3. **issue requests** ([policy.ts:561]) — pending cut chunks, sorted coarse-then-near, are
   dispatched until `_inFlight === maxInFlight` (6). `dispatchChunk` → `octree.loadTile`.
4. **coverage + budget** ([policy.ts:573]) — `buildCoverage` picks the deepest ready ancestor
   per target; `enforceBudgets` collapses the deepest coverage nodes into ready parents until
   `renderedPoints ≤ cap` and `coverageList.length ≤ maxDrawCalls`. **This caps what is
   *drawn*, not what is *loaded*.**
5. **LRU eviction** ([policy.ts:577]) — only entered when total resident GPU bytes exceed
   `maxGpuBytes`. Victims are unpinned, oldest-first, freed until under budget.
6. **cross-fades + graceful evict** ([policy.ts:598]) — chunks that left the cut fade to 0
   then evict.
7. **build visible + stats** ([policy.ts:611]).

`loadTile` ([octree.ts:117](../../packages/data/src/octree.ts)): fetch bin → validate slices →
**SHA-256 the raw bytes** → dispatch `octree.decode` to the worker pool (transfers the bin).
Decode happens off-thread. On resolve, `onReady` stamps the batch and emits `ready`.

`GalaxyScene` queues ready octree batches into `deferredOctree` and mounts only
**`OCTREE_FLUSH_PER_FRAME = 2`** per frame while not flying
([GalaxyScene.tsx:392](../../apps/web/src/scene/GalaxyScene.tsx)) — so GPU *upload* is already
throttled, but decode/residency is not.

Pool size = `defaultPoolSize()` (≈ `min(hardwareConcurrency−1, …)`). The render budget
(`DEFAULT_BUDGETS`: ≤2M pts, ≤300 draws, 350 MB, 6 in-flight) lives in
[budgets.ts:19](../../packages/streaming/src/budgets.ts).

---

## 2. Why it hangs — the four compounding levers

### Lever 1 (primary): eviction is byte-gated and never fires for a dense pack
[policy.ts:581] enters LRU only when `totalGpu > budgets.maxGpuBytes` (350 MB). GPU bytes per
point = 20 ([budgets.ts:45]). The full 3M pack ⇒ ~60 MB resident — **6× under the cap**. So
`selectLruVictims` is never called; tiles that leave the cut only leave via the opacity-0
graceful path ([policy.ts:605]), which requires them to have fully faded *and* left the cut.
Anything that stays marginally in/near the cut as you sweep accumulates. Measured: `loadedChunks`
climbs to 480 and keeps climbing. The byte cap was tuned for a world where 350 MB ≈ 17M points
is the real ceiling; a dense-but-small-per-point pack defeats it. **Fix surface:** add a
`maxLoadedChunks` budget and evict by count (or by count *or* bytes, whichever trips first).

### Lever 2: no frustum culling — half the loaded tiles are off-screen
`update()`'s only spatial input is `viewportHeightPx`. The descent has no camera orientation,
so SSE is computed purely from distance + extent and the cut includes tiles **behind and beside
the camera**. For a Sol-local viewer inside an all-sky pack this is the difference between
"the ~½ sphere I can see" and "the whole sphere". The fix is structural: thread a frustum (or at
least the camera forward axis + FOV) into `update()` and reject nodes whose projected box is
fully outside it before descending. Note `selectOctree` already computes `camRel` per node
(`measure`), so a frustum test is cheap to add at that point — the data plumbing
(`update` signature) is the work.

### Lever 3: the cut is unbounded (full-DFS SSE descent, no budget)
[policy.ts:374] descends *every* node over threshold. There is no cap on `targetList.length`
nor on descent depth. A levels-0–11 pack viewed from inside produces hundreds of leaf tiles in
the cut, each becoming a pending → dispatched load. `enforceBudgets` later collapses *coverage*
back to ≤300 draws, but the loads were already issued and the tiles already decoded+resident.
The canonical fix is a **point-budget best-first descent** (à la Potree): maintain a priority
queue of nodes by SSE/screen-area, pop-and-expand until a node/point budget is hit, and treat
the frontier as the cut. That bounds the cut deterministically regardless of pack depth.

### Lever 4: cut instability under motion → decode + upload churn
Every frame re-descends from root and re-decides per node (with 15% hysteresis,
[policy.ts:399]). While moving, fringe nodes flip in/out of the cut, so each frame cancels some
in-flight loads and re-requests others. With only 6 in-flight slots and hundreds of cut nodes,
the queue **never drains** — the decode workers stay pinned and the GPU sees a steady trickle of
new uploads (2/frame mount throttle helps but does not stop it). The sanctioned per-request
allocations (`AbortController`, `CancelToken`, event objects, and `concatBatches`' 5 typed
arrays when HYG∩Gaia share a tile) become a steady allocation rate under churn → GC pressure.
Hysteresis already exists; a coarser cut (levers 1–3) is what actually shrinks the churn surface.

---

## 3. What is NOT the problem (rule-outs)

- **The render/draw budget works.** Measured `renderedPoints ≤ 2M`, `drawCalls ≤ 300`
  ([budgets.ts:19], `enforceBudgets`). It is not drawing 3M. The hang is upstream of draw.
- **The push-down is not in the tree.** `octree-combined.ts` is at HEAD — no `pushDownIntoCell`.
  So the "push-down amplifies BUG-10" item from the prior handoff (§6 cause #2) does **not**
  apply to the current code. If BUG-8 is revived, it returns; design the Morton-range index
  alongside it then.
- **SHA-256 is off the hot path.** `crypto.subtle.digest` runs natively off the JS thread; the
  hex map is over 32 bytes. It adds latency per load but is not the CPU sink. (It is still a
  candidate to fold into the decode worker to remove a main-thread await + a full-buffer read.)
- **Manifest size is fine.** All 884 tile manifests live in `_nodeMap` ([octree.ts:98]); that is
  a one-time ~KB-per-tile map, not a per-frame cost.

---

## 4. Solution space (ranked)

| # | Fix | Mechanism | Effort | Risk | Where |
|---|-----|-----------|--------|------|-------|
| A | **Evict/cap by count** | add `maxLoadedChunks`; trigger LRU on count too | **S** | low | `budgets.ts`, `policy.ts:577`, `lru.ts` |
| B | **Cut/point budget** | best-first descent with a node/point cap; bound `targetList` | M | med | `policy.ts:374` (`selectOctree`) |
| C | **Frustum culling** | thread frustum into `update()`, reject off-screen boxes pre-descend | M–L | med | `policy.ts` signature + `GalaxyScene.tsx:372` + every caller/test |
| D | **Adaptive / coarser SSE** | raise `DEFAULT_SSE_THRESHOLD_PX`, or scale it by cut size/pack depth | S | low | `sse.ts:21`, `policy.ts` |
| E | **Fold hash into decode worker** | hash inside `octree.decode`; drop main-thread await | S | low | `octree.ts:117`, `octree.worker.ts` |
| F | **Stiffer cut hysteresis / debounce** | re-descend less often / wider hysteresis to cut churn | S | low–med | `policy.ts:399`, `crossfade.ts` |

Notes:
- **A is the unlock.** It directly bounds residency and is small, local, and unit-testable
  (`selectLruVictims` already takes injected predicates). Likely sufficient on its own to make a
  dense pack *navigable*, even if not optimal.
- **B is the principled cut bound.** Pairs naturally with A: A bounds what stays, B bounds what
  enters. Best-first by projected area is the textbook point-budget streamer.
- **C is the biggest structural win** but the most invasive (changes the frozen-ish `update()`
  contract and touches every caller + the streaming tests). Schedule as its own task; it also
  pays off for *every* pack, not just dense ones.
- **D is the cheap knob** to validate the hypothesis fast (one constant) but is a band-aid: it
  trades density for stability globally rather than bounding the working set.
- **E/F are polish** that reduce churn cost but do not bound the working set.

---

## 5. Recommended path — empirical-first

Do **not** build the best-first refactor (B) or the frustum plumbing (C) blind. Match the
established debugging doctrine (measure / bisect / instrument):

1. **Instrument the levers.** Extend the `window.__cosmos.streaming` mirror (test-hook.ts) or a
   dev-only `update()` counter set with: `cutSize` (`targetList.length`), `pendingCount`,
   `requestsThisFrame`, `cancelledThisFrame`, `evictions/frame`, `residentChunks`,
   `residentBytes`, and `frustumRejected` (once C exists). These already mostly exist as
   primitives in the policy — just expose them.
2. **Bisect with the 3M pack** (rebuild it first per §0a, then point `GAIA_OCTREE_MANIFEST_URL`
   at it). Park (static) vs. sweep, and read the counters. Confirm the §0 prediction: static is fine,
   sweeping pins `inFlight=6`, `loadedChunks` monotonically climbs, `evictions≈0`.
3. **Land Lever A first** (count cap). Re-measure: residency should plateau, sweeping should
   stay interactive. If that alone clears the hang → ship A, defer B/C.
4. **If the cut itself is still too big** (A plateaus residency but decode workers stay pinned
   because the cut is genuinely hundreds of tiles), add **B** (cut budget). Use D as a quick
   sanity probe first: bump `DEFAULT_SSE_THRESHOLD_PX` and confirm cut size drops and lag eases —
   that proves the cut-size hypothesis before investing in best-first.
5. **Schedule C** (frustum) as a separate structural task with the density goal as its
   acceptance test: stand inside the dense plane, look around, working set tracks the view.

This ordering ships the unblock (A, maybe +D probe) in one reviewed commit and keeps the larger
refactors (B, C) honest — each justified by a measured residual, not a guess.

---

## 6. Validation plan

- **Repro harness:** rebuild + point at the local 3M pack (§0a); a scripted sweep (reuse a SoakProbe/Flythrough
  probe path through the dense plane) so the thrash is deterministic, not hand-flown.
- **Pass criteria:** during the sweep, `loadedChunks` bounded (plateaus, not monotonic),
  `inFlight` not permanently pinned at 6, frame time stays under the budget, no tab hang.
  Visually: density looks right, no LOD popping from over-aggressive collapse.
- **Regression guard:** the existing m4a / flythrough4 gates must stay green (the near-Sol 469k
  debug pack path must not regress — A/B must not over-evict the small-cut case). Gate locally on
  `pnpm verify` + bundle; leave Playwright e2e/screenshots to CI.
- **Unit tests:** count-based eviction in `lru.test.ts` (victims chosen by count over budget,
  pinned never chosen); cut-budget descent in a new `policy` test (deep synthetic tree ⇒ cut
  size ≤ budget, highest-SSE nodes retained).

---

## 7. Open questions

1. **Is the hang CPU (decode/orchestration) or GPU (uploads)?** Instrument both; it changes
   whether E/mount-throttle matters. Prediction: CPU-bound on decode + main-thread orchestration,
   GPU secondary (draw is capped).
2. **What working-set size is "smooth"?** Pick `maxLoadedChunks` empirically from the 469k pack
   (which renders smoothly: 331 tiles) — the cap should sit comfortably above a healthy small-pack
   cut but well under the 3M runaway.
3. **Does the density goal even need the full 3M?** The 469k pack already renders smoothly. If A+B
   make ~1M navigable, that may be enough to answer "what does it look like from inside / does
   procgen still belong" without the full subset.
4. **Frustum vs. the procgen blend (BUG-9).** Frustum culling changes which tiles are resident
   per view; confirm it does not perturb the distance-driven procgen fade (it should not — that
   fade is camera-distance, not coverage, post-`77db8ed`).
5. **Combined-source identity** (the latent `idPrefix` mixing) is orthogonal but will surface
   once a dense Gaia∩HYG overlap actually loads — note it, do not fix it here.

---

## 9b. P0 fix landed + validated (2026-06-25)

Rewrote `enforceBudgets` from the O(cut²) per-iteration-rescan + per-element Morton-re-encode
into an O(cut) deepest-first **bucket-by-level** collapse with incremental `pts`/`draws`
running totals (`packages/streaming/src/policy.ts`). Same greedy semantics (collapse the
deepest covered node into its ready parent until within budget); each node now visited O(1)
times (one `parentKey` per node). `@cosmos/streaming` typecheck + **28/28 tests** green
(budget-degradation contract preserved).

**Re-measured on the 3M pack, static at Sol (same setup as below):**
| metric | before | after |
|--------|-------:|------:|
| `enforceBudgets` | 384 ms | **1.9 ms** |
| `streaming.update` total | 385 ms | **2.0 ms** |
| **fps** | **1.2** | **163.9** (== the 135-star baseline) |
| frame max | ~840 ms | **6.2 ms** |
| draws | 2 (over-collapsed) | **300** (fills the budget) |
| rendered points | 1.0M | 1.8M |

~**200× on the hot phase; 1.2 → 164 fps.** The dense pack is now navigable; moving just re-runs
the same 2 ms `update()`, so the "moving thrashes" symptom is gone with it. As a bonus the fix
also stopped the old over-collapse (2 draws), so the budget is now actually filled (300 draws /
1.8M pts ⇒ more visible detail). Eviction still never fires (`evictionsTotal=0`, whole pack
resident) — that is the **P1 memory** item, untouched and not on the frame-time path.

**Open (separate axis — visual, not perf):** parked at Sol the view is near-black despite 1.8M
points drawn (no render error). Consistent with the post-BUG-9 model — procgen faded off near
Sol + faint individual real stars. This is exactly the "what does the real density look like
from inside / does procgen still belong" question; pursue it next, independent of P0.

---

## 9. Empirical results (measured live, 2026-06-25)

Built the real packs from a fresh ESA TAP snapshot (3,000,001 rows, mag ≤ 12.5) and measured
in the live app via the `?debug=breadcrumb-profile` span profiler + the new policy phase timers
(§10). Camera parked at Sol, galaxy context, **static** (the wall shows up before you even move).

**Packs built** (gitignored, `apps/web/public/packs/`):
| pack | stars | tiles | levels | size |
|------|------:|------:|-------:|-----:|
| `octree-gaia-sample` (committed) | 135 | 1 | 0 | — |
| `octree-gaia-1m` (mag ≤ 11.2) | 938,761 | 395 | 0–~9 | 42 MB |
| `octree-gaia` (the 3M) | 2,961,924 | 884 | 0–11 | 119 MB |

**Frame cost, static at Sol** (preview runs at 164 fps with the sample → rAF is *not*
throttled, so these are real):
| pack | `streaming.update` | render | fps | cut | tracked | evictions |
|------|-------------------:|-------:|----:|----:|--------:|----------:|
| sample-135 | ~0 | 0.1 ms | **164** | 9 | 10 | 0 |
| 1M | **207 ms** | 0.1 ms | ~5 | 324 | 396 | 0 |
| 3M | **385–450 ms** | 0.1 ms | **~1.2** | 754 | 885 | 0 |

**Phase split of `streaming.update()` on the 3M pack** (policy phase timers, §10):
| phase | ms | share |
|-------|---:|------:|
| **`enforceBudgets`** | **384.0** | **99.6%** |
| `buildCoverage` | 1.3 | 0.3% |
| `selectOctree`+`selectProcgen` | 0.2 | <0.1% |
| cancel/request | 0.1 | — |
| evict/fade/visible | ~0 | — |
| **total** | **385.6** | |

**Conclusions (ground truth, superseding the §0 four-lever framing):**

1. **`enforceBudgets` is the wall — 99.6% of the frame.** Not rendering (0.1 ms drawing 2
   collapsed draw calls / 1M points), not selection (0.2 ms — `origin.toRenderSpace` per node is
   cheap), not eviction. The first code-reading hypothesis (O(n²) enforce) was right; the
   "linear / selectOctree" detour was a two-point coincidence — the phase profiler settled it.
2. **Why it explodes:** the cut (754) hugely exceeds `maxDrawCalls` (300), so `enforceBudgets`
   collapses ~hundreds of cut nodes into coarse ancestors **one node per `while` iteration**, and
   each iteration is O(coverageList): `sumCoveragePoints()` rescans the whole list *and* the
   "find deepest collapsible" loop calls `parentKey()` (Morton **decode+encode**, string ops) per
   element. Net ≈ O(cut²) × Morton-encode ⇒ ~275k Morton ops ⇒ 384 ms.
   ([policy.ts](../../packages/streaming/src/policy.ts) `enforceBudgets`.)
3. **Eviction never fires** (`evictionsTotal = 0` with 527–885 chunks resident) and **the whole
   pack goes resident** (`trackedChunks = 885` ≈ all 884 tiles, even static) — Levers 1 & 3
   confirmed, but these are **memory/residency** facts, not the frame-time cause. They matter for
   a longer session (memory growth) and they hand `enforceBudgets` a huge cut to chew, but fixing
   them does not by itself fix the 1.2 fps.

**Revised fix priority:**

- **(P0) Rewrite `enforceBudgets` from O(n²) to O(n log n)/O(n).** Keep a running point-sum
  instead of `sumCoveragePoints()` per iteration; replace the per-iteration linear "find deepest"
  with a one-time sort or a max-heap keyed by level; store a parent *reference* on the chunk to
  avoid `parentKey()` Morton round-trips. Small, local, unit-testable. Expected: 384 ms → low
  single-digit ms, i.e. the 3M becomes navigable **without** frustum culling or a cut budget.
- **(P1) Cap loaded chunks / evict by count** (Lever 1) — still wanted so a long session doesn't
  grow unbounded in memory; not on the frame-time critical path.
- **(P2) Cut/point budget, frustum culling** (Levers 3, 2) — now *optimizations*, not
  requirements. Worth doing for very deep packs, but the P0 fix likely unblocks the density goal
  on its own.

**Knee for the density goal:** the 1M pack (395 tiles, fully resident, no eviction) still costs
207 ms in `enforceBudgets` — so the knee is the *enforce algorithm*, not a star count. After P0,
re-measure to confirm both 1M and 3M are smooth; the 3M is the real local density and the answer
to "what does it look like from inside / does procgen still belong" should be taken there.

---

## 10. Instrumentation added (this thread)

Additive, read-only, behaviour-neutral; verified `@cosmos/streaming` typecheck + 28/28 tests and
`web` typecheck. Candidate for its own `feat(streaming): …` diagnostic commit.

- `StreamingStats` (+ `window.__cosmos.streaming`): `cutSize`, `pendingCount`, `trackedChunks`,
  `evictionsTotal` (cumulative — distinguishes "never evicted" from "keeping up").
- `StreamingPolicy.phaseMs()` (+ mirrored to `window.__cosmos.streaming.phaseMs`): per-phase ms of
  the last `update()` — `select / cancelRequest / coverage / enforce / evictFadeVisible / total`.
- `App.tsx` `GAIA_OCTREE_MANIFEST_URL` swapped to the local dense pack for measurement (revert to
  the committed sample before shipping); `.gitignore` covers the local packs + snapshots.

---

## 8. Pointers

- Prior handoff (pack reality, build steps, Cloudflare): `gaia-visibility-real-pack-and-perf.md`.
- Procgen fade model (post-BUG-9): `docs/galaxy-rendering-model.md`,
  `docs/research/galaxy-procgen-coverage-regression.md`.
- Policy/budgets/SSE/LRU: `packages/streaming/src/{policy,budgets,sse,lru}.ts`.
- Data source / loadTile: `packages/data/src/octree.ts`.
- Scene host / mount throttle / procgen blend: `apps/web/src/scene/GalaxyScene.tsx`.
