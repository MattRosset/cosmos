# Task: Per-tile brightness/distance cull at DRAW time for the galaxy octree

**ID:** TASK-094
**Target package:** `apps/web` (`src/glue/tile-brightness-cull.ts` new + `src/scene/GalaxyScene.tsx` wiring + additive diagnostics in `src/scene/Flythrough4Probe.tsx`) plus additive, log-only diagnostics in `e2e/tests/flythrough4.spec.ts` (no other e2e change — see Frozen Interface)
**Size:** M
**Phase:** 4/5 (galaxy render tier)
**Depends on:** TASK-093 (draw-time frustum cull, commit `a020d68`, branch `task/gaia-search-by-source-id` — its cull site and `halfExtentPc` are this task's insertion points)
**Provenance:** spec-review pass 2026-08-05 (spec-review skill, all 8 checks against live code) — six text-level fixes applied in place (Step 0 §3 monotonicity regime correction; MONOLITH_COVERAGE_GATE added to Frozen; mount-rate justification; run-variance rule in §6; header scope; newSegmentAccum touch point). No design or gate changes from review.

## Goal

TASK-093's frustum cull fires (142 tiles culled at peak) but the `flythrough4` §5.4
near-Sol gate still fails: `toSol` peaks **121 scene draws / 494,037 scene points**
(gate ≤ 40 / ≤ 109,971), with 90 frustum-kept tiles at peak (measured, see
`docs/agent-tasks/TASK-093-NOTES.md`). The approach leg keeps most Sol-local tiles
in-frustum — direction-based culling cannot shrink that set further. The orthogonal,
measured-larger lever (`docs/research/near-sol-overdraw-frustum-culling.md` Lever 2):
**~96% of ALL drawn octree points emit effectively zero light at the runtime exposure**
— isotropic, holds at any camera angle. A star's drawn brightness is fully determined
by its `absMag` and its camera distance (the shader's own math, replayed below), so a
tile whose **brightest** star (min absMag) at its **nearest** approach still lands under
a measured visibility floor draws nothing the eye can see.

This task adds a **per-tile brightness/distance cull in the `GalaxyScene` render loop**,
chained after the TASK-093 frustum cull at the same site: skip drawing (hide, do not
unstream, do not unmount) any octree tile whose best-case brightness is under the floor.
Fully reversible by construction — the test re-runs every frame from the live camera
distance and the live exposure, so approach or a slider raise re-includes the tile the
next frame. When done, the `flythrough4` near-Sol gate passes with its frozen
thresholds (40 draws / 109,971 pts), and the surviving field is the genuinely visible
one (the gate's `> 0` clause plus the unit reversibility cases are the anti-blank
guards).

This is **draw-time per-TILE brightness culling only.** No shader change (we replay the
shader math CPU-side, we do not modify it), no selection-time culling, no per-star
discard, no LOD-containment work (Lever 3 — a possible follow-up gated on this task's
measured result), no reverting TASK-070's procgen-cap exclusion (all Out of scope).

## Step 0 — facts to re-verify against live code before writing any diff

Code moves after specs are written. Re-confirm each of these by opening the file
**now**; if any is false, STOP and update this spec (global rule 1) rather than coding
around it. Every line number below was verified on 2026-08-05, post-TASK-093.

1. **The TASK-093 cull site and its exact shape.** `GalaxyScene.tsx` `useFrameContext(…,
   PRIORITY_RENDER)`: per frame it computes `tanY`/`tanX` (lines ~592–593) and
   `orientation = ctrl?.state.orientation ?? null` (~594) and declares the cull counters
   (~595–597). Inside the `streaming.visible` loop, `offScratch` is scaled to parsecs at
   ~621–623, then the octree branch (~628–648):
   `if (m.kind === 'octree') { if (orientation === null) { cullSkipped } else if
   (tileOutsideFrustum(offScratch[0..2], v.halfExtentPc * SQRT3, orientation, tanX, tanY))
   { cullCulled++; m.hide(); continue; } else { cullKept++ } }`, then `m.seen = tick`
   (~649) — AFTER the cull, so a culled tile never reads as on-cut. Stats are written to
   the exported `frustumCullStats` after the loop (~666–668). `SQRT3 = Math.sqrt(3)` is a
   module const (~36); `frustumCullStats` is declared at ~42–46. **The brightness cull
   inserts inside the final `else` (the frustum-KEPT branch), before `m.seen = tick` —
   same `hide(); continue;` without setting `seen`.**

2. **The exact brightness math to replay (the shader is the spec).**
   `packages/render-stars/src/shaders/stars.vert.glsl.ts`:
   `dPc = max(length(viewPos), 0.001)` (line ~50),
   `m = aAbsMag + 5·(log10(dPc) − 1)` (~51),
   `sNat = uBasePointPx·10^(−0.2m)` (~56),
   `sRen = clamp(sNat, uMinPointPx, uMaxPointPx)` (~57),
   `vSizeDim = min(1, (sNat/sRen)²)` (~61).
   `packages/render-stars/src/shaders/stars.frag.glsl.ts` line ~15:
   `brightness = clamp(10^(−0.4m), 0, 1) · uExposure · vSizeDim`.
   The uniform values for octree mounts: `createStarPoints` defaults
   **basePointPx = 8, minPointPx = 3, maxPointPx = 64**
   (`packages/render-stars/src/star-points.ts` ~47), and `makeOctreeMount`
   (`GalaxyScene.tsx` ~202) passes **no overrides** — only exposure, as
   `exposure × GALAXY_FIELD_EXPOSURE_BOOST` (= **6**, `GalaxyScene.tsx` ~100, applied at
   ~205 and ~221). So the effective exposure the cull must use is
   `exposure.current * GALAXY_FIELD_EXPOSURE_BOOST`, NOT the raw slider value and NOT a
   hard-coded 150.

3. **The tile max-brightness upper bound is exact (monotonicity — load-bearing).** With
   `bri(m) = min(1, 10^(−0.4m)) · E · min(1, (sNat/clamp(sNat,3,64))²)` and
   `sNat = 8·10^(−0.2m)`: for every `m ≤ 0` the flux clamp saturates
   (`min(1, 10^(−0.4m)) = 1`) and the size clamp gives `sizeDim = 1` (sNat ≥ 8 > 3 ⇒
   unclamped or max-clamped), so bri = E — CONSTANT, not decreasing, across both
   `sNat ≥ 64` and `3 ≤ sNat < 64` while `m ≤ 0`. For `0 < m ≲ 2.13` (`3 ≤ sNat < 8`):
   bri = `10^(−0.4m)·E`, strictly decreasing. For `m ≳ 2.13` (`sNat < 3` — the
   floor-clamped regime the whole near-Sol field lives in, per research): bri =
   `E·(64/9)·10^(−0.8m)`, strictly decreasing. Net: bri(m) is **non-increasing** in m
   (flat E for m ≤ 0, strictly decreasing after). And `m(A, d) = A + 5·(log10 d − 1)` is
   strictly increasing in both absMag A and distance d. Therefore the tile's maximum
   possible brightness is attained by its **minimum absMag at its minimum distance**
   `d = max(distToCenterPc − radiusPc, 0.001)` — one evaluation of the shader formula is
   a true upper bound over all stars in the tile. Re-derive this from the two shader
   files; if the shader has changed (e.g. a new term in `brightness`), this spec's
   predicate is wrong — STOP.

4. **`absMag` is on the batch the mount already holds.** `StarBatch.absMag:
   Float32Array` (`packages/core-types/src/batches.ts` ~12), wired from the tile buffer
   in `decodeTile` (`packages/data/src/octree-decode.ts` ~15); `Mount.batch`
   (`GalaxyScene.tsx` ~173) is set for every mount. The per-tile `minAbsMag` is computed
   by **one scan of this array at mount time** (see Deliverables §2) — no pack-format
   change, no `core-types` change, no worker change. `OctreeTileManifest`
   (`packages/core-types/src/octree.ts` ~109–124) has **no** per-tile magnitude field
   today; do not add one.

5. **`halfExtentPc` is already on `VisibleChunk`** (`packages/streaming/src/policy.ts`
   ~84, TASK-093) — the same `v.halfExtentPc * SQRT3` radius the frustum cull uses is
   the brightness cull's `radiusPc`. **`packages/streaming` is NOT touched by this task
   at all.**

6. **The gate and the probe.** `e2e/tests/flythrough4.spec.ts` asserts `toSol`
   `peakSceneDrawCalls ≤ 40` and `peakScenePoints ≤ 109971` (~239–246) plus
   `peakScenePoints > 0` (~249–252), from
   `apps/web/src/scene/flythrough4-m3-baseline.json` (`_recorded: true`, values 40 /
   109971 — confirmed today). The probe (`Flythrough4Probe.tsx`) renders manually at
   priority 100 (~427) and reads `gl.info.render` AFTER (~315–320), so PRIORITY_RENDER
   draw-time culls are fully reflected in the metric. Per-segment TASK-093 diagnostics
   `peakFrustumKept`/`peakFrustumCulled` exist in the probe accum (~387–388), the
   `SegmentStats` interface (~91–92) and the spec's log line (~132). TASK-094 adds
   `peakBrightnessCulled` in exactly the same three places (Deliverables §4).

7. **Current measured starting point (TASK-093-NOTES, 2026-08-05):** `toSol`
   `peakSceneDrawCalls = 121`, `peakScenePoints = 494,037`, `peakFrustumKept = 90`,
   `peakFrustumCulled = 142`. The brightness cull must move the first two under 40 /
   109,971. Also from the notes: `toGalaxy` sees `frustumKept = 58` (approach geometry),
   `toEarth` is system context (octree draw path idle).

8. **The HYG monolith is NOT a hidden fallback near Sol arrival.**
   `MONOLITH_COVERAGE_GATE = 0.9` (`StarScene.tsx` ~78, gate ~188–194): in galaxy context
   with `catalogCoverage ≥ 0.9` the monolith is hidden, and near arrival coverage
   saturates ≈ 1 (`GalaxyScene.tsx` comment ~529–532: coarse tiles' boxes fill the
   screen → cov ~1). So once the monolith is gated off, the octree survivors ARE the
   star field — a brightness floor set too high blanks the sky with no fallback. This is
   why the floor is fixed at the research's "absurdly generous" 0.004 (see Frozen), never
   to be raised to make the gate pass.

9. **Unit-test scope.** `apps/web/vitest.config.ts` (~14) includes
   `src/glue/**/*.test.{ts,tsx}` in node env — the new test file lands there like
   `tile-frustum-cull.test.ts` / `procgen-draw-budget.test.ts`. No DOM/THREE imports in
   the new module.

## Context files

- `docs/research/near-sol-overdraw-frustum-culling.md` — the measured evidence: Lever 2
  brightness buckets (942 pts saturated; 4,112 at bri ≥ 0.1; 10,851 at ≥ 0.02; 28,989 at
  ≥ 0.004 of 703,537), distance profile (visible points cluster 10–1000 pc), far-Sol ~0%
  visible, and the kill conditions (reversibility must be proven, not "fewer points").
  Read first.
- `docs/agent-tasks/TASK-093-NOTES.md` — the measured STOP this task unblocks (numbers in
  Step 0 §7) and the seen-ordering judgment call this task must preserve.
- `apps/web/src/scene/GalaxyScene.tsx` — the render loop and cull site (Step 0 §1);
  `makeOctreeMount` (~196–229) where `minAbsMag` is scanned; the exposure refs (~419,
  ~485–492).
- `packages/render-stars/src/shaders/stars.vert.glsl.ts` + `stars.frag.glsl.ts` +
  `star-points.ts` — the math being replayed (Step 0 §2). Do NOT edit them.
- `apps/web/src/glue/tile-frustum-cull.ts` + its `.test.ts` — the module/test shape to
  mirror (pure, DOM/THREE-free, hand-constructed geometry, logged inputs).
- `docs/testing-conventions.md` — the non-negotiable test rules (query real state; CI
  gates deterministic proxies only; triagable-from-logs).
- `docs/research/gaia-far-fly-quality-collapse.md` — the TASK-070 far-Sol black-screen
  trap this cull must not re-create (and, per the research, may eventually help retire).

## Frozen Interface

The agent may NOT change these; a change here is a separate reviewed task.

```ts
// The flythrough4 gate + baseline are FROZEN (TASK-053 forbidden actions): do not edit
// the thresholds (40 / 109,971), the > 0 clause, the §5.8 caps, or the baseline JSON.
// The ONLY permitted edits to e2e/tests/flythrough4.spec.ts and Flythrough4Probe.tsx are
// the ADDITIVE, log-only diagnostics of Deliverables §4 (interface field + accumulator +
// console.log token) — they strengthen triage, they cannot affect pass/fail.

// The visibility floor is FROZEN at the research's "absurdly generous" bucket:
export const TILE_VISIBILITY_FLOOR = 0.004;
// Do NOT raise it to make the gate pass — bri ≥ 0.02 points are research-verified
// visible, and past arrival the monolith is coverage-gated OFF (Step 0 §8), so a higher
// floor blanks the sky with no fallback (a global-rule-3 correctness regression, not a
// perf win). If the gate cannot be met at floor 0.004, that is the STOP case — report,
// do not tune.

// TASK-070's enforceBudgets procgen-cap exclusion (policy.ts ~631–634, the
// kind === 'octree' filter) stays FROZEN — a later task gated on far-Sol real-Gaia
// confirmation (research kill condition).

// Untouched packages/files: packages/streaming (all of it — no selection-time culling),
// packages/render-stars (the shaders + uniforms are replayed, never edited),
// packages/core-types + the pack format (no minAbsMag field — mount-time scan instead),
// apps/web/src/glue/tile-frustum-cull.ts (the TASK-093 predicate — extend AROUND its
// call site, do not modify tileOutsideFrustum), GALAXY_FIELD_EXPOSURE_BOOST (6).

// MONOLITH_COVERAGE_GATE = 0.9 and its gate logic (StarScene.tsx ~78, ~188–194):
// FROZEN. If the sky looks dark past arrival during verification, the answer is NEVER
// to re-enable the monolith "as a fallback" — that double-draws the catalog (the exact
// redundancy ADR-006 §5.2 forbids and M4a exists to remove). A dark arrival view means
// the floor is wrong — STOP and report; do not touch the gate.
```

## Inputs / Outputs

- **Input, per frustum-kept octree tile, per frame:** camera→tile-center distance in
  parsecs `Math.hypot(offScratch[0], offScratch[1], offScratch[2])` (post-scale
  `offScratch`, exactly as the frustum cull already has it), tile bounding-sphere radius
  `v.halfExtentPc * SQRT3`, the mount's static `m.minAbsMag` (scanned once at mount),
  the live effective exposure `exposure.current * GALAXY_FIELD_EXPOSURE_BOOST`, and the
  frozen floor 0.004.
- **Output:** boolean "below floor?" — true ⇒ `m.hide(); continue;` **without** setting
  `m.seen = tick` (identical contract to the frustum cull: the trailing hide pass and the
  octree-pick publish both treat it as off-cut; the tile stays STREAMED + MOUNTED, so
  re-inclusion next frame costs nothing). False ⇒ the existing `cullKept++` →
  `m.seen = tick` → `applyFrame(...)` path, unchanged.

## Deliverables / Steps (mechanical)

**Log every judgment call — anything this task didn't decide and you had to — to
`docs/agent-tasks/TASK-094-NOTES.md` beside the diff, visibly, as you go (not
reconstructed after).**

1. **Create the pure predicate module `apps/web/src/glue/tile-brightness-cull.ts`**
   (DOM/THREE-free — lands in the node-env vitest `src/glue/**` scope). Export
   `TILE_VISIBILITY_FLOOR = 0.004` (with the Frozen rationale comment) and:

   ```ts
   /**
    * True ⇒ even the tile's BRIGHTEST star (minAbsMag) at its NEAREST approach
    * (distToCenterPc − radiusPc) projects under the visibility floor — the whole tile
    * emits no visible light this frame, so drawing it is pure waste. Conservative
    * (never returns true for a tile containing a visible star): the single evaluation
    * is the tile's exact brightness upper bound (monotonicity — see Step 0 §3).
    * NaN inputs ⇒ false (bad data NEVER culls). Allocation-free (scalar math only).
    *
    * Replays the shipped shader math EXACTLY — stars.vert.glsl.ts ~50–61,
    * stars.frag.glsl.ts ~15 — with the octree mount's actual uniforms
    * (base 8 / min 3 / max 64, star-points.ts ~47; makeOctreeMount passes no overrides).
    * If those shader lines or defaults change, this function is wrong — update both.
    *
    * @param distToCenterPc  camera → tile CENTER distance, parsecs.
    * @param radiusPc        tile bounding-sphere radius (= halfExtentPc * sqrt(3)).
    * @param minAbsMag       tile's brightest absolute magnitude (scanned at mount).
    * @param exposureEff     EFFECTIVE exposure = slider * GALAXY_FIELD_EXPOSURE_BOOST.
    * @param floor           brightness floor; default TILE_VISIBILITY_FLOOR.
    */
   export function tileBelowVisibilityFloor(
     distToCenterPc: number,
     radiusPc: number,
     minAbsMag: number,
     exposureEff: number,
     floor?: number,
   ): boolean;
   ```

   Implementation (mirrors the shader lines cited above):
   ```
   const dPc = Math.max(distToCenterPc - radiusPc, 0.001);      // vert ~50 clamp
   const m = minAbsMag + 5 * (Math.log10(dPc) - 1);             // vert ~51
   const sNat = 8 * Math.pow(10, -0.2 * m);                     // vert ~56 (base 8)
   const sRen = Math.min(Math.max(sNat, 3), 64);                // vert ~57 (min 3, max 64)
   const sizeDim = Math.min(1, (sNat / sRen) * (sNat / sRen));  // vert ~61
   const flux = Math.min(1, Math.pow(10, -0.4 * m));            // frag ~15 clamp(…,0,1)
   return flux * exposureEff * sizeDim < (floor ?? TILE_VISIBILITY_FLOOR);
   ```
   The `sizeDim` factor is LOAD-BEARING — 100% of the near-Sol field is floor-clamped
   (research), so dropping it overestimates brightness ~`(3/sNat)²`-fold and guts the
   cull; applying it twice underestimates and culls VISIBLE tiles. The 8/3/64 constants
   are module-scoped `const`s with a citing comment (`star-points.ts` ~47) — NOT
   parameters (the call site cannot supply them; they are the render-stars defaults).

2. **Scan `minAbsMag` once per mount (zero per-frame cost).** Add `readonly minAbsMag:
   number` to the `Mount` interface (`GalaxyScene.tsx` ~168–194). In `makeOctreeMount`
   (~196), scan `batch.absMag` with a plain loop (no allocation, `NaN` entries are
   skipped automatically by `<`; empty array ⇒ `Number.NEGATIVE_INFINITY` so a
   zero-point tile is never culled by this test). In `makeProcgenMount` set
   `minAbsMag: Number.NEGATIVE_INFINITY` — the safe poison value: procgen is never
   brightness-culled (the cull is gated on `m.kind === 'octree'` upstream), but if the
   field is ever misread, "infinitely bright" keeps the tile. Scan cost: during a goTo
   flight new mounts are flush-capped (`OCTREE_FLUSH_PER_FRAME_FLYING` = 8); parked, the
   lifecycle listener mounts ready tiles synchronously, so a decode burst can mount
   several tiles in one frame — each scan is ≤ 32,768 float compares (tens of µs), far
   cheaper than the `createStarPoints` geometry/LUT setup the same mount already pays,
   and it runs ONCE per mount, never per frame. Do NOT move it into the worker or the
   pack (out of scope).

3. **Wire the predicate into the render loop** (`GalaxyScene.tsx` PRIORITY_RENDER,
   inside the existing `m.kind === 'octree'` branch — Step 0 §1). The frustum-KEPT
   `else { cullKept += 1; }` becomes:
   ```
   } else if (
     tileBelowVisibilityFloor(
       Math.hypot(offScratch[0], offScratch[1], offScratch[2]),
       v.halfExtentPc * SQRT3,
       m.minAbsMag,
       exposure.current * GALAXY_FIELD_EXPOSURE_BOOST,
     )
   ) {
     brightnessCulled += 1;
     m.hide();
     continue;                       // no m.seen = tick — same contract as frustum cull
   } else {
     cullKept += 1;
   }
   ```
   Declare `let brightnessCulled = 0;` beside the existing counters (~595–597). Notes:
   the test runs only on frustum-KEPT tiles (a frustum-culled tile is already hidden —
   do not reorder the tests); it runs only when `orientation !== null` (inside the
   existing camera guard — TASK-093's "never cull without a camera" contract covers
   both culls; decided, not to be re-litigated); `exposure.current` is the RAW slider —
   the `× GALAXY_FIELD_EXPOSURE_BOOST` at the call site is what the mounts actually
   apply (Step 0 §2), so slider changes re-include tiles the very next frame (the
   exposure-reversibility half of the research kill condition). No per-frame allocation:
   `Math.hypot` of three scalars, one predicate call, primitive counters.

4. **Additive diagnostics (log-only, mirrors TASK-093 judgment #2 — the ONLY permitted
   spec/probe edits).** (a) Beside `frustumCullStats` (~42–46) export
   `export const brightnessCullStats = { culled: 0 };` and write
   `brightnessCullStats.culled = brightnessCulled;` where the frustum stats are written
   (~666–668). (b) `Flythrough4Probe.tsx`: import it; add `peakBrightnessCulled` to
   `SegmentAccum` + the `newSegmentAccum()` initializer (0) + `SegmentStats` +
   `finalizeSegment`, accumulate
   `a.peakBrightnessCulled = Math.max(a.peakBrightnessCulled, brightnessCullStats.culled);`
   beside the frustum accumulators (~387–388). (c) `flythrough4.spec.ts`: add
   `peakBrightnessCulled: number;` to the local `SegmentStats` interface and append
   `brightnessCulled=${s.peakBrightnessCulled}` to the `logSegments` line. Nothing else
   in those files changes. Derived drawn-tile count for triage =
   `peakFrustumKept − peakBrightnessCulled` — log that subtraction in the NOTES, not in
   code.

5. **Unit test the predicate** (`apps/web/src/glue/tile-brightness-cull.test.ts`,
   node-env scope). Hand-constructed inputs against the frozen floor (default
   parameter) at `exposureEff = 150` unless stated; assert the boolean, and
   `console.log` every case's inputs + result (CLAUDE.md rule 6 — triagable from the CI
   log alone). Do NOT re-derive projection or import shaders (rule 1) — the expected
   booleans below come from the formula evaluated by hand (shown; recompute if the
   shader changed):
   - **near faint star, kept:** dist 10, radius 5, A = 5 → d = 5, m ≈ 3.49,
     bri ≈ 0.04 · 150 · (1.6/3)² ≈ 1.71 → KEPT.
   - **far faint tile, culled** (the research's "6000 pc black patch" case): dist 6000,
     radius 20, A = 5 → d = 5980, m ≈ 18.9, bri ≈ 8e-13 → CULLED.
   - **boundary pair at 500 pc** (proves the floor discriminates): dist 500, radius 10:
     A = −2.5 → m ≈ 5.95, bri ≈ 1.8e-2 → KEPT; A = −1.5 → m ≈ 6.95, bri ≈ 2.9e-3 →
     CULLED.
   - **camera inside the tile, kept** (the anti black-screen-while-standing-in-it case):
     dist 3, radius 10 → d clamps to 0.001, A = 10 → m = −10, saturated (sNat > 64,
     flux 1) → bri = 150 → KEPT.
   - **exposure reversibility** (research kill condition — slider crank re-includes):
     the A = −1.5 / 500 pc tile above is CULLED at 150 and KEPT at
     `exposureEff = 1200` (slider ~200 × 6) — bri ≈ 2.3e-2.
   - **approach reversibility** (the other half): same tile at dist 60, radius 10 →
     d = 50, m ≈ 1.99, sNat ≈ 3.2 (not floor-clamped), bri ≈ 0.159 · 150 ≈ 23.9 → KEPT.
   - **NaN never culls:** `minAbsMag = NaN` → KEPT; `distToCenterPc = NaN` → KEPT.
   - **−∞ never culls:** `minAbsMag = -Infinity` (the empty/procgen poison value) →
     KEPT.

6. **Measure and record (the STOP-or-record step — mandatory, not optional).** Build
   web and run the `flythrough4` gate (`pnpm test:e2e` chromium, or the probe manually
   via `?debug=flythrough4` on the preview build). Log to
   `docs/agent-tasks/TASK-094-NOTES.md`: `toSol` `peakSceneDrawCalls`,
   `peakScenePoints`, `peakFrustumKept`, `peakBrightnessCulled`, the derived drawn-tile
   peak, and per-segment coverage ranges — before/after against Step 0 §7. Peaks carry
   run-to-run variance (the cut depends on async fetch/decode timing), so: a pass must
   reproduce across ≥ 2 local runs before declaring done, and a result within ~10% of
   either threshold (draws 36–44, points ~99k–121k) counts as NOT closed — record and
   report it, never cherry-pick a lucky run. **STOP case
   (global rule 1):** if `peakSceneDrawCalls > 40` or `peakScenePoints > 109971` after
   this task's diff, do NOT raise the floor, do NOT touch thresholds/baseline, do NOT
   add any per-star or margin hack — record the numbers and report: the remaining lever
   is LOD-containment / cut-settling (research Lever 3), a separate task whose Step 0
   your NOTES numbers seed. If the gate passes, record the same numbers (they are the
   before/after evidence and the Lever-3 go/no-go).

## Common Mistakes (architecture §5.8 + this area's history)

- Editing the shader to "make the cull exact" — the predicate REPLAYS
  `stars.vert/frag` CPU-side; any shader edit is a different task and invalidates this
  spec's math (Step 0 §3 re-derivation exists for that event).
- Culling **procgen** — the Milky Way cloud has its own exposure boost and no absMag
  contract; the cull stays inside the `m.kind === 'octree'` branch.
- Setting `m.seen = tick` before/instead of the cull `continue` — a culled tile with
  `seen === tick` survives the trailing hide pass AND gets published to the octree pick
  surface (TASK-093's mistake list, applies verbatim).
- Using the raw slider as `exposureEff` (misses the ×6 boost → culls tiles the user can
  see) or a hard-coded 150 (misses slider moves → same bug). Read
  `exposure.current * GALAXY_FIELD_EXPOSURE_BOOST` per frame.
- Dropping or double-applying `sizeDim` / the 3-px floor clamp (Deliverables §1) —
  either direction is a regression: gutted cull, or culled VISIBLE tiles.
- Allocating in the loop (an array from the distance calc, a per-tile object). All
  inputs are scalars/module consts.
- Selection-time "optimizations" — do not skip fetching/mounting sub-visible tiles
  (research direction 3, deferred): tiles stay streamed; only `object.visible` is
  gated.
- Recomputing `minAbsMag` per frame, or threading it through `VisibleChunk` /
  `core-types` / the pack. It is static per batch; scan once at mount (§2).

## Failure modes (mined from `docs/research/` + `git log -- GalaxyScene.tsx policy.ts flythrough4.spec.ts`)

- **"Hid the field and blanked the sky" — shipped twice, reverted twice**
  (`goto-galaxy-transit-black.md`, `galaxy-starfield-flyin-black-flush-during-flight.md`;
  commits `1073dbf`, `bab8fff`). The brightness form of the trap: past arrival the HYG
  monolith is coverage-gated OFF (Step 0 §8), so an over-aggressive floor blanks the sky
  with no fallback. Guards: floor frozen at 0.004 (research's own "absurdly generous"
  bucket, 5× under the verified-visible 0.02 bucket); the gate's `> 0` clause; the
  inside-tile / NaN / −∞ unit cases; the two reversibility cases (research kill
  condition — proven in the unit test, not asserted by "fewer points").
- **TASK-070 far-Sol black screen** (`gaia-far-fly-quality-collapse.md`; commit
  `405c4ff`). At a far park the brightness cull skips ~the whole Sol-local octree —
  measured ~0% visible there (research §Far-Sol), so this is CORRECT, not a blank-field
  bug: the procgen layer (distance-faded in beyond ~1.5 kpc) owns that view. Do NOT add
  a "always keep ≥ N tiles" floor to be safe — that re-draws verified-invisible tiles
  and re-opens the overdraw this task exists to kill. (Retiring the TASK-070 cap
  exclusion on the strength of this cull is a LATER task, gated on a real far-Gaia
  park — research kill condition — not this one.)
- **The gate can bind on EITHER clause, and the draws clause is the tighter one.** 121
  peak draws = 90 frustum-kept tiles + ~31 non-octree draws (procgen layer, overlays,
  monolith at sub-0.9-coverage frames — the probe cannot split them). Lever 2 culls
  tiles, not LOD duplicates: a bright leaf AND its ready coarse ancestors both contain a
  bright star, so both survive (containment, research Lever 3 ~14%). If post-diff draws
  sit in 41–80 with points comfortably under, that is the Lever-3 STOP case
  (Deliverables §6) — not a cue to raise the floor.
- **Universe context (`streamingActive` includes `universe`).** All inputs are parsecs
  already (`offScratch` post-scale, `halfExtentPc`, absMag math) — the test is
  context-agnostic; do NOT special-case universe, and never mix render-units distance
  with parsec magnitude math (TASK-081's contract; commit `d3e4fa5`).
- **1-frame-stale anything is self-healing.** Distance and exposure are same-frame
  (PRIORITY_RENDER; Step 0 §1); a tile that becomes visible re-draws the very next
  frame because it stayed MOUNTED. No margins, no hysteresis — a brightness hysteresis
  would keep invisible tiles drawn on departure AND is unjustified complexity here.
- **`gl.info` is the gate, not policy stats.** Like TASK-093: hiding sets
  `object.visible = false`, which drops the draw from `gl.info.render` but not from
  `streaming.stats.renderedPoints` (the §5.8 2M cap keeps reading the unculléd policy
  number — intended; do not "fix" the divergence).

## Acceptance Tests (deterministic proxies only — CLAUDE.md §CI gate)

Done only when all pass in CI:

1. **`flythrough4` near-Sol gate restored, thresholds untouched.**
   `e2e/tests/flythrough4.spec.ts` passes: `toSol` `peakSceneDrawCalls ≤ 40` AND
   `peakScenePoints ≤ 109971` (the failing clause), `peakScenePoints > 0` (the
   not-an-empty-field clause), the §5.8 caps (in-flight ≤ 6, points ≤ 2M, draws ≤ 300),
   coverage/procgen fade clauses, and zero page errors.
2. **Predicate unit test** (Deliverables §5) passes in the `pnpm verify` unit scope.
3. **`pnpm verify` green** (lint + typecheck + unit + build).
4. **Error + tripwire gates unchanged.** `getErrorCounts().invariant` unchanged
   (TASK-090) and the ~7 e2e specs asserting `errorCounts.total === 0` still pass — the
   cull toggles `object.visible` only, adds no `assertInvariant`, throws nothing.
5. **NOTES before/after recorded** (Deliverables §6) — the measured `toSol` numbers
   with the new `brightnessCulled` diagnostic, pass or STOP.

Frame time / screenshots are reference-machine only, never a blocking check (CI runs
SwiftShader).

## Verification beyond the gate

- Reproduce the research's parked-at-Sol brightness measurement post-diff via the
  Method notes in `docs/research/near-sol-overdraw-frustum-culling.md` (scripts are not
  committed): the drawn field should now approximate the bri ≥ 0.004 survivor set
  (~29k pts isotropic upper bound at exposure 150), not 704k.
- Spot-check reversibility live (non-blocking): park ~500 pc from Sol facing it, crank
  the exposure slider — previously culled tiles reappear immediately; approach — the
  field grows in with distance, no pop-in latency (tiles were already mounted).
- Far-Sol park (TASK-070's case): facing Sol from ~5.8 kpc, the octree culls ~fully by
  brightness and the procgen layer owns the view — NOT a black screen. Record the luma
  observation in NOTES if taken.

## Out of scope (do NOT do these here)

- **LOD-containment / cut-settling** (research Lever 3, ~14%) — the follow-up gated on
  this task's measured numbers (Deliverables §6 STOP case seeds its Step 0).
- **Selection-time culling** (don't fetch/mount sub-visible or off-screen tiles) —
  research direction 3, deferred; draw-time only.
- **Per-star brightness discard in the shader** — a different design (fragment/vertex
  threshold); not needed for the tile-level gate. If it looks attractive, write it up
  in `docs/research/`, don't ship it here.
- **Pack-format `minAbsMag` precompute** (manifest field + `OCTREE_FORMAT_VERSION`
  bump + pack regeneration, incl. the CDN pack) — a possible later optimization of the
  mount-time scan; a thaw decision, not this diff.
- **Reverting TASK-070's procgen-cap exclusion** — FROZEN (see Frozen Interface);
  gated on a real far-Gaia park (research kill condition).
- **Procgen brightness cull** — the cloud has its own budget/LOD machinery
  (`procgen-draw-budget.ts`); untouched.

**Findings during this task go to `docs/research/` (a new writeup or an addendum to
`near-sol-overdraw-frustum-culling.md`); scope creep goes to a new task file, not into
this diff.**

---

## Spec-writer judgment calls (quarantine — decided above, NOT for the executor)

Recorded for post-merge triage (spec bug / doctrine gap / executor bug). The task
brief fixed the lever (Lever 2), the frozen surfaces, and "extend, don't replace";
these were open:

1. **`minAbsMag` source: mount-time scan** (Deliverables §2) over (a) a pack-format
   field — needs a format bump + regeneration of committed AND CDN packs, impossible in
   this repo state; (b) worker-side decode into a new `StarBatch` field — a core-types
   public-surface change across ≥ 3 packages for a value the mount can derive from data
   it already holds. Scan cost is flush-capped and strictly cheaper than the mount's own
   geometry upload.
2. **Floor = 0.004 fixed and frozen** (not a parameter, not 0.02). Research calls 0.004
   "absurdly generous"; 0.02 is its verified-visible bucket. The monolith-gate analysis
   (Step 0 §8) makes any higher floor a blank-sky risk past arrival. Margin reasoning:
   0.004 is 5× under visible, 25× under clearly-visible.
3. **Brightness cull runs only inside the TASK-093 camera guard** (`orientation !==
   null`), though it is orientation-independent (isotropic). Rationale: one cull
   contract ("never cull without a camera"), one hide path, zero new behaviour surface;
   the null case is a pre-init transient. The alternative (cull anyway) was rejected as
   unjustified divergence from the TASK-093 wiring this task extends.
4. **8/3/64 as module consts, not parameters** — the call site cannot supply them (they
   are render-stars' internal defaults); a citing comment + Step 0 §2 re-verification is
   the drift guard, matching repo precedent for load-bearing constants
   (`procgen-draw-budget.ts`).
5. **Additive probe/spec diagnostics explicitly permitted in Frozen** (`peakBrightnessCulled`,
   log token only) — mirrors TASK-093-NOTES judgment #2: Frozen forbids editing the gate
   *to pass*; log-only additions strengthen triage and cannot move pass/fail. Pre-authorizing
   them here removes the executor's temptation to either skip triage data or over-read Frozen.
6. **No Lever-3 pre-work, no fallback "keep ≥ N tiles" rule** — both are the obvious
   scope creeps; the first is a separate task by the brief, the second re-draws
   verified-invisible tiles (Failure modes).
