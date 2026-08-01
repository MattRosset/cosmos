# Task: Gaia octree-stream pick → real DR3 identity (Task B, carve-out of TASK-069)

**ID:** TASK-088
**Target package:** `apps/web` (pick wiring: `scene/StarScene.tsx`, `scene/GalaxyScene.tsx`,
a new `glue/` pick helper + holder, `app/packs.ts`, and the two apps that mount both the
galaxy stream and the star scene — `app/StarApp.tsx`, `app/M4aApp.tsx`).
**Size:** L
**Phase:** Maintenance track — "Gaia realness" thread (the reframe's **Task B**).
**Origin:** The pick half of TASK-069, deferred by the reframe in
`docs/research/gaia-pick-identity-gap.md` (cherry-picked onto this branch 2026-08-01, commits
`c32cc6d..369c975` — it was authored on branch `research/gaia-pick-identity-gap` and is now
in-tree, so the citations below resolve). TASK-087 (merged, commit `86ee098`) built
the two data/provenance pieces this task **consumes**:
- **D1** — `loadGaiaSourceIds(manifestUrl)` (`packages/data/src/gaia-sourceids.ts`): a lazy
  resolver, `resolve(catalogId) → Promise<bigint | null>`, mapping a pack-global Gaia
  `catalogId` → the real DR3 `source_id` (bigint end-to-end).
- **D2** — `CombinedOctreeSource.prefixRangesFor(key)` (`apps/web/src/glue/octree-combined.ts`):
  per-source provenance (`PrefixRange = { offset, count, idPrefix }`) for a merged tile, since
  `batch.idPrefix` collapses to the first source and is not authoritative for a mixed tile.

**Provenance:** spec-task 2026-08-01, written against live code (all Step 0 facts verified this
session). The four decisions TASK-087 flagged for B are pre-resolved below: (1) the pick is
added as a **pure gaia-range scanner** fed by a GalaxyScene-published mount holder, following
the `localGroupPickHolder` / `systemPickGroup` precedent; (2) `prefixRangesFor`'s current
`MortonKey`-keyed shape is used **as-is** — for an octree tile `chunkId === MortonKey`
(verified: `policy.ts:295,316`, `loadTile(node.key)` at `:380`), so it is already batch-keyed
for mounts, **no shape change**; (3) `packs.ts:41` is re-typed to `CombinedOctreeSource` (B is
the consumer); (4) scope of the resolved id = **selection only** (a `gaia:<source_id>` bodyId
flows into the selection store → Breadcrumb shows the string), decided with the user
2026-08-01. A legible identity UI / info-card is **Task C**, out of scope here.

**spec-review 2026-08-01** (facts re-verified against live code): all cited line ranges
confirmed. Two fixes applied in place: (1) **internal consistency** — `onDoubleClick`
(`StarScene.tsx:336-340`) does NOT `select()`; it calls `onActivate` (go-to). Step 0f + D4
corrected. (2) **new-behavior gap resolved** — because this task first makes gaia pickable, a
double-click could feed `handleGoTo → goto.goTo('gaia:…')` (`StarApp.tsx:305-309`) an
unresolvable id. **Resolved:** a gaia double-click is selection-only, never `onActivate`
(D4 + Failure modes). No other findings; gate is deterministic + WebGL-free on the blocking
checks (2–4), e2e is reference-only.

## Goal

Make an individual Gaia DR3 star in the streamed octree **pickable**, and turn that pick into
its **real DR3 identity**. Today (measured, research CLAIM 1) a click never yields a `gaia:*`
bodyId — the sole pick site (`StarScene.pickNearestStar`) iterates only the HYG monolith batch
and the exo-host batch; the ~1.1M streamed octree points are unpicked. After this task, a click
on a rendered Gaia star produces a `gaia:<source_id>` bodyId (via the D1 sidecar + D2 provenance
chain) that lands in the selection store.

The full index chain this task wires (TASK-087 Step 0e): picked star's index in a **visible
mounted octree batch** → `prefixRangesFor(chunkId)` says which sub-range is `gaia` and thus the
star's `catalogId = batch.catalogIds[i]` → D1 `resolve(catalogId)` → DR3 `source_id`.

## Step 0 — Facts to re-verify before coding (do NOT re-derive from memory)

Re-confirm each against the live code; verified this session but code moves.

**(a) The sole pick site + its blindness to the octree.** `StarScene.tsx` `pickAt`
(`:212`) branches: universe context → `pickNearestGalaxy` and returns (`:226-237`); else
planets raycast (`:240-248`); else `pickNearestStar(hygBatch, exoBatch, combined, p, dir)`
(`:273`). `pickNearestStar` (`:364-396`) runs `pickStar` over **only** `hygBatch`
(`stars.batch`, `:104`) and `exoBatch` (`combined.extraHostBatch`, `:105`). No octree batch is
ever passed. RECHECK: read `StarScene.tsx:212-273` and `:364-396`.

**(b) `chunkId === MortonKey` for octree mounts.** The streaming policy sets an octree chunk's
`id = node.key` (`packages/streaming/src/policy.ts:295`), emits `view.chunkId = node.key`
(`:316`), and loads via `octreeCombined.loadTile(c.node!.key, …)` (`:380`). So a GalaxyScene
octree mount's `chunkId` (`GalaxyScene.tsx:191`, from the `ready` event's `chunkId`) is exactly
the `MortonKey` that `CombinedOctreeSource.prefixRangesFor(key)` is keyed by, and it is the same
`loadTile` call that populated `prefixRanges[key]` (`octree-combined.ts:385`). **This alignment
is the whole reason no `prefixRangesFor` shape change is needed** — recheck `policy.ts:295,316,380`.

