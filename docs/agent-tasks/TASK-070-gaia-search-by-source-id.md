# Task: Search a Gaia star by DR3 source_id and fly to it

**ID:** TASK-070
**Target package:** `packages/ui` (SearchPalette) + `packages/data` (reverse lookup)
**Size:** L
**Phase:** Maintenance track — "Gaia realness" thread
**Depends on:** TASK-087 (sidecar resolver `loadGaiaSourceIds` + verified `gaia-sourceids.bin`
format) — **merged to `main`**, dependency satisfied. TASK-088 (octree pick) and TASK-089
(identity card) also merged; they establish that a Gaia star is *selectable* and has a legible
card, but is **not a flyable nav body** — see Step 0(z), which reshapes this task's fly-to.

**Provenance:** spec-task 2026-07-05; spec-review 2026-08-03 (post 087/088/089 merge). The review
found the original Deliverable 2 ("reuse the named-star `goTo`") to be **impossible** against the
current code — `goTo(gaia:*)` cannot resolve a target — and re-pointed the fly-to to a raw galaxy
position. Dependency line re-pointed TASK-069→TASK-087 (069 was reframed into 087/088/089).
Open decision left for the executor/user: the async-palette plumbing (see Deliverable 2 note).

## Goal

Pasting a DR3 source_id (or `gaia:<id>`) into the search palette finds that star and
flies the camera to it. This is realness axis 3 from
`docs/research/gaia-visibility-and-realness-problem.md` §5: today the search corpus is
`names.json` (named HYG stars only) and Gaia is absent entirely. After this task, every
one of the ~4.6M real stars is *reachable* — which, combined with TASK-069, closes the
loop "real, findable, verifiable" that justifies shipping a real catalog at all.

## Step 0(z) — Fly-to a Gaia star is a POSITION fly, NOT a body `goTo` (added by 2026-08-03 review)

**Load-bearing correction.** A Gaia star has no `BodyRecord` in `@cosmos/data` — `combined.getBody('gaia:*')`
returns `undefined`, so `goto.goTo(id)` early-returns and does nothing (`glue/goto.ts:206-210`).
This was made explicit by TASK-088 D4: *"a gaia star is not a flyable host — goto.goTo('gaia:…')
would fail to resolve"* (`scene/StarScene.tsx:414-417`), and TASK-089 lists a Gaia go-to as out of
scope. **Therefore the search result must NOT route through `onGoTo(bodyId)` / `goto.goTo`.**

Instead, once the reverse lookup yields the star's absolute galactic position `[x,y,z]` (pc,
Sol-origin), fly there directly with the SAME primitive `goTo` uses internally:
```ts
flyTo(controller, { target: { context: 'galaxy', local: [x, y, z] }, arrivalDistanceM: HOST_ARRIVAL_M });
```
(`glue/goto.ts:220-223` is the exact call for a lone star.) This is "reuse the flight primitive,
not the body-id entry point." The palette therefore needs a position-fly callback distinct from
`onGoTo(BodyId)` — do NOT try to synthesize a fake `gaia:*` BodyRecord to feed the existing path
(that couples pick/search data into `@cosmos/data`, the exact layer violation 087/088/089 avoided).

## Step 0 — Reverse-lookup strategy (DECIDED 2026-07-05: option 2, build-time reverse index)

TASK-069 established the forward mapping (catalogId → source_id). Search needs the
reverse, plus a *position* to fly to. Option 1 (on-demand full-sidecar scan) was ruled
out by inspecting the pack: it contains only `octree.json` + `tiles/` + the sidecar —
**there is no pack-global positions buffer**, and `ingestGaia` assigns catalogId in
snapshot order (spatially agnostic), so a sidecar hit index gives no way to locate the
star's tile/position without an index. Do not revisit unless the pack layout changed.

**The decided path:** extend `tools/pack-octree` gaia-ingest to also emit
`gaia-sourceids-index.bin` — records sorted by source_id for binary search:
`(source_id: i64, tileId: u32, indexInTile: u32)` (16 bytes/record; match the sidecar's
signedness per TASK-069 Step 0(a)). Runtime: fetch lazily on first `gaia:` query,
binary-search the id, fetch that one tile (reuse the existing tile loader), read the
star's position at `indexInTile`. Constraints:

- **Additive only:** new optional file; every existing pack output stays byte-identical
  (the pack-octree determinism gate must stay green). Regenerate the sample pack so it
  ships the new index.
- `tileId`/`indexInTile` must reference the *on-disk* tile layout (pre-combine) — the
  runtime lookup goes through the plain octree source, not the combined view. **NOTE (2026-08-03
  review):** the app exposes only `octreeCombined` and the HYG-only `octree` — there is NO plain
  Gaia `OctreeSource` field today (`apps/web/src/app/packs.ts:36-42`). The reverse lookup must
  construct one on first `gaia:` query via `loadOctreePack(GAIA_OCTREE_MANIFEST_URL)` (the same
  loader `packs.ts` already uses) and read the tile position from it — do NOT read positions from
  `octreeCombined` (push-down + concat reorder/filter it, so `indexInTile` won't align).
- If this turns out to require changing an *existing* pack file format: STOP, mark
  blocked, write up what you found. Do not redesign the pack.

## Frozen Interface

- SearchPalette's existing UX/behavior **for named stars** is unchanged (the `adapter.search`
  → `onGoTo(BodyId)` path is byte-identical). Adding a NEW async gaia branch + a NEW
  position-fly prop is IN scope (Deliverable 2, option (a)).
