# Galaxy octree streaming value near Sol

**Status:** complete — REFRAME  
**Started:** 2026-08-05  
**Scope:** research only — no production-code or task-spec changes

## Pre-registration

This section records the questions and kill conditions before the investigation's new
measurements. Earlier observations motivated the research (notably a historical Sol cut of
754/884 tiles and a visually-black Gaia pick at 3,440 pc); they are hypotheses/context, not
findings until rechecked below.

### Falsifiable questions

1. After settling near Sol, what fraction of the active pack's tiles, points, and bytes is
   resident, and what fraction is actually drawn after the draw-time culls?
2. Is a near-complete working set primarily caused by full-tree SSE selection without a
   frustum, camera-inside-volume geometry, threshold/hysteresis, coverage fallback/crossfade,
   missing cut budgets, or the pack's spatial structure?
3. Does near-complete residency create a material network, startup, memory, mount/upload, or
   frame-time cost at the current pack size, rather than merely looking architecturally
   inefficient?
4. How does the working set change with camera position, orientation, and exposure?
5. For a star catalog viewed from inside, which observable best describes “needed data”:
   distance, angular projection, apparent brightness, visible screen density, or a combination?
6. Can the current spatial octree express that observable efficiently, or does tile granularity
   force irrelevant stars to accompany relevant ones?

### Kill and redirect conditions

- **Kill a selector redesign** if the settled loaded fraction near Sol is low, or if its measured
  transfer/residency/mount cost is immaterial for the intended catalog scale.
- **Reject strict selection-time frustum culling** if its plausible residency reduction would
  require network fetches on ordinary camera rotation and therefore create visible pop-in; any
  viable direction would need a measured margin/prefetch contract.
- **Kill per-tile brightness as the primary streaming selector** if nearly every selected tile
  contains at least one potentially visible star, leaving the loaded fraction largely unchanged.
- **Do not prioritize streaming work from draw metrics** if the material cost is elsewhere;
  draw calls/points and loaded/resident tiles must remain separate measurements.
- **Reframe away from streaming selection** if the observed product defect is predominantly
  pick/render mismatch inside already-necessary tiles.
- **Reframe away from the current geometric SSE premise** if an inside-volume observer makes
  most spatial branches geometrically important while only a small photometric subset
  contributes visible pixels.

### Method constraints

- Read and measure current code; do not infer from task prose.
- Use existing hooks, manifests, browser/network observations, and read-only scripts. If a
  required metric is not exposed, record the absence rather than adding instrumentation.
- Keep co-timed values together; do not subtract independent peaks.
- Separate target cut, residency, draw visibility, perceptible stars, and picking.
- End with exactly one verdict: **ENABLE**, **KILL**, or **REFRAME**.

## Claims

### Claim 1 — the settled Sol working set is the whole active octree

CLAIM: At the shipped Sol start, the policy loads all 1,267 octree nodes in the local
4.63M-star Gaia pack (plus one procgen chunk): `loadedChunks = trackedChunks = 1,268`,
while the chosen target cut is 1,093 octree leaves plus procgen (`cutSize = 1,094`).

EVIDENCE: Fresh Chromium run against the full local pack, waited for
`pendingCount = inFlight = 0`: loaded 1,268, tracked 1,268, cut 1,094. Manifest census:
Gaia has 1,267 tiles = 1,093 leaves + 174 internal representatives; the union with HYG
still has 1,267 spatial keys.

VERIFIED: 2026-08-05

RECHECK: Start the web app against the full pack, wait for
`window.__cosmos.streaming.pendingCount === 0`, then read
`window.__cosmos.streaming.{loadedChunks,trackedChunks,cutSize}`. Recount
`apps/web/public/packs/octree-gaia/octree.json` by `tiles.length` and `isLeaf`.

### Claim 2 — full residency follows directly from selection, not an eviction leak

CLAIM: `selectOctree()` marks every visited node `desiredEpoch = frame` before deciding
whether to descend, and near Sol every internal node descends, so all ancestors and all
leaves remain desired. Ready desired chunks are pinned against both eviction paths.