**(c) The mount registry is the pick surface.** `GalaxyScene.tsx` holds
`mounts: Map<string, Mount>` (`:383`); a `Mount` carries `{ chunkId, kind: 'octree'|'procgen',
context, originPc, batch, objects, seen, … }` (`:152-178`). Octree mounts are created in
`makeOctreeMount` (`:180-`) from the `ready` event's batch. Only `kind === 'octree'` mounts are
real Gaia/HYG stars; `procgen` mounts are synthetic dressing and MUST be excluded from pick.
RECHECK: read `GalaxyScene.tsx:152-178, 383-440`.

**(d) `catalogIds` survive the combine (TASK-087 Step 0e).** Every decoded tile carries
`catalogIds: Uint32Array` (`octree-decode.ts:17`); `concatBatches` copies it
(`octree-combined.ts:230`) and `pushDownToCell` copies it (`:171`). `catalogId` is the sidecar
index — never the tile-local or concatenated position. RECHECK: grep `catalogIds` in
`octree-combined.ts`.

**(e) D1 resolver contract.** `loadGaiaSourceIds(manifestUrl, opts?)` →
`{ resolve(catalogId): Promise<bigint | null> }` (`packages/data/src/gaia-sourceids.ts:16-30`,
exported from `packages/data/src/index.ts`). Async (lazy single fetch), bigint end-to-end,
degrades to `null` (never throws). The sample sidecar maps `catalogId 0 →
4000000000000000137n`, `1 → 4000000000000000274n`, `134 → 4000000000000019591n` (TASK-087
NOTES §Step 0b). RECHECK: read `gaia-sourceids.ts` and confirm the `index.ts` export.

**(f) The pick closures are sync + side-effect-free; identity is async.** `pickAt` returns
`BodyId | null` **synchronously** and is exposed verbatim as the e2e query `__cosmos.pickAt`
(`test-hook.ts:99-106,243-245`) with no selection side-effect; the real selection happens at
`onPointerUp` (`StarScene.tsx:333`, `select(pickAt(...))` inline), while `onDoubleClick`
(`:336-340`) does NOT select — it calls `onActivate(id)` (go-to). D1 `resolve` is a `Promise`.
**This sync/async mismatch is the core new design of the task** — see D4. RECHECK:
`test-hook.ts:88-106`, `StarScene.tsx:329-340`.

