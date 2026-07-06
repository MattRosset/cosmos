# Task: Search a Gaia star by DR3 source_id and fly to it

**ID:** TASK-070
**Target package:** `packages/ui` (SearchPalette) + `packages/data` (reverse lookup)
**Size:** L
**Phase:** Maintenance track — "Gaia realness" thread
**Depends on:** TASK-069 (sidecar loader + verified format) — hard dependency; blocked without it.

## Goal

Pasting a DR3 source_id (or `gaia:<id>`) into the search palette finds that star and
flies the camera to it. This is realness axis 3 from
`docs/research/gaia-visibility-and-realness-problem.md` §5: today the search corpus is
`names.json` (named HYG stars only) and Gaia is absent entirely. After this task, every
one of the ~4.6M real stars is *reachable* — which, combined with TASK-069, closes the
loop "real, findable, verifiable" that justifies shipping a real catalog at all.

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
  runtime lookup goes through the plain octree source, not the combined view.
- If this turns out to require changing an *existing* pack file format: STOP, mark
  blocked, write up what you found. Do not redesign the pack.

## Frozen Interface

- SearchPalette's existing UX/behavior for named stars is unchanged.
- No changes to existing pack files' formats (option 2 adds a new file only).
- Existing search corpus (`names.json`) untouched.

## Deliverables

1. Reverse lookup in `packages/data` per Step 0 (option 2), lazy (zero cost until a
   `gaia:` query); pack-tool side: the new sorted index file + its determinism-covered
   writer + regenerated sample pack.
2. SearchPalette: input matching `/^(gaia:)?\d{5,19}$/` triggers Gaia lookup; hit shows
   one result row (`Gaia DR3 <id>`); selecting it issues the same fly-to/goTo used by
   named-star results (reuse, don't reimplement). Miss shows the normal empty state.
3. Loading state while the sidecar/index fetches (multi-MB on first query) — the
   palette must not freeze the frame loop; decode off the hot path.

## Out of scope

- Fuzzy matching, coordinate search, name resolution (SIMBAD etc.).
- Making the found star *visible* (exposure/highlight design — future task; the camera
  arriving at its position is enough here).
- Any ranking/index for HYG.

## Failure modes to watch

- **BigInt again:** ids > 2^53 must survive input-parse → compare → display as
  bigint/string. Test with a real 19-digit id.
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
   star's position (tolerance in world units) — no pixels, no screenshots.
4. e2e: garbage numeric input (e.g. `999...9`) shows empty state, no console errors.

## Context Files

- TASK-069's PR + `docs/research/gaia-visibility-and-realness-problem.md` §5
- `tools/pack-octree/src/gaia-ingest.ts` (ordering — decides Step 0)
- `packages/ui/src/SearchPalette.tsx` + `names.json` flow (result row + fly-to reuse)
- `docs/decisions/ADR-003-octree-tiling.md` (tile format, if option 2)
