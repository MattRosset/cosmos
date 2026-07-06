# Task: Wire Gaia pick identity — clicked star shows its real DR3 source_id

**ID:** TASK-069
**Target package:** `packages/data` (sidecar loader) + `apps/web` (wiring) — combine fix in
`apps/web/src/glue/octree-combined.ts` (the combine path is app glue, NOT `packages/data`;
verified 2026-07-05)
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

## Step 0 — Sidecar format (RESOLVED 2026-07-05 by reading the writer; re-confirm, don't re-derive)

Verified against `tools/pack-octree/src/gaia-ingest.ts` (`ingestGaia`, `writeSourceIdSidecar`):

- **(a) Layout:** flat `BigInt64Array` — **signed** i64, platform/little-endian, no header.
  All Gaia DR3 source_ids are positive < 2^63, so decoding with `BigUint64Array` yields
  identical values; either is fine, but document the signedness (writer uses
  `BigInt.asIntN(64, sourceId)`).
- **(b) Index space:** pack-global dense `catalogId`, assigned 0-based in snapshot order
  after cuts (`ingestGaia`). Crucially, **every tile already carries a per-star
  `catalogIds: Uint32Array` buffer** (see `packages/data/src/octree-decode.ts`), and it
  survives the combine (`concatBatches` copies it). So the pick mapping is:
  picked star's tile-local index → `batch.catalogIds[i]` → sidecar `[catalogId]`.
  No index-space ambiguity remains.
- **(c) Sample pack:** `apps/web/public/packs/octree-gaia-sample/gaia-sourceids.bin`
  exists and is 1080 bytes = 135 stars × 8 — CI can exercise the loader as-is.

Sanity-check these three facts still hold before coding (one Read of the writer + one
`ls` of the sample pack). The missing-sidecar path is still required behavior: a pack
without the file degrades to the current denseIndex ids with a single console warning,
and a test must cover it (delete/mock the fetch, don't mutate the committed pack).

## Frozen Interface

- No changes to `packages/core-types` pick/star types unless a field addition is truly
  required — if it is, STOP and mark blocked (that's a thaw decision).
- The pick algorithm in `packages/render-stars/src/pick.ts` is untouched (geometric
  nearest-ray stays; only the *identity* of the result changes).
- Pack format on disk unchanged (reader only).

## Deliverables

1. **Sidecar loader in `packages/data`**: lazy-load `gaia-sourceids.bin` (relative to
   the manifest URL, same resolution rule as tiles) on first Gaia pick, cache it, decode
   as BigInt64/BigUint64 per Step 0(a). Failure to fetch ⇒ warn once, fall back to
   denseIndex ids.
2. **Fix the combined-tile idPrefix bug** in
   `apps/web/src/glue/octree-combined.ts` `concatBatches`: today it stamps the whole
   merged batch with `batches[0]!.idPrefix` (line ~201), so every star in a mixed tile
   gets the first source's prefix. The per-star `catalogIds` are copied correctly —
   only the prefix collapses. **Fix shape (decided):** keep a per-source range map
   `(offset, count, idPrefix)` alongside the merged batch in the glue, consulted where
   the bodyId string is built. Do NOT add a per-star prefix field to the shared
   `StarBatch` type — that's a core-types thaw (STOP per Frozen Interface). Write the
   regression test this bug never had: a combined tile with both catalogs yields
   correctly-prefixed ids for each member.
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
- **Wrong index space:** resolved in principle by Step 0(b) (`batch.catalogIds[i]` is
  the sidecar index — never use the tile-local or batch-local position as the index).
  Still, the acceptance test must check a *known* star's id against the pack's source
  data, not just "an id came out."
- **Combine reordering:** `concatBatches` preserves per-source order (straight
  `subarray` copies in source order), but the range-map fix in Deliverable 2 must be
  built from the same offsets used for the copies — derive both from one loop, don't
  parallel-compute.

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
- `apps/web/src/glue/octree-combined.ts` (`concatBatches` ~line 161–201 — the mis-id bug)
- `packages/data/src/octree-decode.ts` (where tiles' `catalogIds` buffer is decoded)
- `packages/render-stars/src/pick.ts` (read-only; where identity meets geometry)