**(g) The HYG monolith is gated off inside the galaxy.** `MONOLITH_COVERAGE_GATE = 0.9`
(`StarScene.tsx:73`): once the octree covers the cut, the `hyg` monolith batch is not drawn — so
inside the galaxy the visible HYG stars are the **octree** HYG tiles (idPrefix `hyg-v41`, per
research CLAIM 5), not `stars.batch`. This is why an octree pick must NOT try to emit HYG
identity from octree tiles (it would double-path HYG under a different prefix) — see the scope
rule in D3. RECHECK: read `StarScene.tsx:66-73`.

## Context files

- `docs/research/gaia-pick-identity-gap.md` — **in-tree on this branch** (cherry-picked
  2026-08-01). The measured absence of an octree pick (CLAIM 1: full-viewport sweep at
  coverage==1 returned only `hyg:*`/`exo:*`, never `gaia:*`), the structural cause (CLAIMS 2–3),
  the ~1.2 ms/pick cost + brute-force caveat (CLAIM 6), and the worker-fetch measurement
  artifact (Gaia tiles load in the decode worker, invisible to the main-thread resource API).
- `apps/web/src/scene/StarScene.tsx` — the pick site (Step 0a,f,g); where the octree branch is
  added.
- `apps/web/src/scene/GalaxyScene.tsx` — the mount registry (Step 0c); publishes the pick holder.
- `apps/web/src/glue/octree-combined.ts` — `CombinedOctreeSource` / `PrefixRange` /
  `prefixRangesFor` (D2, consumed here).
- `packages/data/src/gaia-sourceids.ts` — the D1 resolver (consumed here).
- `apps/web/src/glue/local-group-feed.ts` + `apps/web/src/glue/system-feed.ts` — the
  **holder precedent** (`localGroupPickHolder`, `systemPickGroup`): a module-scoped
  `{ current }` written by a producer scene on mount, read inside `pickAt`. D2's holder mirrors
  this shape exactly.
- `apps/web/src/glue/test-hook.ts` — `pickProbeHolder`, `pickAt`, `selectedId`,
  `projectToScreen`, `systemBody` (the query-hook precedent for the e2e gate).
- `apps/web/src/hud/Breadcrumb.tsx` — the sole consumer of a selected id
  (`combined.getBody(id)?.name ?? localGroupGalaxyName(id) ?? id`, `:34-37`): an unknown
  `gaia:*` id renders as its raw string. This is why "selection only" is a complete, if plain,
  D4 scope; legible display is Task C.
- `docs/research/star-pick-ray-origin-context-units.md` — TASK-083: the pick ray origin is in
  active-context units and must be scaled to parsecs (`StarScene.tsx:260-273`); the octree
  branch reuses the SAME already-scaled `p`.
- `docs/agent-tasks/TASK-087-*.md` + `docs/agent-tasks/NOTES-2026-08-01-task-087.md` — the
  frozen interface B consumes, the sidecar test vector, and JC-4 (the optional-prop lesson).

## Frozen interface (changing any of these is a separate thaw task — STOP and mark blocked)

- **`packages/core-types` pick/star/batch types** (`StarBatch`, `StarRecord`, `BodyId`, pick
  types): no field additions. This task adds no per-star field.
- **`packages/render-stars/src/pick.ts`**: untouched. `pickStar` stays a pure single-batch
  angular pick. The gaia-range scan (D1 of this task) is a NEW pure function in **app glue**
  (it depends on `PrefixRange`, which lives in app glue — render-stars must not depend on it).
- **`CombinedOctreeSource` / `PrefixRange` / `prefixRangesFor`** (`octree-combined.ts`):
  consumed, not modified. If the pick appears to need a different `prefixRangesFor` shape,
  **STOP** — Step 0b establishes the current shape is already batch-keyed for mounts; a
  perceived need for change means a mount/key mismatch to diagnose, not a signature to widen.
