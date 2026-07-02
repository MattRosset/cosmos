# Gaia visibility, the real catalog pack, and the density perf wall

Investigation + work log for the "why don't I see Gaia?" thread (a continuation of
TASK-052). Self-contained handoff: root causes, fixes landed, open bugs, how to build the
real pack, and the Cloudflare path. Only the load-bearing findings are kept.

Status: **historical working-tree log (2026-06-25).** Several items below were later
shipped on `main` — see the supersession block. `pnpm verify` green on current `main`.

> **SUPERSESSION (2026-07-01) — read this first:**
> - ✅ **BUG-8 push-down** — **SHIPPED** (`b205215`) + TASK-058 invariant (`4708461`).
>   Canonical write-up: `docs/research/bug-8-combine-drops-source.md`. The "REVERTED" note
>   below is **stale** — it records an intermediate decision during this thread, reversed
>   when the fix was re-landed with tests.
> - ✅ **BUG-10 P0** — **SHIPPED** (`5dedef1`). See `bug-10-streaming-density-wall.md`.
> - ✅ **BUG-4** — **SHIPPED** (`1626985`). See `bug-4-universe-lag.md` §7.
> - ⏳ **Still open (production deploy):** build-time manifest URL for **CDN/R2** so deployed
>   sites serve the full ~4.7M pack (TASK-065). **Local validation with full dense packs
>   already happened** during this thread (see `bug-10-streaming-density-wall.md`,
>   `gaia-visibility-and-realness-problem.md`); CI/commit default stays the 135-star sample.
>   Also open: dense-pack push-down decimation (§6 below); `idPrefix` mixing (BUG-8 follow-up).

> **DECISION (end of original thread, 2026-06-25): ship only the validated, discard the rest.**
> The user chose to keep only what was rigorously validated and revert everything carrying
> unvalidated assumptions (so nothing half-baked ships). This document is the record so the
> work can be revived when a real Gaia pack is actually deployed.
>
> - ✅ **KEPT** — the two `tools/pack-octree` fixes (`build.ts` `collectLeafPoints` +
>   `gaia-ingest.ts` indexed dedup). Golden-hash-verified **byte-identical output**, zero
>   behaviour change to the committed sample, and they let the tool build the real catalog.
> - ❌ **REVERTED (deferred, documented below, NOT shipped)** — the BUG-8 **push-down**
>   (`octree-combined.ts` back to HEAD), its test + vitest setup, the `VITE_GAIA_OCTREE_URL`
>   wiring, and the locally-built packs/snapshots (deleted from disk). Reasons: its real value
>   needs a real pack (not shipped), and it carries unvalidated assumptions — mirror direction
>   never validated live at scale, the `idPrefix`-mixing latent bug, and the BUG-10 perf
>   amplification. The push-down is unit-test-correct but was judged "not worth shipping yet".
>
> **To revive BUG-8:** re-implement the push-down per §2 (the design + the test are recorded),
> validate it live with a real dense pack, and resolve the `idPrefix` + perf items first.

---

## 0. TL;DR

- **Gaia was never rendered inside the galaxy** because `combineOctreeSources` silently
  dropped a source when the two octrees terminated at different depths. **Fixed** (push-down)
  + unit test. → **BUG-8**.
- The thing people remember as "the Milky Way with millions of stars" is the **procedural
  filler**, not Gaia. The real catalog (HYG + Gaia) is meant to *replace the procgen where it
  has data*, deduped — they are complementary, not "one replaces the other".
- The committed `octree-gaia-sample` is **135 stars** (a CI test fixture), not Gaia. The real
  bright subset is **~4.7M**. We can build real packs locally with `tools/pack-octree`.
- The procgen Milky Way **never showed** (empty overview / "Milky Way → black") because
  `catalogCoverage()` saturates to 1 trivially → `procgenBlend = 1 − coverage = 0`. → **BUG-9**,
  ✅ **FIXED** (`77db8ed`): procgen fade is now distance-driven, not coverage-driven (§3).
