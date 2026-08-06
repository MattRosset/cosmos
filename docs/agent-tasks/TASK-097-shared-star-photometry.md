# TASK-097: Extract the shared star-photometry contract

**Initiative:** visibility-aware galaxy streaming (VIS-04, moved before diagnostics)  
**Size:** M  
**Class:** mechanical extraction with behavior frozen  
**Depends on:** TASK-096 / ADR-007 (hard block)

## Goal

Add a DOM-, React-, and THREE-free `@cosmos/photometry` workspace package that is the CPU
owner of star apparent magnitude, point-size/flux math, mode profiles, effective exposure,
and render perceptibility. Rewire the existing tile brightness cull and renderer defaults to
that package without changing current Natural behavior or GLSL. Later diagnostics, picking,
and streaming must consume this package instead of replaying formulas independently.

This task intentionally precedes co-timed diagnostics: the diagnostic query needs a production
per-star perceptibility oracle and must not duplicate shader math in a test hook.

## Step 0 — verify the spec's facts

Re-confirm before editing. If a fact is false, STOP and update the spec.

1. `packages/render-stars/src/star-points.ts` still defaults to base/min/max point sizes
   `8 / 3 / 64` and passes them to `uBasePointPx`, `uMinPointPx`, and `uMaxPointPx`.
2. `packages/render-stars/src/shaders/stars.vert.glsl.ts` and `stars.frag.glsl.ts` still use
   the formulas cited by `apps/web/src/glue/tile-brightness-cull.ts`: distance clamp `0.001`,
   apparent magnitude, natural/rendered point sizes, floor-clamp area dimming, flux clamp,
   and exposure multiplication.
3. `apps/web/src/glue/tile-brightness-cull.ts` still owns duplicated constants
   `TILE_VISIBILITY_FLOOR = 0.004`, `8 / 3 / 64`, and the CPU replay.
4. `apps/web/src/scene/GalaxyScene.tsx` still owns
   `GALAXY_FIELD_EXPOSURE_BOOST = 6` and invokes the tile cull with effective exposure
   `slider × 6`.

## Context — read first

- `docs/decisions/ADR-007-star-visibility-modes.md` — frozen profiles and terminology.
- `docs/agent-tasks/TASK-094-galaxy-tile-brightness-cull.md` and `TASK-094-NOTES.md` —
  conservative tile-bound proof and prior test traps.
- `docs/research/star-shimmer-on-motion.md` — why the 3px floor requires area-ratio dimming.
- `docs/research/jitter-apple-mobile.md` — shader source guards are load-bearing and must remain.
- `packages/render-stars/src/star-points.ts` — renderer defaults to centralize.
- `packages/render-stars/src/shaders/stars.vert.glsl.ts` and `stars.frag.glsl.ts` — GLSL
  implementation that remains separate.
- `apps/web/src/glue/tile-brightness-cull.ts` — existing CPU implementation to replace, not
  fork.

## Frozen — do not touch

- Current rendered output, shader source, uniforms, point sizes, floor `0.004`, exposure slider,
  Natural effective exposures, and tile-cull truth table.
- `Natural` multipliers: galaxy octree 6; HYG/exoplanet/system 1.
- `Survey` multipliers: galaxy octree 40; HYG/exoplanet/system 1.
- Procgen photometry remains outside this package; its `CLOUD_EXPOSURE_BOOST` solves a different
  representation problem.
- Preserve the existing malformed-input truth table exactly:
  - any `NaN` argument makes `tileBelowVisibilityFloor` return `false`;
  - `minAbsMag === Number.NEGATIVE_INFINITY` returns `false`;
  - do not broaden this extraction into a new all-non-finite policy.
- `sampleRenderedStar().perceptible` is true only when brightness and floor are finite and
  `brightness >= floor`; the tile wrapper retains its existing fail-open guards before calling it.
- `@cosmos/photometry` cannot depend on app-state, render-stars, THREE, React, DOM, or app glue.
- GLSL remains in `@cosmos/render-stars`; this task creates source/vector conformance guards,
  not a shader generator.

Changing a frozen item requires a separate reviewed thaw task.

## Out of scope

- Adding mode state or UI (VIS-05).
- Changing pick behavior — that is TASK-100, the first consumer of this package, and it lands
  immediately after this task. Do not fold it into this diff; this one is behavior-frozen.
- Adding diagnostics (TASK-098/VIS-02).
- Changing selector demand, request priority, pack formats, bands, or assets.
- Retuning visual constants to make a test or performance gate pass.
- Moving blackbody/color logic; this task concerns intensity and rendered point radius only.

Findings during this task go to `docs/research/`; scope creep goes to a new task file, not
into this diff.

## Deliverables / steps

**Log every judgment call — anything this task didn't decide and you had to — to
`docs/agent-tasks/TASK-097-NOTES.md` beside the diff, visibly, as you go (not reconstructed
after).**

1. Create:
   - `packages/photometry/package.json`;
   - `packages/photometry/tsconfig.json`;
   - `packages/photometry/vitest.config.ts`;
   - `packages/photometry/src/index.ts`;
   - `packages/photometry/test/photometry.test.ts`.
   Use package name `@cosmos/photometry`, ESM export `./src/index.ts`, scripts
   `"build": "tsc --noEmit"`, `"typecheck": "tsc --noEmit"`, and
   `"test": "vitest run --coverage"`. Use node environment, coverage
   `include: ['src/**/*.ts']`, and statements threshold 85. No runtime dependencies.