EVIDENCE: `packages/streaming/src/policy.ts` ensures and marks every visited node; desired
chunks are pinned in LRU and ready chunks are evicted only after leaving the desired set.
A manifest-only replay of the fresh-cut SSE math at `[0,0,0.06]` visited all 1,267 nodes and
selected all 1,093 leaves, matching the browser within the one extra procgen target.

VERIFIED: 2026-08-05

RECHECK: Read `selectOctree`, request dispatch, and both eviction paths in
`packages/streaming/src/policy.ts`; replay `projectedPixelExtent` / `screenSpaceError` from
`packages/streaming/src/sse.ts` over the merged manifests with the fresh descend condition
`sse > 8 × 1.15`.

### Claim 3 — render budgets do not bound fetch or residency

CLAIM: The 2M-point / 300-draw budgets collapse coverage only after selection and request
dispatch; they can reduce policy-visible representations while leaving the entire desired tree
loaded.

EVIDENCE: `policy.update()` selects and dispatches pending chunks before calling
`enforceBudgets()`. At settled Sol the same frame reported 1,268 loaded chunks but exactly
300 policy-visible draws and 1,770,736 policy-rendered points.

VERIFIED: 2026-08-05

RECHECK: Read `StreamingPolicy.update`; compare `stats.loadedChunks` against `drawCalls` after
settling the full pack.

### Claim 4 — draw-time culling saves draws but cannot recover streaming cost

CLAIM: At settled Sol only 25 octree mounts survived both draw-time tile culls, despite all
1,267 octree nodes being loaded.

EVIDENCE: One co-timed frame after full settle reported 299 octree candidates from the
300-item policy-visible set: frustum kept 84 and culled 215; brightness then culled 59 of the
kept set, leaving `84 - 59 = 25`. `GalaxyScene.tsx` runs both tests after the policy has fetched,
decoded, mounted, and published ready chunks.

VERIFIED: 2026-08-05

RECHECK: After full settle, read `frustumCullStats`, `brightnessCullStats`, and the live policy
stats in one page evaluation.

### Claim 5 — tile granularity still carries mostly imperceptible points

CLAIM: Even inside the 25 tiles that survived both tile culls at Sol, only 18,476 of 233,795
points (7.90%) reached the frozen brightness floor 0.004; 92.10% remained below the floor and
were still scanned by Gaia picking.

EVIDENCE: Read-only browser replay over the batches published in `octreePickHolder.current`,
using the live camera, raw exposure 25 × galaxy boost 6, and the shipped shader formula,
counted: `>=0.004` 18,476; `>=0.02` 6,982; `>=0.1` 2,635.
`octree-pick.ts` scans every Gaia point in each published batch without a brightness test.

VERIFIED: 2026-08-05

RECHECK: At settled Sol, iterate every published pick batch and evaluate production photometry
per point using its actual camera-relative distance and effective exposure.

### Claim 6 — the current full-pack cost is material on the measured machine

CLAIM: A fresh local Chromium boot selected the whole tree within 836 ms but needed 14.229 s to
fetch/decode all selected chunks; resource timing recorded 1,288 octree requests / 157,974,276
encoded bytes, and settled GPU estimate was 149,370,600 bytes.

EVIDENCE: Fresh browser context with resource timing buffer expanded to 10,000: app-ready
399 ms, `trackedChunks >= 1268` 836 ms, fully settled 14,229 ms. The pack manifests contain
152,761,084 raw tile bytes (149,583,224 Gaia + 3,177,860 HYG). This is a
local-dev/SwiftShader measurement, not a production CDN latency claim.

VERIFIED: 2026-08-05

RECHECK: In a fresh browser context, timestamp app-ready, tracked 1,268, and
`pendingCount = inFlight = 0`; sum `encodedBodySize` for `/packs/octree` resources and read
`stats.gpuBytesEstimate`.

