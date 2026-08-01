# Task: Gaia sidecar id-resolver + combined-tile idPrefix provenance (carve-out of TASK-069)

**ID:** TASK-087
**Target package:** `packages/data` (D1 sidecar resolver) + `apps/web/src/glue/octree-combined.ts` (D2 provenance)
**Size:** M
**Phase:** Maintenance track — "Gaia realness" thread
**Origin:** Carve-out of TASK-069 after the reframe in
`docs/research/gaia-pick-identity-gap.md`. TASK-069's Deliverable 3 (wire pick → identity)
is **removed from this task** — it becomes **Task B** (octree-stream pick), because the
research measured that the octree stream has **no pick path at all** (a click never yields a
`gaia:*` id). This task builds the two *data/provenance* pieces (069's D1 + D2) that Task B
will consume.

**Provenance:** spec-task 2026-07-31; spec-review same day applied four fixes in place:
(1) D1 `resolve` made **async** — a sync signature can't lazy-fetch (internal contradiction);
(2) D1 unit test switched to a **synthetic served buffer** — depending on `apps/web/public`
from a `packages/data` test is cross-package coupling; (3) D2 exposure changed from "a method
on the returned object" to an explicit `CombinedOctreeSource` subtype **that also wraps the
single-source early return** (`octree-combined.ts:211` returns a bare source with no method);
(4) `WeakMap` side-channel rejected — zero precedent in the repo. Open coupling flagged in the
verdict: D2's `prefixRangesFor` shape is a reasonable but B-agnostic guess; if Task B's pick
wants batch-keyed access instead, that is a cheap change made in B.

## Goal

Build, ahead of the octree pick (Task B), the two pieces that let a future pick turn a
picked Gaia star into its real DR3 identity:

- **D1 — sidecar resolver:** a lazy loader that maps a pack-global Gaia `catalogId` → the
  real 64-bit DR3 `source_id` (from `gaia-sourceids.bin`), kept as `bigint` end-to-end.
- **D2 — combined-tile provenance:** fix the `idPrefix` collapse in `concatBatches` so a
  Gaia star sharing a merged tile with HYG is still attributable to `gaia` (today it is
  mislabeled `hyg-v41`).

**Neither piece has a live consumer today** (measured: `gaia-pick-identity-gap.md` — nothing
in runtime reads the octree-stream batch `idPrefix`, and the sidecar is never referenced).
They are built *for Task B*. **The regression tests ARE the contract**: they pin exactly the
shape Task B must consume. This is deliberate — do not wire either piece into any pick / UI /
render path in this task (there is nothing to wire into; see Out of scope).

## Step 0 — Facts to re-verify before coding (do NOT re-derive from memory)

Re-confirm each against the live code / files; they were verified 2026-07-31 but code moves.

**(a) Sidecar binary format** — authority is the writer, `tools/pack-octree/src/gaia-ingest.ts`:
- `writeSourceIdSidecar` writes a flat `BigInt64Array` — **signed i64, little-endian, no
  header** — indexed by the pack-global dense `catalogId` (`arr[s.catalogId] =
  BigInt.asIntN(64, s.sourceId)`, gaia-ingest.ts:244-248).
- All DR3 source_ids are positive `< 2^63`, so decoding as `BigInt64Array` or
  `BigUint64Array` yields identical values. Document the signedness either way.
- RECHECK: read `writeSourceIdSidecar` in `tools/pack-octree/src/gaia-ingest.ts`.

**(b) Sample sidecar + test vector** — `apps/web/public/packs/octree-gaia-sample/gaia-sourceids.bin`:
- 1080 bytes = 135 stars × 8. **All 135 ids are positive and > 2^53.**
- Concrete vector for the test: `catalogId 0 → 4000000000000000137` (19 digits),
  `catalogId 1 → 4000000000000000274`, `catalogId 134 → 4000000000000019591`.
  (Sample ids are synthetic: `4e18 + 137·(i+1)`. That is fine — deterministic and committed.)
- RECHECK:
  ```
  node -e "const b=require('fs').readFileSync('apps/web/public/packs/octree-gaia-sample/gaia-sourceids.bin');const a=new BigInt64Array(b.buffer,b.byteOffset,b.length/8);console.log(a.length,a[0].toString(),a[134].toString())"
  ```

**(c) URL resolution** — reuse `resolveRelativeUrl(base, relative)` in
`packages/data/src/octree.ts:46`. The sidecar lives next to the manifest: resolve
`'gaia-sourceids.bin'` against the Gaia **manifest URL** (same rule tiles use, octree.ts:128).

**(d) `fetch` receiver gotcha (BUG-6)** — call `fetch` through a **local unbound reference**
(`const f = this._fetchImpl; await f(url, …)`), never `this._fetchImpl(url)`: the real browser
`fetch` throws "Illegal invocation" with a non-global receiver. See the comment at
`octree.ts:130-137`. A unit-test fetch mock does NOT catch this — it is invisible until a real
browser run.

**(e) `catalogIds` survive the combine** — every decoded tile carries a per-star
`catalogIds: Uint32Array` (`packages/data/src/octree-decode.ts:17`); `concatBatches` copies it
(`octree-combined.ts:189`) and `pushDownToCell` copies it (`:143`). So the pick index chain
is: picked star's concatenated-batch local index → `batch.catalogIds[i]` → sidecar
`[catalogId]`. **`catalogId` is the sidecar index — never the tile-local or concatenated
position.**

**(f) The idPrefix bug is ONLY in `concatBatches`** — `octree-combined.ts:201`
(`idPrefix: batches[0]!.idPrefix`) collapses a MULTI-source merged tile to the first source's
prefix. **`pushDownToCell:154` is correct as-is** (it operates on one single-source ancestor,
so `ancestor.idPrefix` is right — do NOT "fix" it). The collapse is acknowledged in
`octree-combined.test.ts:131` ("concat collapses idPrefix; a known BUG-8 follow-up").

## Context files

- `docs/research/gaia-pick-identity-gap.md` — why D3 was removed; the measured absence of an
  octree pick; both pieces' "no live consumer" status (the reason the tests are the contract).
- `tools/pack-octree/src/gaia-ingest.ts` — sidecar writer (format truth, Step 0a).
- `packages/data/src/octree.ts` — `loadOctreePack`, `resolveRelativeUrl`, the `fetch` receiver
  gotcha; the URL-resolution + lazy-fetch pattern D1 reuses.
- `packages/data/src/octree-decode.ts` — where `catalogIds` is decoded.
- `apps/web/src/glue/octree-combined.ts` — `concatBatches` (D2 target, ~161-203) and
  `pushDownToCell` (~103-156, leave its idPrefix alone).
- `apps/web/src/glue/octree-combined.test.ts` — existing combine tests + the
  `countInIdRange` helper (line ~131) that already routes provenance by id-range, not prefix.

## Frozen interface (changing any of these is a separate thaw task — STOP and mark blocked)

- `packages/core-types` pick/star/batch types (`StarBatch`, `StarRecord`, pick types):
  **no field additions.** D1 and D2 must work without a new per-star field.
- `packages/render-stars/src/pick.ts`: untouched.
- `OctreeSource` **base interface** (incl. `loadTile` → `StarBatch`): unchanged. D2 adds a
  NEW subtype `CombinedOctreeSource extends OctreeSource` and returns it from
  `combineOctreeSources` (additive widening — see D2). Do NOT add methods/fields to the base
  `OctreeSource` or to `StarBatch`.
- `packs.ts` `Sources` interface: unchanged in this task. `octreeCombined` stays typed
  `OctreeSource` (widening `combineOctreeSources`' return is backward-compatible). Re-typing it
  to `CombinedOctreeSource` so a consumer can reach `prefixRangesFor` is **Task B's** change
  (it is the consumer) — out of scope here.
- Pack format on disk: reader only; no rebuild (the committed sample is sufficient).

## Out of scope

- **The octree-stream pick itself (Task B)** — the sole consumer of D1 + D2. This task wires
  nothing into a pick, HUD, info card, or render path, because none reads this data yet.
- Search (TASK-070). Any brightness/visibility-gated picking. Any exposure/visual change.
- **Standing rule:** findings during this task go to `docs/research/` (append to
  `gaia-pick-identity-gap.md` or a new file); scope creep goes to a new task file, not into
  this diff.
- **Log every judgment call** — anything this task didn't decide and you had to — to
  `NOTES.md` beside the diff, visibly, as you go (not reconstructed after).

## Deliverables

### D1 — Gaia source_id sidecar resolver (`packages/data`)

A new module exporting a factory that returns a lazy resolver. Pre-resolved interface
(B-agnostic — the sidecar is a pure `catalogId → source_id` map, independent of how B picks):

```ts
export interface GaiaSourceIdResolver {
  /** Real DR3 source_id for a pack-global catalogId, or null if absent / out of range /
   *  sidecar unavailable. ASYNC because the sidecar is lazy-loaded on first call.
   *  bigint end-to-end — never Number(). */
  resolve(catalogId: number): Promise<bigint | null>;
}
/** Returns the resolver synchronously; the FIRST `resolve` triggers a single fetch of
 *  `gaia-sourceids.bin` (resolved against `manifestUrl`) and caches the BigInt64Array. On
 *  fetch/decode failure it warns ONCE and every `resolve` resolves to null (degrade to
 *  no-identity, never throw/reject). */
export function loadGaiaSourceIds(
  manifestUrl: string,
  opts?: { readonly fetchImpl?: typeof fetch },
): GaiaSourceIdResolver;
```

- `resolve` MUST be async (the interface returns `Promise`): a sync signature cannot lazy-fetch.
  Task B's pick consumes identity asynchronously — that is B's concern, not this task's.
- Decode as `BigInt64Array` over the fetched buffer (Step 0a). `resolve(id)` returns
  `arr[id]` when `0 <= id < arr.length`, else `null`.
- Reuse `resolveRelativeUrl` (Step 0c) and the `fetch`-through-local-ref rule (Step 0d).
- **Single in-flight load:** the first `resolve` starts the fetch and stores the *promise*;
  concurrent/subsequent `resolve` calls `await` that same cached promise (never N fetches).
  Precedent for a cached-promise lazy load: none in `packages/data` today (loaders are
  eager `loadX(url)` — `octree.ts:196`); this is the one new shape, kept minimal.

### D2 — combined-tile idPrefix provenance (`apps/web/src/glue/octree-combined.ts`)

Preserve per-source provenance through `concatBatches` **without** touching `StarBatch` or
the base `OctreeSource` interface. Pre-resolved decision:

- In the SAME loop that concatenates (`concatBatches`, ~184-192), emit a per-source range
  list `readonly PrefixRange[]`, `PrefixRange = { offset: number; count: number; idPrefix:
  string }`, in concatenated order (one entry per contributing input batch; `offset` = the
  running `p`, `count` = `b.count` — the post-filter count, since `pushDownToCell` already
  filtered). Derive ranges and copies from ONE loop — do NOT parallel-compute (TASK-069
  failure mode). Export `PrefixRange` from the glue module.
- Expose the ranges via an explicit widened return type — the repo's style is explicit
  interfaces, not side-channels (grep: zero `WeakMap` in the codebase). Declare, in the glue:
  ```ts
  export interface CombinedOctreeSource extends OctreeSource {
    /** Per-source provenance for the last-loaded batch of `key`, in concatenated order.
     *  Empty until that key has been loaded. Task B: for a mixed tile use THIS, not
     *  batch.idPrefix (which stays batches[0] and is not authoritative for mixed tiles). */
    prefixRangesFor(key: MortonKey): readonly PrefixRange[];
  }
  ```
  Back it with a `Map<MortonKey, readonly PrefixRange[]>` populated inside `loadTile`.
  `combineOctreeSources`' declared return type becomes `CombinedOctreeSource` (a subtype of
  `OctreeSource` — additive; existing callers typing it as `OctreeSource`, e.g.
  `packs.ts:41`, are unaffected).
- **The single-source early return MUST be wrapped** (`octree-combined.ts:211` currently
  returns the bare `sources[0]!`, which has no `prefixRangesFor`). Return a
  `CombinedOctreeSource` that delegates to the single source and whose `prefixRangesFor`
  returns one full-width range `[{ offset: 0, count: <tile count>, idPrefix: source.idPrefix
  }]` (or `[]` for a not-yet-loaded key). This keeps the return type uniform so B never gets
  a bare `OctreeSource`.
- Leave the merged `batch.idPrefix` as `batches[0]!.idPrefix` (not authoritative for a mixed
  tile; nothing reads it — `docs/research/gaia-pick-identity-gap.md`). Add a comment saying so.

**Decision rule / STOP:** if exposing provenance turns out to require a field on `StarBatch`
or a change to the base `OctreeSource` interface — STOP and mark blocked (that is the
frozen-surface thaw the reframe deferred to Task B). The `CombinedOctreeSource` subtype above
avoids both; if it cannot, the coupling to Task B is real and D2 waits.

## Failure modes to watch (mined from research + git log + TASK-069)

- **BigInt truncation** — `Number()` on a source_id > 2^53 silently corrupts. Keep `bigint`
  end-to-end; the test asserts an id > 2^53 as a string. (TASK-069 §Failure modes.)
- **Wrong index space** — resolve by `catalogId` (Step 0e), never by tile-local or
  concatenated position. A test that resolves "an id came out" instead of a *known* id/value
  pair would not catch this — assert the exact value from Step 0b.
- **`fetch` Illegal invocation (BUG-6)** — Step 0d. Unit mocks won't catch it; the rule is
  mandatory even though the gate can't see it.
- **Combine reordering / push-down** — `pushDownToCell` filters points, so a pushed batch's
  `count` ≠ the ancestor's `count`; ranges must use the post-filter counts from the concat
  loop, not the source manifests.
- **Missing sidecar** — a pack without `gaia-sourceids.bin` must degrade (warn once, resolve →
  null, no throw). Test by mocking the fetch to 404/reject — do NOT delete or mutate the
  committed sample pack.
- **Empty combine / single source** — `concatBatches` early-returns for 0 and 1 batch
  (`octree-combined.ts:162-176`); `prefixRangesFor` must still return a correct one-entry (or
  empty-for-count-0) range for those paths.

## Acceptance gate (deterministic proxies only)

1. `pnpm verify` exits 0.
2. **D1 decode (packages/data unit test):** serve a **synthetic** `BigInt64Array` via a mock
   `fetchImpl` (precedent: `packages/data/test/constellations.test.ts:40` builds a `new
   Response(...)`; do NOT depend on `apps/web/public` — that couples the data package's tests
   to the web app's asset layout). Include a value **> 2^53** (e.g. `4000000000000000137n`,
   the real sample's `catalogId 0` per Step 0b, reused as a literal). Assert
   `await resolve(0) === 4000000000000000137n` compared as **string**, plus a second index.
   Log the chosen index + measured value (CLAUDE.md rule 6). (Step 0b's real-pack vector is
   documentation that the format matches; the pack itself is exercised by the pack-octree
   writer tests, not here.)
3. **D1 missing-sidecar (unit test):** with a fetch mock that 404s/rejects, every `await
   resolve` returns `null`, exactly one `console.warn`, no throw/reject.
4. **D1 out-of-range (unit test):** `await resolve(-1)` and `await resolve(count)` → `null`.
5. **D2 regression (apps/web glue test):** a combined tile with BOTH catalogs (extend the
   existing `octree-combined.test.ts` mixed-tile fixture) → after `await loadTile(key)`,
   `prefixRangesFor(key)` returns ranges that (a) cover exactly `[0, count)` with no
   gap/overlap, (b) tag each range with the correct source `idPrefix` (`hyg-v41` and `gaia`),
   and (c) a known concatenated index falls in the range whose `idPrefix` matches that star's
   origin. Also assert the **single-source** wrapper returns one full-width range with the
   source's prefix. This test is the contract Task B consumes — make its intent explicit in a
   comment.
6. No screenshot, wall-clock, or "looks right" checks anywhere in the gate.

## Verification beyond the gate

- Confirm (grep) after the change that D1/D2 still have **no** runtime consumer — this task
  must not have wired them anywhere. If a consumer appeared, that is scope creep → Task B.
- Sanity: `prefixRangesFor` on a single-source (HYG-only or debug) combined path returns one
  full-width range with the correct prefix — the combine's pass-through is unchanged.
