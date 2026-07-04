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

## Step 0 — Decide the reverse-lookup strategy (bounded decision, rules below)

TASK-069 established the forward mapping (index → source_id). Search needs the reverse.
Options, in preference order — take the **first** whose precondition holds; record the
choice + measured numbers in the PR:

1. **Full-sidecar scan on demand.** If the sidecar is one global file: on first `gaia:`
   query, ensure it's loaded (TASK-069's loader), linear-scan for the id (~4.6M
   BigUint64 compares — measure; expected well under 200 ms), map hit index → star
   position. Precondition: dense index → position is derivable without fetching every
   tile (check how gaia-ingest orders stars vs. tile membership).
2. **Build-time reverse index.** If (1)'s precondition fails: extend `tools/pack-octree`
   gaia-ingest to also emit `gaia-sourceids-index.bin` — pairs sorted by source_id:
   `(source_id: u64, tileId: u32, indexInTile: u32)` — fetched lazily, binary-searched.
   This touches the pack tool: keep it additive (new optional file, existing outputs
   byte-identical — the determinism gate must stay green), and regenerate the sample pack.
3. If neither is implementable without changing existing pack file formats: STOP, mark
   blocked, write up what you found. Do not redesign the pack.

## Frozen Interface

- SearchPalette's existing UX/behavior for named stars is unchanged.
- No changes to existing pack files' formats (option 2 adds a new file only).
- Existing search corpus (`names.json`) untouched.

## Deliverables

1. Reverse lookup in `packages/data` per Step 0, lazy (zero cost until a `gaia:` query).
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
- **Main-thread stall:** a 37 MB fetch+decode on keystroke will jank the render loop.
  Decode in a worker or chunked; the acceptance test asserts the palette stays
  responsive (assert via the existing frame-budget/work proxies, not wall-clock).
- **Sample-pack blindness:** CI only has the 135-star sample. Make the unit tests run
  the *real* lookup path against the sample sidecar (known id → known position), so the
  logic is gated even though scale isn't. Scale numbers go in the PR as reference info.

## Acceptance Tests

1. `pnpm verify` exits 0; pack-octree determinism gates green (critical if option 2).
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
