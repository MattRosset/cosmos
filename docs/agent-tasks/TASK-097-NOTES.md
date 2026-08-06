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

Instead of the full local Playwright suite (CPU-storm + orphan risk per standing guidance), ran
the deterministic-gate spec that exercises the changed code — `flythrough4` (near-Sol galaxy octree
brightness cull + field exposure) — via `test:smoke` (chromium, workers=1, run-to-completion).

**Result: the documented `flythrough4` near-Sol draw-call cap known-red, failure shape unchanged.**
Verified it is pre-existing, not introduced by this diff, by measuring both trees on this machine:

| tree | M3 control draws | M4a near-Sol draws | assertion (M4a ≤ M3) |
| --- | --- | --- | --- |
| base (changes stashed) | 44 | 82 | FAIL (line 261) |
| TASK-097 changes | 44 | 64 | FAIL (line 261) |

Same assertion, same line, both fail; the exact M4a draw count swings run-to-run (documented
near-Sol draw-call variance). Signal that the extraction is behavior-frozen: `brightnessCulled`
still fires (58 / 87 / 0 across legs), `cov=1.00`, procgen fades `0.00..1.00` correctly — the tile
cull and octree exposure behave exactly as before. `breadcrumb-transition` is `@perf`-tagged
(reference-only), so it is out of the deterministic gate. Did NOT claim the full `pnpm test:e2e`
exited 0.

Aside (CLAUDE.md rule 2): a prior memory recalled the sample-pack near-Sol assertion *passing*
(~43 draws). Current measured reality on this machine is 64–82 draws → red on base too. The cap
assertion is machine/frame-timing dependent; recall was stale, measurement is truth.