- The full ~3M pack **overwhelms the streaming/renderer** (cut explodes to hundreds of tiles
  → CPU/GPU saturate → hang on move). → **BUG-10**, open. The render point-budget works
  (≤2M drawn); the *number of loaded tiles* is what is unbounded.
- Two real **build-tool defects** fixed so the tool can build the real catalog at all
  (stack-overflow + 31-min dedup → 2-min).

---

## 1. Mental model (the core confusion, resolved)

Three tiers stack in the galaxy view:

- **Procgen Milky Way** — ~1,000,000 *procedural* points. Filler/impostor, not real stars.
- **Real catalog (streaming octree)** — `HYG ∪ Gaia`, **deduped**:
  - **HYG** (~109k) = the bright, named stars. Authoritative; always kept.
  - **Gaia DR3** (~millions) = the fainter stars HYG lacks. A Gaia source within 2″ AND
    0.5 mag of an HYG star is **dropped from Gaia** ([gaia-ingest.ts:89](../../tools/pack-octree/src/gaia-ingest.ts)),
    so nothing is drawn twice.
- The procgen is **replaced by the real catalog where the catalog covers** (coverage-driven
  fade), and kept where it doesn't. "Gaia replaces the 1M" is true only with the **full**
  Gaia pack (~4.7M > 1M); with a tiny pack the neighbourhood just looks empty.

So "fewer stars than before" ≠ "Gaia missing" — it's the 1M *fake* procgen turned off and a
small *real* catalog turned on.

---

## 2. BUG-8 — Gaia never renders inside the galaxy (FIXED)

**Symptom:** inside the galaxy you see HYG (~120k) but zero Gaia, even after BUG-6 (tile
loads) was fixed.