### Claim 7 — streaming still changes the working set away from Sol

CLAIM: Residency is position-sensitive and shrinks substantially away from the pack center, so
the streaming system is not globally equivalent to an eager monolith.

EVIDENCE: Settled co-timed runs on one navigation sequence:

- Sol: loaded/tracked 1,268; cut 1,094; GPU 149.37 MB.
- 500 pc: loaded/tracked 1,268; cut 1,094; GPU 149.37 MB.
- Gaia case at ≈3,440 pc: loaded/tracked 636; cut 541; GPU 83.69 MB.
- 6,000 pc: loaded/tracked 500; cut 422; GPU 70.12 MB.
- 18,000 pc: loaded/tracked 204; cut 163; GPU 42.53 MB.
- Return to Sol: loaded/tracked returned to 1,268 and the dev resource-timing sum rose from
  158.98 MB to 295.51 MB. Browser/CDN caching may change transferred bytes in production;
  there is no app-level decoded-tile cache.

VERIFIED: 2026-08-05

RECHECK: Use `controllerHolder.current.goTo()` for the five galaxy positions, wait after each
for `pendingCount = inFlight = 0`, then read all stats in one page evaluation.

### Claim 8 — orientation and exposure cannot affect selection today

CLAIM: The streaming selector cannot distinguish facing direction or live exposure: its public
update input is only viewport height and elapsed time, and selection reads node center/extent,
camera-relative distance, point count, and fixed FOV/SSE constants.

EVIDENCE: `StreamingPolicy.update(viewportHeightPx, dtMs)` and `selectOctree()` have no
orientation, frustum, exposure, or magnitude metadata input. `OctreeTileManifest` has no
min/max magnitude field.

VERIFIED: 2026-08-05

RECHECK: Read the cited interfaces/functions and search `packages/streaming/src` for
`orientation|frustum|exposure|absMag`.

### Claim 9 — a strict current-frustum selector has leverage but fails no-pop-in by itself

CLAIM: A conservative identity-camera sphere-frustum replay before SSE reduced the Sol manifest
traversal from 1,267 to 285 accepted nodes (22.5%) and the target cut from 1,093 to 188, but
those absent directions would need data fetches on ordinary rotation.

EVIDENCE: Manifest-only replay used the exact `tileOutsideFrustum` sphere equations and current
fresh SSE condition. The measured full local load takes 14.2 s; therefore an exact-frustum
selector cannot promise next-frame detail for an uncached 180° turn. The reduction is an
upper-bound direction, not an implementation-ready result.

VERIFIED: 2026-08-05

RECHECK: Traverse the merged manifest from `0/0`; reject node spheres with production frustum
math, then apply current SSE to accepted nodes. Repeat after rotating the frustum and measure
cache/prefetch behavior before specifying.

## What I looked for and did not find

- No selection-time frustum or camera-orientation input.
- No selection-time exposure or apparent-brightness input.
- No `minAbsMag` or equivalent subtree brightness bound in the manifest. The packer preserves
  brightest-N internal representatives, but runtime discovers a tile minimum only after loading.
- No node/count/byte budget on `targetList` or the visited/desired set. Existing point and draw
  budgets normalize coverage after requests have already been issued.
- No application-level decoded-tile cache after eviction; normal HTTP caching remains
  browser/server-dependent.
- No hook field for post-draw point count or per-star perceptibility. The investigation queried
  existing holders and replayed shipped shader math read-only.
- No evidence that distance alone can define relevance. Intrinsically luminous distant stars
  can remain visible; photometric contribution and view coverage are independent axes.

## Measurements

### Active pack

- Gaia: 1,267 tiles; 1,093 leaves carrying 4,629,554 catalog stars; 174 internal
  brightest-N representatives carrying 712,704 duplicated LOD points; 149.58 MB raw tiles.
- HYG: 9 tiles; 109,399 leaf stars + 4,096 root representatives; 3.18 MB raw tiles.
- Combined spatial-key count: 1,267.

