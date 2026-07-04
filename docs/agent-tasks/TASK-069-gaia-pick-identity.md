# Task: Wire Gaia pick identity — clicked star shows its real DR3 source_id

**ID:** TASK-069
**Target package:** `packages/data` (sidecar loader) + `apps/web` (wiring) — combine fix in `packages/data`
**Size:** M
**Phase:** Maintenance track (post-4a) — "Gaia realness" thread
**Depends on:** TASK-065 (env-configurable manifest; merged or in flight)

## Goal

Clicking a Gaia star surfaces its real DR3 identity (`gaia:<source_id>`, the actual
64-bit ESA id) instead of `gaia:<denseIndex>`. This is axis 2 of the three unwired
"realness" axes measured in `docs/research/gaia-visibility-and-realness-problem.md` §5:
the `gaia-sourceids.bin` sidecar (designed in ADR-006 §2, "loaded lazily") is currently
**never referenced in runtime code**. This task also fixes the latent mis-id bug where a
Gaia star sharing a combined tile with HYG gets bodyId `hyg-v41:<id>`.

Search-by-source_id is TASK-070 (separate). Making faint stars *pickable-when-invisible*
(brightness-gated pick) is explicitly NOT this task — see Out of scope.

## Step 0 — Verify the sidecar format before writing any code

The only writer is `tools/pack-octree/src/gaia-ingest.ts`. Read it and ADR-006 §2 and
record in the PR description: (a) the binary layout (element size/endianness), (b) what
index maps into it (global dense index vs per-tile), (c) whether the committed 135-star
sample pack includes the sidecar. **If the sample pack lacks the sidecar, regenerate it
with the existing tool so CI can exercise the loader — do not special-case its absence
into silence** (a missing-sidecar pack should degrade to the current denseIndex behavior
with a single console warning, and the test must cover both).

## Frozen Interface

- No changes to `packages/core-types` pick/star types unless a field addition is truly
  required — if it is, STOP and mark blocked (that's a thaw decision).
- The pick algorithm in `packages/render-stars/src/pick.ts` is untouched (geometric
  nearest-ray stays; only the *identity* of the result changes).
- Pack format on disk unchanged (reader only).

## Deliverables

1. **Sidecar loader in `packages/data`**: lazy-load `gaia-sourceids.bin` (relative to
   the manifest URL, same resolution rule as tiles) on first Gaia pick, cache it, decode
   as BigUint64 (verify per Step 0). Failure to fetch ⇒ warn once, fall back to
   denseIndex ids.
2. **Fix the combined-tile idPrefix bug** in the octree combine path
   (`octree-combined.ts` `concatBatches` per the audit): stars must carry their source
   catalog's prefix (`gaia:` vs `hyg-v41:`) after combining. Write the regression test
   this bug never had: a combined tile with both catalogs yields correctly-prefixed ids
   for each member.
3. **Wire pick → id**: where the picked star's bodyId is built, a Gaia star resolves
   `denseIndex → source_id` through the loader; UI (info card / HUD label) shows
   `Gaia DR3 <source_id>`.

## Out of scope

- Search (TASK-070). Brightness/visibility-gated picking (needs a design decision —
  future task). Any exposure/visual change. Any pack rebuild beyond the 135-star sample
  regeneration if Step 0 requires it.

## Failure modes to watch

- **BigInt truncation:** source_ids exceed 2^53; `Number()` on them silently corrupts.
  Keep them `bigint`/string end-to-end; a test must use an id > 2^53.
- **Wrong index space:** if the sidecar is indexed by pack-global dense index but the
  pick returns a tile-local index (or vice versa), every id is wrong but *plausible*.
  The acceptance test must check a *known* star's id against the pack's source data,
  not just "an id came out."
- **Combine reordering:** if `concatBatches` reorders stars, the dense-index mapping
  breaks for combined tiles — verify order preservation or map through it explicitly.

## Acceptance Tests

1. `pnpm verify` exits 0.
2. New unit test (data package): decode sample-pack sidecar; a known star at a known
   index yields its exact 19-digit source_id (compare as string; include one > 2^53).
3. Regression test for Deliverable 2 (mixed-catalog combined tile, both prefixes correct).
4. `pnpm test:e2e` green; if an e2e pick spec exists, extend it: pick a Gaia sample star
   via `__cosmos.pickAt`, assert the label matches `/^Gaia DR3 \d{5,19}$/` — no pixel
   assumptions (testing doctrine rules 1–3).
5. Missing-sidecar path: unit test that a pack without the file degrades to denseIndex
   ids with one warning, no throw.

## Context Files

- `docs/research/gaia-visibility-and-realness-problem.md` §5 (the audit driving this)
- `docs/decisions/ADR-006-gaia-subset-tier-unification.md` §2 (sidecar design intent)
- `tools/pack-octree/src/gaia-ingest.ts` (sidecar writer — the format truth)
- `packages/data/src` octree loader (URL resolution pattern to reuse)
- `packages/data/src/octree-combined.ts` (`concatBatches` — the mis-id bug)
- `packages/render-stars/src/pick.ts` (read-only; where identity meets geometry)