**Root cause (deterministic):** the shared Morton *frame* does not imply a shared tree
*shape*. `buildOctree` splits by density (`MAX_POINTS_PER_TILE = 32768`): HYG subdivides into
8 level-1 leaves; the 135-star Gaia sample stays a **single root leaf**.
`combineOctreeSources.mergeNode` OR-ed the child masks → the combined root is **interior**
(inherits HYG's children). The SSE descent skips the interior root tile and loads the finer
leaves — but Gaia's points live only in the root tile, which is never in the cut ⇒ Gaia never
loads. Generic defect: the combine drops the points of whichever source terminates (is a leaf)
at a shallower level. **Bidirectional** — with a dense Gaia pack (deeper than HYG) it's HYG's
leaves that get orphaned under Gaia's deeper cut, so HYG would vanish where Gaia is dense.

**Fix:** push-down at load time in `apps/web/src/glue/octree-combined.ts`. When loading a cut
node, each source contributes either its own tile at that key, or the subset of its deepest
LEAF-ancestor's points that fall inside the cut cell, rebased to the cell centre. Octree cells
partition space ⇒ each pushed point lands in exactly one cut cell (no double draw). Decoded
ancestor tiles are cached so a shared ancestor is fetched once across sibling cut cells.

**Test:** `apps/web/src/glue/octree-combined.test.ts` (new). Reproduces the loss (Gaia
orphaned under HYG leaves) AND the mirror (a shallow leaf source pushed two levels into a
deeper cut). Against the original combine the two push-down tests FAIL; with the fix all pass.
Needed a new minimal vitest setup for `apps/web` (`apps/web/vitest.config.ts`, coverage scoped
to `octree-combined.ts`), wired into `pnpm verify`.

**Known follow-up (latent, pre-existing):** `concatBatches` merges HYG + Gaia points into one
`StarBatch` with a single `idPrefix`, so Gaia points sharing a tile with HYG get bodyId
`hyg-v41:<id>` instead of `gaia:<id>` → wrong identity for picking/labels. Rendering
(position/colour/magnitude) is correct. Fixing needs per-point catalog identity on `StarBatch`
(frozen core-types/render). Its own task.

---

## 3. BUG-9 — procgen Milky Way never renders (FIXED — `77db8ed`, 2026-06-25)

**Resolution:** the procgen fade is now **distance-driven** in `GalaxyScene`, independent of
the trivially-saturated `catalogCoverage()` — exactly the fix direction outlined below. Sol
is the galaxy-frame origin, so `distanceFade(18 kpc..45 kpc)` gives procgen OFF near Sol and
full at the ~49 kpc vantage. Verified: the spiral is visible parked at the Milky Way vantage;
CI green (m4a/flythrough4 gates pass — the `flying` branch keeps the near-Sol budget intact).
Note: the screen-relative-coverage idea (below, "OR make coverage reflect screen-fill") was
also tried and **disproven** — coverage still read 1.000 at 49 kpc because the octree is
galaxy-scale-boxed. Full write-up: `docs/research/galaxy-procgen-coverage-regression.md`;
the durable model: `docs/galaxy-rendering-model.md`. Known follow-up: the spiral pops in on
arrival (off during the outbound flight) — deferred, entangled with the flythrough4 §5.4 gate.

**Symptom (original):** the spiral arm is gone everywhere; the "Milky Way" (overview) vantage is black/empty.

**Root cause (measured live):** procgen opacity = `1 − catalogCoverage()`
([GalaxyScene.tsx](../../apps/web/src/scene/GalaxyScene.tsx)). `catalogCoverage()` measures
"fraction of the *chosen cut* that is loaded", **not** "fraction of the galaxy the catalog
fills". The catalog only has tiles near Sol, so the chosen cut is those few tiles, all loaded
→ **coverage ≡ 1** → `procgenBlend = 0` → procgen never drawn. The empty 99% of the galaxy
isn't counted (no cut nodes there).

Timeline that explains "Phase 3 had the arm, now it doesn't": before BUG-6, octree tiles never
loaded → coverage 0 → procgen fully shown. Fixing tile loading flipped coverage 0→1 → procgen
suppressed. Commit `3a646d8` then added a distance guard that tightened it near Sol.

**Fix direction (not done):** make the procgen visibility at the galaxy/Milky-Way vantage
driven by distance/vantage (show the spiral when you're far enough to see the galaxy as a
galaxy), independent of the trivially-saturated coverage; OR make coverage reflect
screen-fill of the galaxy, not loaded-fraction-of-cut. (Restoring the retired
`GAL_PROCGEN_FLOOR` is the quick patch but doesn't fix the wrong signal.) With a real
all-sky-dense Gaia pack the far-vantage coverage would naturally drop below 1 and the arm
would return — but the overview emptiness should not depend on having the full pack.

---

## 4. The Gaia pack reality + how to build the real one

- **Committed `apps/web/public/packs/octree-gaia-sample/`** = **135 stars**, built from the
  test fixture `tools/pack-octree/test/fixtures/gaia-dr3-mini.csv`. A CI stub, not Gaia.
- **Real bright subset** (`phot_g_mean_mag ≤ 12.5`, `parallax > 0`, `parallax_over_error ≥ 5`,
  ADR-006 §1) = **4,683,171 stars**. Too big to commit; built out-of-band.
- **Local packs we built** (gitignored, `apps/web/public/packs/octree-gaia/`):
  - **469k** (mag ≲ 10, all-sky) — 331 tiles, levels 0–9, 23 MB. **Renders smoothly; current
    debug pack.**
  - **~3M** (the full subset, capped by ESA async MAXREC) — 884 tiles, levels 0–11, 119 MB.
    **Hits the perf wall (BUG-10).**

**Build it yourself** (snapshot already on disk under `tools/pack-octree/snapshots/`,
gitignored):
```sh
pnpm --filter @cosmos/pack-octree build:gaia -- \
  --snapshot "$PWD/tools/pack-octree/snapshots/<file>.csv" \
  --hyg      "$PWD/apps/web/public/packs" \
  --out      "$PWD/apps/web/public/packs/octree-gaia"
```
⚠ **Absolute paths** — `pnpm --filter` runs in the package dir, so relative paths double up.

**Re-pull a snapshot** from the ESA Gaia TAP (sync caps ~500k; use async for more):
```sh
# async submit → returns a job URL in the Location header
curl -s -D - "https://gea.esac.esa.int/tap-server/tap/async" \
  --data-urlencode REQUEST=doQuery --data-urlencode LANG=ADQL --data-urlencode FORMAT=csv \
  --data-urlencode PHASE=RUN \
  --data-urlencode "QUERY=SELECT source_id,ra,dec,parallax,phot_g_mean_mag,bp_rp FROM gaiadr3.gaia_source WHERE phot_g_mean_mag<=12.5 AND parallax>0 AND parallax_over_error>=5"
# poll: curl "<job>/phase" → COMPLETED ; then: curl --compressed "<job>/results/result" -o snapshot.csv
```
The async result is **MAXREC-capped at 3M** and is **all-sky** (verified: RA spans 0–360°,
Dec split ~N/S; density concentrates on the galactic plane, as expected). The download is
slow (~0.3–0.9 MB/s server-side throttle), ~10–25 min for the full thing — run it in the
background.

**URL wiring (local + Cloudflare):** `GAIA_OCTREE_MANIFEST_URL`
([App.tsx](../../apps/web/src/App.tsx)) now reads `import.meta.env.VITE_GAIA_OCTREE_URL`,
defaulting to the committed sample. `apps/web/.env.local` (gitignored) points it at the local
real pack. `apps/web/src/vite-env.d.ts` types the var.

---

## 5. Build-tool fixes (`tools/pack-octree`) — so it can build the real catalog

Both are scalability defects that only bite past ~1M stars; both verified output-identical by
the existing golden-hash test (39/39 pass).

1. **Stack overflow in `collectLeafPoints`** ([build.ts](../../tools/pack-octree/src/build.ts)):
   `pts.push(...collectLeafPoints(child))` spreads a whole subtree's indices into call args,
   overflowing V8's arg limit once the root carries ~1M+ points. Rewritten to accumulate into
   an out-array. Without this the 3M build crashed.
2. **O(gaia × hyg) dedup** ([gaia-ingest.ts](../../tools/pack-octree/src/gaia-ingest.ts)):
   `isHygDuplicate` scanned all ~109k HYG per Gaia source → **31 min** on 3M. Added a
   magnitude-sorted HYG index + binary-searched ±0.5-mag window (exact same drops). Build
   **31 min → 1m56s**.

---

## 6. BUG-10 — the dense pack overwhelms streaming (OPEN)

**Symptom:** with the ~3M pack, moving the camera lags uncontrollably until the tab hangs
(machine fan spins up). Static is tolerable; moving thrashes.

**Measured** (`window.__cosmos.streaming` while lagging):
```
{inFlight:6, loadedChunks:462, renderedPoints:1812746, drawCalls:300}
{inFlight:6, loadedChunks:480, renderedPoints:1008192, drawCalls:2}
```
- `renderedPoints` stays **≤2M** and `drawCalls` caps at **300** → the *render* point-budget
  ([budgets.ts:19](../../packages/streaming/src/budgets.ts)) works. It is **not** drawing 3M.
- `loadedChunks` climbs to **480** with `inFlight` pinned at **6** → the cut explodes to
  hundreds of tiles and the policy keeps **loading/decoding (workers)/mounting (main thread)**
  them. Eviction is by GPU bytes (350 MB ≈ 17M points) — far too loose for a dense pack, so
  chunks accumulate. Moving shifts the cut → constant new loads → saturation → hang.

**Two compounding causes:**
1. **Unbounded loaded-tile count** for a dense deep pack (BUG-4 class; `streaming`). The render
   budget caps what's *drawn*, not what's *loaded/resident*. Needs: cap the cut/loaded-chunk
   count, evict by count not just bytes, or a coarser SSE for dense packs.
2. **Push-down amplifies it** (ours): `pushDownIntoCell` scans the full ~14k-point HYG ancestor
   on the **main thread** for *every* loaded deep cell, usually to push ~0 points into a tiny
   cell — pure waste + per-tile allocations under churn. **Optimize**: index the ancestor batch
   by Morton range once (cached) so each cell push is an O(log n + cellPoints) slice instead of
   O(ancestorPoints). Negligible at 469k (small cut); real at 3M.

---

## 7. Did our changes hurt performance? (the explicit ask)

- **Combine merge** (`getNode`/union/`mergeNode`): cached, cheap. No measurable cost.
- **Push-down**: per-loaded-tile cost (scans the leaf ancestor). **Negligible at 469k** (small
  cut, debugged smoothly), but it scales with cut size × ancestor size and **amplifies the 3M
  thrash** (cause #2 above). Fix is the Morton-range index; worth doing alongside BUG-10.
- **Env URL / vite-env / test setup**: zero runtime cost.

Net: at the 469k debug pack our changes do **not** meaningfully affect performance. The push-down
inefficiency only matters under dense packs and is bundled into the BUG-10 work.

---

## 8. Cloudflare deployment requirements

Nothing extra is needed for the **code** (push-down ships in the bundle). To serve a **real
Gaia pack** in production:
1. **Host the pack.** A moderate pack can be committed under `public/packs/...` (CF Pages
   static assets, ≤25 MB/file, ≤20k files — fine for hundreds of small tiles). The **3M pack
   (~119 MB, 884 tiles)** is better on **R2** (no file-count limit).
2. **Set `VITE_GAIA_OCTREE_URL`** in the CF Pages **build** environment (Vite inlines it at
   build time — a rebuild/redeploy is required for changes). `.env.local` is gitignored and
   does **not** deploy, so without this CF falls back to the 135-star sample.
3. **CORS** — only if the pack is on a different origin (R2/CDN): the bucket must send
   `Access-Control-Allow-Origin` for the app origin, and the tiles (relative `binUrl`s) must
   sit next to the manifest.

---

## 9. Changes in the working tree (this thread)

| File | Change |
|------|--------|
| `apps/web/src/glue/octree-combined.ts` | BUG-8 push-down fix |
| `apps/web/src/glue/octree-combined.test.ts` | new — reproduces BUG-8 + mirror, gates the fix |
| `apps/web/vitest.config.ts` | new — minimal vitest for apps/web, coverage scoped to combine |
| `apps/web/package.json` | `test` script |
| `apps/web/src/App.tsx` | `VITE_GAIA_OCTREE_URL` env override |
| `apps/web/src/vite-env.d.ts` | new — types the env var |
| `apps/web/.env.local` | new (gitignored) — local → real pack |
| `tools/pack-octree/src/build.ts` | `collectLeafPoints` stack-overflow fix |
| `tools/pack-octree/src/gaia-ingest.ts` | dedup index (31 min → 2 min) |
| `.gitignore` | ignore local real pack + snapshots |

---

## 10. Open items / next steps

1. **BUG-9** — procgen suppression (empty overview / Milky Way black). Decouple the spiral from
   the trivially-saturated coverage.
2. **BUG-10** — streaming cut/loaded-tile explosion under dense packs. Cap loaded chunks /
   evict by count / coarser SSE; **and** index-optimize the push-down.
3. **Latent** — mixed `idPrefix` in combined tiles → wrong bodyId for the minority catalog.
4. **Cloudflare** — host the chosen pack on R2 + set the build env var + CORS.
5. The build-tool + combine fixes are committable improvements (not frozen packages).