- **The streaming policy `ChunkLifecycleEvent`** (`policy.ts`): unchanged. Do NOT add
  `prefixRanges` to the event — the pick reads them via `octreeCombined.prefixRangesFor(chunkId)`
  at click time (Step 0b coherence), not through the event.
- **`StarScene`'s existing pick result for HYG/exo**: unchanged. The octree branch is strictly
  additive (D3 scope rule) — every input that returned `hyg:*`/`exo:*`/`null` before still does.
- **Pack format on disk**: reader only; the committed 135-star sample + its sidecar are
  sufficient. No rebuild.

## Out of scope

- **Task C — legible Gaia identity UI** (an info-card / labelled panel showing the DR3
  `source_id`, magnitude, colour, coordinates). This task stops at a `gaia:<source_id>` bodyId
  in the selection store (Breadcrumb shows the raw string). Write Task C as its own file.
- **HYG-octree identity.** A pick that lands in a non-`gaia` (`hyg-v41`) sub-range of a mixed
  octree tile is NOT claimed by the octree branch (D3 scope rule); reconciling octree-HYG with
  the monolith `hyg` identity is a separate concern → a finding for `docs/research/`, not this
  diff.
- **Spatial narrowing / octree-node pick acceleration.** The pick iterates the currently-visible
  octree mounts (the on-screen cut), not all ~1.1M points; per-click cost is a
  reference-machine perf concern (CLAUDE.md gate rule 4), never a blocking gate. A spatial
  traversal to prune tiles is a future perf task, not this one.
- **Search (TASK-070), brightness/visibility-gated picking, any exposure/visual change.**
- **Standing rule:** findings during this task go to `docs/research/` (append to
  `gaia-pick-identity-gap.md` once merged, or a new file); scope creep goes to a new task file,
  not into this diff.
- **Log every judgment call** — anything this task didn't decide and you had to — to
  `NOTES.md` beside the diff, visibly, as you go (not reconstructed after).

## Deliverables

### D1 — Pure gaia-range pick function (`apps/web/src/glue/octree-pick.ts`, new)

A pure, WebGL-free, allocation-tolerant (click-time) function that finds the nearest **Gaia**
star across a set of visible octree mounts. Mirrors `pick.ts`'s pure-math design so it is
unit-testable in vitest (which has no WebGL here — see Failure modes).

```ts
import type { StarBatch } from '@cosmos/core-types';
import type { PrefixRange } from './octree-combined';

/** One visible octree tile as pick input: the decoded batch + its per-source provenance
 *  (from CombinedOctreeSource.prefixRangesFor(chunkId)). */
export interface OctreePickTile {
  readonly batch: StarBatch;
  readonly ranges: readonly PrefixRange[];
}

export interface GaiaPickHit {
  /** Pack-global Gaia catalogId of the nearest gaia star (the D1 sidecar index). */
  readonly catalogId: number;
  /** Angle between the ray and the star, radians (for cross-batch nearest comparison). */
  readonly angleRad: number;
  readonly distancePc: number;
}

/**
 * Nearest GAIA star to `rayDirUnit` from `cameraLocalPc` across all `tiles`, within
 * `maxAngleRad`. Only indices inside a range whose `idPrefix === 'gaia'` are considered — a
 * hit in a hyg-v41 sub-range is deliberately ignored (TASK-088 scope: octree pick claims only
 * gaia). Per tile the ray origin is rebased by `batch.originPc` (tile-local parsecs, exactly
 * as StarScene does for hyg). Ties in angle broken by nearer distance. Returns null if no gaia
 * star is within threshold.
 */
export function pickNearestGaia(
  tiles: readonly OctreePickTile[],
  cameraLocalPc: readonly [number, number, number],
  rayDirUnit: readonly [number, number, number],
  maxAngleRad: number,
): GaiaPickHit | null;
```

- Iterate each tile's `ranges`; for each range with `idPrefix === 'gaia'`, scan indices
  `[offset, offset + count)` of `batch` (rebasing by `batch.originPc`), applying the same
  angular test as `pickStar` (`pick.ts:29-45`). Track the global nearest `catalogId =
  batch.catalogIds[i]`.