- No changes to existing pack files' formats (option 2 adds a new file only).
- Existing search corpus (`names.json`) untouched.
- `@cosmos/data` (`CombinedSource.getBody`/`search`) is NOT extended with Gaia — no synthetic
  `gaia:*` BodyRecord. The reverse lookup is its own module; the fly is a raw position (Step 0(z)).

## Deliverables

1. Reverse lookup in `packages/data` per Step 0 (option 2), lazy (zero cost until a
   `gaia:` query); pack-tool side: the new sorted index file + its determinism-covered
   writer + regenerated sample pack.
2. SearchPalette: input matching `/^(gaia:)?\d{5,19}$/` triggers Gaia lookup; hit shows
   one result row (`Gaia DR3 <id>`); selecting it **flies the camera to the star's position**
   via a raw galaxy-position fly (Step 0(z)) — NOT `onGoTo(bodyId)`. Miss shows the normal
   empty state.
   **Plumbing note (executor/user decision — the review left this open):** the current palette
   is fully synchronous — it renders `adapter.search()` (`BodyRecord[]`) and selects with
   `onGoTo(star.id)` (`packages/ui/src/SearchPalette.tsx:54,101,151`). A Gaia hit is neither a
   `BodyRecord` nor synchronous. Pick ONE and log it in NOTES:
   (a) Add a dedicated async gaia branch *inside* the palette: when the query matches the id
       regex, run the reverse lookup (returns `{ sourceId, positionPc } | null`) off the debounce,
       render a single synthetic row, and on select call a NEW `onGoToPosition(positionPc)` prop
       (wired in `StarApp`/`Hud` to the `flyTo` of Step 0(z)). Named-star behavior via
       `adapter.search`/`onGoTo` is untouched (satisfies the Frozen Interface).
   (b) Keep the palette dumb: have the host resolve the id→position and inject it. More host
       coupling; only choose if (a)'s new prop is judged worse.
   Preferred: (a). Whichever ships, the Frozen Interface below is amended: adding a NEW
   position-fly prop + a gaia branch is IN scope; the existing named-star path stays byte-identical.
3. Loading state while the sidecar/index fetches (multi-MB on first query) — the
   palette must not freeze the frame loop; decode off the hot path.

## Out of scope

- Fuzzy matching, coordinate search, name resolution (SIMBAD etc.).
- Making the found star *visible* (exposure/highlight design — future task; the camera
  arriving at its position is enough here).
- Any ranking/index for HYG.

## Failure modes to watch

- **Flying via `onGoTo(bodyId)` (the trap this task WILL fall into if not careful).**
  `goto.goTo('gaia:*')` resolves nothing (`glue/goto.ts:206-210`; TASK-088 D4). Any select
  handler that calls `onGoTo(gaiaId)` will silently do nothing — a green-looking no-op. Fly to
  the resolved POSITION (Step 0(z)), and the e2e must assert the camera actually moved.
- **BigInt again:** ids > 2^53 must survive input-parse → compare → display as
  bigint/string. Test with a real 19-digit id. Precedent to follow: `glue/gaia-identity.ts`
  keeps the id as `bigint` end-to-end and never does `Number(sid)` — mirror that.
- **Main-thread stall / payload size:** the full index for the real pack is ~74 MB
  (4.6M × 16 B) — do NOT eagerly fetch it whole on keystroke. Preferred implementation:
  binary-search via HTTP **Range requests** (fixed 16-byte records make this trivial;
  ~23 range reads per query), with a one-time full fetch + worker-side decode as the
  fallback if range support proves unreliable in dev/CI — record which path shipped in
  the PR. Either way, nothing multi-MB is decoded on the main thread mid-frame; the
  acceptance test asserts the palette stays responsive via the existing
  frame-budget/work proxies, not wall-clock.
- **Sample-pack blindness:** CI only has the 135-star sample. Make the unit tests run
  the *real* lookup path against the sample sidecar (known id → known position), so the
  logic is gated even though scale isn't. Scale numbers go in the PR as reference info.

## Acceptance Tests

1. `pnpm verify` exits 0; pack-octree determinism gates green (critical — option 2
   touches the pack tool).
2. Unit: known sample-pack source_id resolves to the correct position; unknown id
   resolves to a miss; `gaia:`-prefixed and bare forms both parse; >2^53 id exact.
3. e2e: type a sample-pack source_id into the palette (role locators), select the
   result, assert via `__cosmos` camera query that the camera target moved to that
   star's position (tolerance in world units) — no pixels, no screenshots. This is also
   the guard against the "flew via `onGoTo(bodyId)` = silent no-op" trap: the assertion
   MUST verify the camera actually moved, not merely that select fired.
4. e2e: garbage numeric input (e.g. `999...9`) shows empty state, no console errors.

## Context Files

- `docs/research/gaia-pick-identity-gap.md` (the reframe that superseded TASK-069) +
  `docs/research/gaia-visibility-and-realness-problem.md` §5
- TASK-087/088/089 specs + their merged PRs (#39/#40/#41) — the sidecar resolver, octree pick,
  and card this task builds on; `packages/data/src/gaia-sourceids.ts` (forward resolver, done)
- `apps/web/src/glue/goto.ts:206-223` (why `goTo(gaia:*)` no-ops; the `flyTo` primitive to reuse)
- `tools/pack-octree/src/gaia-ingest.ts` (ordering + `writeSourceIdSidecar` — decides Step 0)
- `packages/ui/src/SearchPalette.tsx` + `names.json` flow (result row; NOTE it is fully sync — see
  Deliverable 2 plumbing note)
- `docs/decisions/ADR-003-octree-tiling.md` + `ADR-006` (tile format, Gaia octree, if option 2)