### Sol settled

- Resident: 1,267/1,267 octree keys (100%) plus procgen.
- Target cut: all 1,093 Gaia leaves plus procgen.
- Policy-visible after budget: 300 representations / 1,770,736 points.
- Draw-time octree survivors: 25 tiles.
- Points in those survivors: 233,795 total; 18,476 (7.90%) at brightness ≥ 0.004.
- Full-settle time: 14.229 s local; GPU estimate 149.37 MB.

### Sensitivity replay (manifest-only, fresh descend state)

- Default nominal SSE threshold 8: visit 1,267 / cut 1,093.
- Threshold 16: visit 1,011 / cut 869 — still 79.8% of nodes.
- Threshold 32: visit 9 / cut 8 — a cliff to eight level-1 cells, not a calibrated
  quality-preserving result.
- Default SSE plus strict current frustum: accept 285 / cut 188.

The threshold cliff shows that “just tune SSE” is not a defensible solution: this pack's deep
branches cluster on one side of a broad gap, and quality was not measured.

## Mechanism

The octree is lazy at the file level, but its definition of demand is geometric and
observer-centered. Every frame it starts at the root. For every visited node it creates a chunk
record and marks it desired, then computes projected extent from `halfExtent / distance-to-center`.
Near Sol, the camera is inside large cells and dense-pack internal nodes all exceed the descent
threshold, so traversal reaches every leaf. Because visited ancestors remain desired as coarse
fallback, the stable working set becomes the entire tree, not merely the leaf cut.

Requests are bounded to six concurrent operations, which makes the eager decision progressive
rather than memory-safe by selection. Render budgets later collapse coverage to at most 300
representations, and GalaxyScene later hides most by frustum and tile brightness. Neither stage
can undo network, decode, CPU batch, mount, or GPU residency already paid.

The spatial octree is still useful: moving away raises node distance, lowers SSE, releases nodes
from the desired set, and eviction works. The mismatch is specifically the common inside-volume
Sol regime. Geometric SSE asks how finely to represent the whole surrounding volume; the product
asks which catalog contribution can affect the current or imminent image. Those are not
equivalent.

The data also exposes a second granularity mismatch. Whole-tile brightness culling removes many
tiles, but surviving tiles are retained by one bright member and still carry 92% points below
the visibility floor. Selection-only work cannot by itself fix black-sky picking or per-point
GPU waste.

## Verdict

**REFRAME.** The premise “streaming has no value because it loads everything” is true for
settled residency near Sol on the active pack, but false globally: the working set falls to 16%
of its Sol size by 18 kpc and eviction behaves correctly. The premise that current demand means
“data needed for the image” is what dies. It means “nodes visited by an unbounded,
orientation-blind geometric SSE traversal,” and at the center that is the whole tree.

Do not specify “load only nearby stars” or a strict current-frustum selector from this result.
The next decision must be about a **bounded, visibility-prioritized working set with a
rotation/exposure prefetch contract**, plus **intra-tile photometric granularity** so one bright
star does not make hundreds of thousands of black points resident, rendered, and pickable.
Candidate mechanisms (frustum margin, best-first cut budget, subtree min-magnitude metadata,
magnitude bins/bright-prefix batches) need a separate comparison against measured rotation
latency and visible-star recall before any task is enabled.

## Where this went (2026-08-05)

- `TASK-097` — extract `@cosmos/photometry` (pays regardless of any verdict below).
- `TASK-100` — Claim 5's user-visible half: gate the Gaia pick on perceptibility. Independent of
  the streaming candidates; ships first.
- `TASK-096` — freeze the Natural/Survey display contract the profiles depend on.
- `TASK-098` — co-timed `galaxyWorkingSet()` snapshot (the oracle for the replay).
- `TASK-099` — selector + prefetch candidate replay, with per-profile GO/STOP verdicts.
- `TASK-101` — photometric band layouts, gated on a TASK-099 GO.

Nothing above changes this document's findings; it records which decisions they fed.