- Do NOT reimplement the projection/camera math the app owns — this is the same tile-local
  angular test `pick.ts` already uses; keep it identical (small angle wins, tie → nearer).

### D2 — Visible-octree-mount pick holder (`apps/web/src/glue/octree-pick-feed.ts`, new)

Following `local-group-feed.ts` / `system-feed.ts`: a module-scoped holder GalaxyScene writes
so `StarScene.pickAt` can reach the currently-visible octree mounts.

```ts
/** Currently-visible octree tiles for the star pick (TASK-088). Published by GalaxyScene each
 *  time its visible octree mount set changes; read inside StarScene.pickAt. `chunkId` is the
 *  MortonKey (== prefixRangesFor key). Empty / holder null when no galaxy stream is mounted. */
export interface OctreePickMount {
  readonly chunkId: string;
  readonly batch: StarBatch;
}
export const octreePickHolder: { current: readonly OctreePickMount[] | null };
```

- **GalaxyScene populates it**: publish only `kind === 'octree'` mounts that are currently
  **visible** (not hidden/stale — Step 0c: `Mount.seen` / `hide()`). Update the holder when the
  visible octree set changes (mount / evict / per-frame visibility flip), and clear it (`null`)
  on unmount. Prefer an event/change-driven write over allocating a fresh array every frame; a
  ≤ per-visibility-change write is fine (do not allocate inside the hot frame path if the set is
  unchanged — mirror the imperative low-frequency-write discipline of the other feeds).
- **Do NOT put `PrefixRange` in the holder.** GalaxyScene has no `CombinedOctreeSource` — its
  props are `{ streaming, origin, controllerRef, milkyWayRadiusPc }` (interface
  `GalaxyScene.tsx:313-323`; the fn destructures only `streaming, origin, controllerRef` at
  `:346`, `milkyWayRadiusPc` currently unused). Adding the combined source as a prop just to
  read ranges at mount time is more plumbing for no gain (Step 0b coherence).
  StarScene reads ranges via its `octreeCombined` prop (D4) at click time; Step 0b guarantees
  `prefixRangesFor(chunkId)` is coherent with the mounted batch (same `loadTile(key)` call).

### D3 — Wire the octree branch into `StarScene.pickAt`

In the galaxy-context star branch **only** (after the universe early-return at `:226-237` and
the planet raycast — i.e. alongside the `pickNearestStar` call at `:273`):