2. Export these frozen primitives from the package:
   - `StarVisibilityMode = 'natural' | 'survey'`;
   - `StarExposureLayer = 'galaxy-octree' | 'hyg' | 'exoplanet' | 'system'`;
   - immutable `NATURAL_VISIBILITY_PROFILE` and `SURVEY_VISIBILITY_PROFILE`;
   - `STAR_RENDER_DEFAULTS = { basePointPx: 8, minPointPx: 3, maxPointPx: 64 }`;
   - `STAR_PERCEPTIBILITY_FLOOR = 0.004`;
   - `effectiveStarExposure(profile, layer, sliderExposure)`;
   - `apparentMagnitude(absMag, distancePc)`, with distance clamped to `0.001`;
   - `sampleRenderedStar(input: { absMag; distancePc; exposure; basePointPx?;
     minPointPx?; maxPointPx?; perceptibilityFloor? })` returning
     `apparentMagnitude`, `naturalPointPx`, `renderedPointPx`, `sizeDim`, `clampedFlux`,
     `brightness`, and `perceptible`;
   - `starIsPerceptible(...)` as a thin call through `sampleRenderedStar`, not a second formula.
3. Defaults are `8 / 3 / 64 / 0.004`. Clamp distance with
   `Math.max(distancePc, 0.001)`. Preserve the existing CPU calculation using `Math.log10`;
   GLSL remains `log2(d)/log2(10)`. Equality with the floor is perceptible. Do not round
   intermediate values or add a tolerance that changes existing tile-cull booleans.
4. Add table-driven package tests covering:
   - default Natural octree exposure `25 × 6 = 150`;
   - default Survey octree exposure `25 × 40 = 1000`;
   - non-octree multipliers remain 1;
   - bright flux clamp;
   - 3px floor area dimming;
   - 64px ceiling without a brightness multiplier above 1;
   - exact floor boundary (`brightness === 0.004` is perceptible);
   - distance clamp at `0.001`;
   - non-finite brightness/floor outputs are not reported perceptible;
   - the tile wrapper's existing NaN and negative-infinity fail-open cases.
   Log each failing vector's full input and every measured output.
5. Make `@cosmos/render-stars` depend on `@cosmos/photometry` and use
   `STAR_RENDER_DEFAULTS` for `createStarPoints` defaults. Keep generated uniforms and GLSL source
   unchanged.
6. Replace the formula and local constants in `tile-brightness-cull.ts` with
   `sampleRenderedStar`/shared constants. Preserve its public function and
   `TILE_VISIBILITY_FLOOR` export as a compatibility alias to
   `STAR_PERCEPTIBILITY_FLOOR`; do not change callers in this step.
7. Replace `GALAXY_FIELD_EXPOSURE_BOOST` ownership in `GalaxyScene.tsx` with
   `effectiveStarExposure(NATURAL_VISIBILITY_PROFILE, 'galaxy-octree', sliderExposure)`.
   There is no mode setting yet; Natural is hard-selected, so runtime behavior is unchanged.
8. Add conformance guards in the existing render-stars test suite:
   - retain all current load-bearing shader string assertions;
   - import shared constants and assert that `createStarPoints` defaults produce them;
   - assert the GLSL source still contains the distance, magnitude, size, `sizeDim`, flux, and
     exposure operations mirrored by the CPU package;
   - keep numeric CPU vectors only in `@cosmos/photometry`; do not copy them into this suite.
   Do not claim these guards execute compiled GLSL.
9. Add `@cosmos/photometry: "workspace:*"` to both
   `packages/render-stars/package.json` and `apps/web/package.json`; update the lockfile only
   as required by pnpm. No unrelated dependency upgrades.

## Failure modes to watch

1. **Formula drift at the point-size floor.** Omitting `(sNat / sRen)^2` makes faint 3px points
   visible and recreates shimmer. Detection: floor-dimming vectors and TASK-094 tests fail.
2. **Threshold boundary reversal.** Existing culling is `< floor`; equality must remain visible.
   Detection: exact-`0.004` vector.
3. **NaN turns into an aggressive cull.** `sampleRenderedStar` may yield NaN, but the tile
   wrapper must preserve the existing guards: any NaN argument and
   `minAbsMag === Number.NEGATIVE_INFINITY` return `false`. Do not introduce a broader
   all-non-finite policy during extraction.
4. **“Shader parity” test tests only a duplicate.** CPU vectors cannot prove compiled GLSL. Keep
   source guards explicit and retain existing browser/render verification as non-blocking
   evidence.
5. **Behavior changes during extraction.** `Math.log10` versus GLSL's
   `log2(d)/log2(10)` can differ near the floor. Preserve the existing CPU `Math.log10`
   operation for tile-cull parity; source guards cover GLSL structure. Do not introduce a
   tolerance or retune the floor.

## Acceptance gate

- `pnpm --filter @cosmos/photometry test` exits 0 with package coverage thresholds met.
- `pnpm --filter @cosmos/render-stars test` exits 0.
- `pnpm --filter @cosmos/web test` exits 0, including unchanged TASK-094 truth-table tests.
- `pnpm typecheck` exits 0.
- `pnpm lint` exits 0.
- A deterministic regression fixture compares the old TASK-094 expected cases with the extracted
  implementation and reports zero changed booleans. On failure it logs distance, radius,
  minAbsMag, effective exposure, old expected result, and new result.
- `git diff -- packages/render-stars/src/shaders` is empty.

## Verification beyond the gate

Run `pnpm test:e2e` once. Any new failure blocks the task. The already-documented
`flythrough4` near-Sol cap failure may remain as known-red evidence only if its failure shape
is unchanged and is cited from TASK-094/TASK-095; do not claim the full e2e command exited 0.
Screenshots or apparent visual parity checks are reference evidence only.
