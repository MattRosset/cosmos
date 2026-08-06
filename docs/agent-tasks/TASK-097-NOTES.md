# TASK-097 — NOTES (judgment calls logged as I went)

Behavior-frozen extraction of `@cosmos/photometry`. Steps 1–3 (package + primitives) landed in
the WIP commit `5c93fa8`; this session did steps 4–9 + the acceptance gate. Judgment calls the
task did not decide:

## 1. Tile cull returns `!sample.perceptible`, not a literal `brightness < floor`

`tileBelowVisibilityFloor` now calls `sampleRenderedStar({..., perceptibilityFloor: floor})` and
returns `!sample.perceptible`. The old body returned `flux * exposureEff * sizeDim < floor`.

- These are **identical for every finite input reachable here**: `perceptible` is
  `finite(bri) && finite(floor) && bri >= floor`, so `!perceptible === bri < floor` whenever both
  are finite, and `exposureEff` is always a finite `slider × multiplier`.
- The only theoretical divergence is `brightness === +Infinity` (old ⇒ kept, `!perceptible` ⇒
  culled), which is unreachable because `clampedFlux ≤ 1`, `sizeDim ≤ 1`, and `exposureEff` is
  finite.
- Chose `!perceptible` because TASK-097's whole point (Goal) is that consumers ask the shared
  oracle instead of re-comparing the formula themselves. The NaN fail-open guards stay in the
  wrapper (dropping a tile loses pixels), exactly as the frozen contract requires.
- **Proof:** the regression fixture (`tile-brightness-cull.regression.test.ts`) reports zero
  changed booleans against the frozen TASK-094 truth table.

## 2. `galaxyFieldExposure` helper in GalaxyScene instead of inlining at 3 call sites

Replaced the `GALAXY_FIELD_EXPOSURE_BOOST = 6` constant with a local
`galaxyFieldExposure(slider) = effectiveStarExposure(NATURAL_VISIBILITY_PROFILE, 'galaxy-octree',
slider)` and used it at all three sites (octree mount create, its `setExposure`, and the tile-cull
effective exposure). The ×6 now lives in `NATURAL_VISIBILITY_PROFILE` (ADR-007). Kept the whole
measured-rationale comment (why ×6 → effective ~150) — it is load-bearing tuning history, not the
magic number itself. Natural is hard-selected (no mode state yet, VIS-05), so runtime is unchanged.

## 3. Dedicated regression fixture file (`tile-brightness-cull.regression.test.ts`)

The acceptance gate names "a deterministic regression fixture … reports zero changed booleans …
logs distance, radius, minAbsMag, effective exposure, old expected, new". The existing
`tile-brightness-cull.test.ts` asserts the same booleans but as scattered `it` blocks without the
old-vs-new drift logging. Added the fixture as the named gate artifact: one frozen table copied
from the TASK-094 suite/NOTES, asserted against the extracted implementation, logging every
required field only on drift. The booleans are hand-copied (the contract), never recomputed.

## 4. Distance clamp ownership

The wrapper passes the raw nearest-approach distance `distToCenterPc - radiusPc`;
`sampleRenderedStar`/`apparentMagnitude` apply the `MIN_DISTANCE_PC = 0.001` clamp internally
(same value the old inline `Math.max(…, 0.001)` used). The clamp is now owned once, in the package.

## 5. `−∞ minAbsMag` is emergent, not a special guard

The tile wrapper only explicitly guards NaN. `−∞` flows through: it drives flux→1, size→64px,
sizeDim→1, so `brightness = exposureEff` (finite, ≥ floor) ⇒ kept. The package test pins this
primitive behavior; the wrapper's app-suite test documents the same kept outcome. Neither adds a
`−∞`-specific branch — the spec's frozen "`minAbsMag === NEGATIVE_INFINITY` returns false" is
satisfied by the arithmetic, not by a guard.

## 6. e2e verification (beyond the deterministic gate)

Ran the deterministic-gate spec that exercises the changed code — `flythrough4` (near-Sol galaxy
octree brightness cull + field exposure) — via `test:smoke` (chromium, workers=1).

**Result on the CI-representative sample pack: PASS.** M4a near-Sol = **43 draws / 200105 pts**
(≤ M3 control 44) — bit-matches CI. The extraction is behavior-frozen: `brightnessCulled` fires,
`cov=1.00`, procgen fades `0.00..1.00` correctly.

### Correction — I first mis-called this a "known-red" (my error, not a code issue)

My initial run showed `flythrough4` FAILING (M4a 64–82 draws > 44) and I wrote it up as the
"pre-existing near-Sol cap known-red." That was **wrong**: `apps/web/.env.local` points
`VITE_GAIA_OCTREE_MANIFEST_URL` at the full ~3M pack, so the local build was serving the WRONG
pack (CI serves `octree-gaia-sample`, 135 stars). My earlier "`.env.local` absent" check was a
false negative — I ran the `ls` from the wrong cwd (`e2e/`, not repo root). This is exactly the
`.env.local` contamination trap that a memory note explicitly warned about (and that I repeated
from a prior PR). After moving `.env.local` aside, rebuilding, and confirming the bundle inlines
`/packs/octree-gaia-sample/octree.json`, the spec PASSES at the CI numbers. `.env.local` restored
afterward.

Lesson (CLAUDE.md rule 2, current state is truth): verify the baked manifest BEFORE trusting any
`flythrough4` number — `grep -roE '/packs/octree-gaia[a-z0-9-]*/octree.json' apps/web/dist/assets/*.js`.
The base-vs-branch comparison I ran on the contaminated pack was still internally valid (both
matched in shape) but its absolute "red" was a pack artifact, not a gate result.

`breadcrumb-transition` is `@perf`-tagged (reference-only), so it is out of the deterministic gate.
Did NOT run the full `pnpm test:e2e`.