- Build `OctreePickTile[]` from `octreePickHolder.current` (if non-null) by pairing each
  `{ chunkId, batch }` with `octreeCombined.prefixRangesFor(chunkId)` (the new
  `octreeCombined?: CombinedOctreeSource` prop, D4). Skip if `octreeCombined` is undefined
  (octree pick simply off — e.g. debug apps that don't pass it).
- Call `pickNearestGaia(tiles, p, dir, PICK_MAX_ANGLE_RAD)` with the SAME already-pc-scaled `p`
  and `dir` the HYG pick uses (`:266-273`; do NOT re-scale — TASK-083).
- **Cross-batch nearest, gaia-scoped:** compare the gaia hit's `angleRad` against the
  `pickNearestStar` (hyg/exo) result the same way exo vs hyg compare today (smaller angle wins).
  - If the gaia hit wins → return `` `gaia:${gaiaHit.catalogId}` `` **synchronously** (the
    provisional id; identity is resolved in D4). This is the analogue of hyg returning
    `` `hyg:${catalogId}` `` — a synchronous, catalog-indexed id.
  - Else return the existing hyg/exo/`null` result unchanged.
- **Scope rule (frozen behavior):** the octree branch emits ONLY `gaia:*`. A picked octree index
  in a non-gaia range is never surfaced (it is not in `pickNearestGaia`'s candidate set), so
  this task never produces a `hyg-v41:*` id and never changes an existing hyg/exo/null outcome.

### D4 — Async identity resolution at the real select sites

The provisional `gaia:<catalogId>` from D3 is upgraded to the real DR3 identity at the two
places that actually mutate selection (`pickAt` / `__cosmos.pickAt` stay sync + provisional):

- StarApp/M4aApp create the resolver once and pass it in:
  `const gaiaIds = useMemo(() => loadGaiaSourceIds(GAIA_OCTREE_MANIFEST_URL), [])`, passed to
  StarScene as `gaiaIds?: GaiaSourceIdResolver` (optional prop, D5).
- **`onPointerUp` (`:329-334`) is the sole select site** — it is where the async upgrade
  lives. Today it is `select(pickAt(...))` inline; restructure to `const id = pickAt(...);
  select(id); …`:
  - Select the provisional `id` immediately (responsive; keeps existing behavior for non-gaia).
  - If `id` is a `gaia:` id and `gaiaIds` is present: parse `catalogId = Number(id.slice(5))`,
    then `gaiaIds.resolve(catalogId).then(sid => …)`. On a non-null `sid`, and **only if the
    current selection is still that provisional `id`** (staleness guard — a newer click must
    win), `select(`gaia:${sid}`)`. Interpolate the `bigint` directly into the string — never
    `Number(sid)` (Step 0e; ids > 2^53 corrupt). A `null` `sid` leaves the provisional id
    (degrade to no-identity — the resolver already warned once).
- **`onDoubleClick` (`:336-340`) does NOT select — it calls `onActivate(id)` (go-to).** Before
  this task a gaia star was never pickable, so `onActivate` never received a `gaia:*` id; now a
  double-click could feed `handleGoTo` (`StarApp.tsx:305-309`, which does `select(id) +
  goto.goTo(id)`) an id `goto` cannot resolve (a gaia star is not a flyable host). **Decision
  (scope): a double-click on a gaia star is treated as a plain selection, NOT a go-to.** In
  `onDoubleClick`, if the picked `id` is a `gaia:` id, route it through the SAME select +
  async-upgrade path as `onPointerUp` (select provisional, resolve, upgrade with the staleness
  guard) and do **not** call `onActivate`. Non-gaia ids keep the existing `onActivate` behavior
  byte-for-byte. Factor the "select + async gaia upgrade" into one local helper both handlers
  call, so the logic is not duplicated.

### D5 — Re-type `packs.ts` + wire the props (StarApp, M4aApp)

- `apps/web/src/app/packs.ts:41`: `readonly octreeCombined?: CombinedOctreeSource;` (import the
  type from `../glue/octree-combined`). This is the frozen-in-087, B-owned re-type. Verify all
  producers already assign a `CombinedOctreeSource` (they call `combineOctreeSources`, whose
  return type is `CombinedOctreeSource`) — so no producer change is needed. `ErrorGateApp.tsx:94`
  keeps its explicit `: OctreeSource` local annotation (it reassigns with `injectOctreeFault`,
  TASK-087 JC-4) — leave it; it never feeds the pick.
- Pass `octreeCombined={pack.sources.octreeCombined}` and `gaiaIds={gaiaIds}` to `<StarScene>`
  in **StarApp** (`StarApp.tsx:642`) and **M4aApp** (`M4aApp.tsx:224`) — the two apps that mount
  GalaxyScene + StarScene for the real experience.
- **Both new StarScene props are OPTIONAL** (mirror the existing `streaming?` prop and TASK-087
  JC-4): the other StarScene call sites (StreamingProbe, Soak4, M3, Flythrough4, ErrorGate,
  CtxSwitch) compile unchanged and simply have the octree pick off. Do NOT add the props there
  unless a gate needs them.

## Failure modes to watch (mined from research + git log + TASK-087)

- **Sync-pick / async-identity clobber.** The select handler must guard the async upgrade with a
  staleness check (D4) — without it, a slow `resolve` of an old click overwrites a newer
  selection. Test the guard.
- **BigInt truncation.** `` `gaia:${sid}` `` where `sid: bigint` interpolates losslessly;
  `Number(sid)` for `sid > 2^53` corrupts. Assert the final id as a **string** against the known
  sample `source_id` (Step 0e). (TASK-087 §Failure modes, carried forward.)
- **Wrong index space.** Resolve by `catalogId = batch.catalogIds[i]` (Step 0d) — never the
  tile-local or concatenated position. A test that asserts "some gaia id came out" instead of a
  *known* catalogId→source_id pair would not catch this.
- **`prefixRangesFor` / mount desync.** Reading `prefixRangesFor(chunkId)` at click time relies
  on `chunkId === key` and the mount being the `loadTile(key)` result (Step 0b). If a mount's
  batch and its ranges ever disagree on `count`, that is the real bug — **STOP**, do not paper
  over it by widening `prefixRangesFor`; diagnose the key/mount mismatch.
- **Double-click feeds `goto` a new id class.** This task makes gaia pickable, so a
  double-click can now reach `onActivate → handleGoTo → goto.goTo('gaia:…')` for the first time
  (`StarApp.tsx:305-309`). `goto` cannot resolve a gaia star (not a flyable host) — it would
  no-op or error. D4 routes a gaia double-click to selection-only; verify no `gaia:*` id ever
  reaches `onActivate`/`goto.goTo`.
- **Universe-context leak.** The octree branch must sit AFTER the universe early-return
  (`:226-237`) — the local-group field owns the click in universe context (TASK-086). Running
  the octree pick there would surface a bogus gaia id over a galaxy. Mirror the existing gate.
- **procgen contamination.** Publish/scan ONLY `kind === 'octree'` mounts (Step 0c). A procgen
  mount has synthetic points and no real `catalogIds` — including it would mint fake gaia ids.
- **Hidden/stale mounts.** Only currently-visible mounts are pickable (Step 0c `seen`/`hide()`).
  A click must not select a faded-out or off-cut tile's star. If distinguishing visible from
  merely-tracked is fiddly, log the chosen filter and its rationale in NOTES.
- **HYG-octree double identity.** Inside the galaxy the monolith is gated off (Step 0g), so the
  visible HYG stars are octree `hyg-v41` tiles. The scope rule (D3) makes the octree branch emit
  only `gaia:*`; never let a mixed-tile hit produce a `hyg-v41:*` id (there is no consumer for
  it and it double-paths HYG).
- **Push-down count ≠ manifest (BUG-8).** `pushDownToCell` filters points, so a mounted batch's
  `count` and its ranges' `count` are post-filter (`octree-combined.ts` already emits post-filter
  counts). Scan the batch's actual `count`/ranges, never a manifest `pointCount`.
- **Ray-origin units (TASK-083).** The octree branch reuses `p` (camera local **scaled to pc**,
  `:266-273`), not raw context units. Do not re-scale or pass `.local` directly.
- **Worker-fetch invisibility (BUG-10 / research artifact).** Octree + sidecar fetches happen in
  the decode worker and do NOT appear in the main-thread `performance.getEntriesByType(
  'resource')`. An e2e that waits on the resource API for the Gaia tile will hang/false-negative.
  Gate readiness on `__cosmos.streaming.loadedChunks` / `catalogCoverage`, or on
  `__cosmos.pickAt` first returning a gaia id, not on a resource entry.
- **vitest has no WebGL here.** The mounts are built with `createStarPoints` (WebGL). Keep the
  pick logic in the **pure** `pickNearestGaia` over plain `{ batch, ranges }` data (D1) so the
  contract gate runs without a browser; the WebGL adaptation (reading live mounts) is exercised
  only by the e2e reference spec.
- **Optional-prop compile breakage.** Adding required props to StarScene would break its 6 other
  call sites (TASK-087 JC-4 is the precedent). Keep `octreeCombined?` / `gaiaIds?` optional.

## Acceptance gate (deterministic proxies only)

1. `pnpm verify` exits 0 (lint + typecheck + unit + build).
2. **D1 gaia-range pick (apps/web glue unit test, no WebGL):** construct `OctreePickTile[]` from
   synthetic batches with hand-set `positionsPc` / `catalogIds` / `originPc` and `PrefixRange[]`
   (reuse the mixed-tile fixture style in `octree-combined.test.ts`). Assert `pickNearestGaia`:
   (a) returns the `catalogId` of the nearest **gaia-range** star for a ray aimed at it;
   (b) **ignores a nearer hyg-v41-range star** in the same mixed tile (a hyg star closer to the
   ray than any gaia star → the gaia hit is still the nearest *gaia* star, or null if none in
   threshold — never a hyg catalogId); (c) a single-source (full-width gaia range) tile scans
   the whole batch; (d) a gaia-absent tile (only hyg-v41 ranges) → `null`. Log the chosen ray +
   returned catalogId (CLAUDE.md rule 6).
3. **D4 identity chain (apps/web unit/integration test):** given a `catalogId` from a
   `pickNearestGaia` hit, `loadGaiaSourceIds(manifestUrl, { fetchImpl })` with a **synthetic**
   served `BigInt64Array` (precedent: `packages/data/test/gaia-sourceids.test.ts`) resolves to
   the known `source_id`; assert the built id string equals `` `gaia:4000000000000000137` ``
   (catalogId 0, Step 0e) — compared as a **string**. Assert the staleness guard: a resolve that
   completes after the selection changed does NOT overwrite the newer selection.
4. **D3 regression (apps/web glue/unit):** a pick input where the octree gaia hit is *farther*
   than the hyg/exo hit returns the existing hyg/exo id unchanged; an empty/absent
   `octreePickHolder` leaves `pickNearestStar`'s result byte-identical. (The octree branch is
   additive.)
5. **E2E reference — "gaia becomes pickable" (flips research CLAIM 1):** near Sol in galaxy
   context, after `__cosmos.streaming.loadedChunks > 0` (the Gaia sample tile mounted), a sweep
   of `__cosmos.pickAt` over the viewport now yields **at least one `gaia:*` id** (research
   measured **zero** before this task; recheck snippet in `gaia-pick-identity-gap.md` CLAIM 1).
   Because tile-mount timing is machine-dependent, this spec is **gated behind an explicit
   readiness wait and, if it proves CI-flaky, stays reference-only** (`!process.env.CI`, per the
   local-e2e-vs-CI convention) — the blocking contract is gates 2–4, which are deterministic and
   WebGL-free. If staging a *specific known* gaia star is feasible via `__cosmos.projectToScreen`
   on a mounted gaia star's position, prefer that (assert the exact `gaia:<source_id>`) over a
   presence-only sweep; if it requires a new test hook, add one in the `systemBody` pattern and
   log it as a judgment call.
6. No screenshot, wall-clock, or "looks right" checks anywhere in the gate. Per-click pick cost
   is reference-machine only (research CLAIM 6), never blocking.

## Verification beyond the gate

- **Additivity:** grep-confirm no existing `hyg:*` / `exo:*` pick path was altered; the only new
  bodyId shape a click can produce is `gaia:*`. Existing `pick.test.ts` unchanged and green.
- **No frozen-surface drift:** confirm `pick.ts`, `StarBatch`, `core-types` pick types, the
  `ChunkLifecycleEvent`, and `prefixRangesFor`'s signature are untouched (diff review). A change
  to any of them is the STOP condition, not a silent widening.
- **Real-run smoke (BUG-6 class):** the D1/D4 fetch mocks cannot catch the `fetch` "Illegal
  invocation" receiver bug — the resolver already guards it (`gaia-sourceids.ts:47`), but confirm
  in a real browser run near Sol that clicking a Gaia star produces a `gaia:<19-digit>` id in
  `__cosmos.selectedId` (not a truncated / `NaN` / catalogId-only id).
- **Task C handoff:** confirm the selected `gaia:<source_id>` reaches the Breadcrumb as a raw
  string (expected — legible display is Task C). Note in NOTES if anything downstream chokes on a
  19-digit id string (it should not; the breadcrumb falls through to the raw id).
