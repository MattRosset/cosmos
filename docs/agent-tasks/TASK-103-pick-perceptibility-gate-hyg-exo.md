# TASK-103: Stop the HYG/exo star pick from claiming imperceptible stars

**Initiative:** visibility-aware picking (VIS-06b — the HYG/exo half of the pick fix TASK-100
started for Gaia)
**Size:** S
**Class:** behavior fix with a power-proven gate
**Depends on:** TASK-097 (hard block: the perceptibility oracle `@cosmos/photometry`). Independent
of TASK-102 (VIS-05) — see "Relationship to TASK-102" below; if 102 lands first, thread the mode,
if not, Natural-only is sufficient.

## Goal

`pickNearestStar` (`apps/web/src/scene/StarScene.tsx`) picks the angularly-nearest HYG/exoplanet
star with **no brightness test**, so a click on empty-looking sky returns a star that contributes
no pixels — the exact asymmetry TASK-100 named and fixed for the Gaia octree pick. Gate each
HYG/exo candidate on the same perceptibility predicate the renderer, tile cull, and (since
TASK-100) the Gaia pick already use, so the pick can only claim a star the frame actually shows.

This is TASK-100 applied to the other pick path. It is a measured, user-visible defect (clicking
dark sky selects an invisible HYG star), needs no selector redesign and no new data, and reuses
`@cosmos/photometry` exactly as TASK-100 did.

## Why now — the defect

Confirmed in code 2026-08-06 (re-verify in Step 0):

- `StarScene.tsx` `pickNearestStar` (~line 462) calls `pickStar` (from `@cosmos/render-stars`)
  with geometry only — `(batch, origin, dir, maxAngle)`. There is no exposure/floor/absMag term
  anywhere on this path.
- `packages/render-stars/src/pick.ts` `pickStar` returns the angularly-nearest star **whether or
  not it draws** — pure angular math, no photometry.
- The renderer draws HYG/exo through the shared star shader with floor `0.004`. A sub-floor
  HYG/exo star therefore paints no pixel yet stays a live pick candidate — identical to the Gaia
  bug TASK-100 closed.

Observed live: clicking dark sky opens the info card of a HYG star that draws nothing.

## Step 0 — verify the spec's facts

Re-confirm before editing. If one is false, STOP and update this spec (rule 1 — do not improvise
around a contradiction).

1. `StarScene.tsx` `pickNearestStar` still calls `pickStar(hygBatch, hygOrigin, dir,
   PICK_MAX_ANGLE_RAD)` and `pickStar(exoBatch, exoOrigin, dir, PICK_MAX_ANGLE_RAD)` with **no**
   brightness argument, and arbitrates hyg-vs-exo by smaller `angleRad`.
2. `packages/render-stars/src/pick.ts` `pickStar` has no `exposure`/`absMag`/floor term (pure
   angular test, `dist === 0` guard only).
3. The `pickAt` call site (`StarScene.tsx` ~line 302, `pickNearestStar(hygBatch, exoBatch,
   combined, p, dir)`) passes `p` **already scaled to parsecs** (TASK-083, `unitsToPc` at
   ~line 295) — so the per-batch `dist` the gate uses is camera-relative parsecs, the same unit
   the renderer uses. If `p` is not in parsecs, STOP: the gate would be evaluated at the wrong
   distance.
4. `@cosmos/photometry` exports `starIsPerceptible`, `effectiveStarExposure`,
   `NATURAL_VISIBILITY_PROFILE`, `VISIBILITY_PROFILES`, and `STAR_PERCEPTIBILITY_FLOOR`, and its
   `StarExposureLayer` enum contains **`'hyg'`** and **`'exoplanet'`** (note: `'exoplanet'`, not
   `'exo'`), each with multiplier **1 in both** the Natural and Survey profiles (ADR-007 §8).
5. `StarScene.tsx` already reads slider exposure from `useSettingsStore.getState().exposure` at
   click time for the Gaia path (~line 324) and imports `effectiveStarExposure` /
   `NATURAL_VISIBILITY_PROFILE` from `@cosmos/photometry`.

## Context — read first

- `docs/agent-tasks/TASK-100-pick-perceptibility-gate.md` — the **exact precedent**: same defect,
  same oracle, same gate-inside-the-search rule, same fail-closed choice. Its "Failure modes"
  transfer here almost verbatim.
- `apps/web/src/glue/octree-pick.ts` — the shape to mirror: a **pure app-glue** pick function that
  gates each candidate via `starIsPerceptible` before `acos`, unit-testable in vitest (no WebGL),
  with `effectiveExposure` a **required** parameter. Copy this pattern.
- `packages/photometry/src/index.ts` — `starIsPerceptible`, `effectiveStarExposure`, the floor,
  the layer enum. The single source of truth; never reimplement the formula.
- `docs/decisions/ADR-007-star-visibility-modes.md` — perceptibility is camera- and
  profile-dependent by design; HYG/exo/system stay on the raw slider (multiplier 1) in both modes.
- `packages/render-stars/src/pick.ts` — `pickStar`: FROZEN, do not touch (see Frozen).
- `apps/web/src/scene/StarScene.tsx` — `pickNearestStar` and its single `pickAt` call site.

## Decision — where the gate lives (RESOLVED; do not reopen)

The task offered (a) thaw `pickStar` to take a perceptibility predicate, or (b) move the gated
angular search to app-glue. **Choose (b): a new pure app-glue function**, `pickNearestVisibleStar`
in a new `apps/web/src/glue/star-pick.ts`, mirroring `octree-pick.ts`. `pickStar` and all of
`render-stars` stay frozen and untouched.

Justification (rule 5 — repo precedent outranks the ecosystem default):

- **Exact precedent.** TASK-100 faced the identical choice and kept the gated loop in app-glue
  (`pickNearestGaia`) precisely so the frozen `pick.ts` would not depend on `@cosmos/photometry`.
  This task is that decision applied to the sibling path.
- **No frozen-package thaw.** `render-stars` is frozen at the Phase-1 gate. Option (a) is a
  public-API change to a frozen package (a sanctioned-thaw event, à la TASK-060) for no benefit
  option (b) doesn't already give.
- **The duplication is already the sanctioned pattern.** `pick.ts` and `octree-pick.ts` already
  carry two copies of the same angular test on purpose (`octree-pick.ts` header: "Mirrors
  render-stars/pick.ts's pure angular test"). A third mirror in `star-pick.ts` is consistent, not
  novel — and the alternative (a shared-loop abstraction) is exactly the over-abstraction the
  mechanical-task rule forbids.
- **`render-stars` stays free of `@cosmos/photometry`** — the dependency the frozen package must
  not take, same reason TASK-100 gave.

The gate goes **inside** the per-batch angular search (skip a sub-floor candidate before `acos`,
keep scanning), **not** as a post-filter on the single winner — rejecting the returned nearest
would drop a perceptible star that sits behind an invisible one on the ray.

## Frozen — do not touch

- `packages/render-stars/src/pick.ts` (`pickStar`) and every other `render-stars` file — the
  `git diff` must not touch `render-stars` at all (mirror TASK-100's Frozen item 5).
- `apps/web/src/glue/octree-pick.ts` (the Gaia pick) and its tests — this task does not touch the
  Gaia path.
- The angular selection rule (smaller `angleRad` wins; ties by nearer `distancePc`),
  `PICK_MAX_ANGLE_RAD`, and the hyg-vs-exo arbitration (smaller angle wins) — the gate only
  removes candidates from each per-batch search; it never changes how a survivor is chosen or how
  hyg/exo/gaia are arbitrated.
- The floor stays `0.004`, imported as `STAR_PERCEPTIBILITY_FLOOR` from `@cosmos/photometry`.
  Never retune it and **never add a pick-only floor**: a pick-visible star the renderer does not
  draw is exactly the bug. (TASK-100 Failure mode 1.)
- `pickNearestVisibleStar` stays pure (no store, no DOM, no THREE), unit-testable without WebGL —
  exactly like `pickNearestGaia`.

## Out of scope

- The Gaia octree pick (TASK-100 owns it), galaxy pick, planet raycast.
- Mode state/UI (TASK-102 / VIS-05) — this task threads a profile parameter but does not create
  mode state.
- Making the pick cheaper (spatial index, early-out) — measure first, separate task.
- What the info card says about naked-eye visibility (catalog truth, ADR-007 item 5).

Findings during this task go to `docs/research/` (create it if missing); scope creep goes to a new
task file, not into this diff.

## Relationship to TASK-102 (VIS-05)

Independent. HYG and exoplanet layers have exposure multiplier **1 in both** Natural and Survey
(ADR-007 §8), so the effective HYG/exo exposure is the raw slider value **regardless of mode** —
the mode is very nearly inert on this path. Two consequences, both required:

- **Route the raw slider through `effectiveStarExposure(profile, 'hyg'|'exoplanet', slider)`
  anyway** — one source of truth, so the seam is ready if a future profile ever gives HYG a
  non-1 multiplier. Do not hardcode "exposure = slider".
- **Profile selection:** if TASK-102 has landed (a `mode` field exists on `useSettingsStore`),
  read `VISIBILITY_PROFILES[mode]` at click time; if it has not, hard-select
  `NATURAL_VISIBILITY_PROFILE`, exactly as TASK-100 did for the Gaia path. Either way the pick
  follows the mode automatically once 102 wires it. **Log in NOTES which branch you took and why.**

## Deliverables / steps

**Log every judgment call — anything this task didn't decide and you had to — to
`docs/agent-tasks/TASK-103-NOTES.md` beside the diff, visibly, as you go (not reconstructed
after).**

1. **New file `apps/web/src/glue/star-pick.ts`** exporting:

   ```
   pickNearestVisibleStar(
     batch: StarBatch,
     rayOriginPc: readonly [number, number, number],
     rayDirUnit: readonly [number, number, number],
     maxAngleRad: number,
     effectiveExposure: number,
     perceptibilityFloor?: number,   // defaults to STAR_PERCEPTIBILITY_FLOOR
   ): StarPickHit | null
   ```

   - Import `StarPickHit` **as a type** from `@cosmos/render-stars` (reuse the shape; do not
     redeclare it), and `starIsPerceptible` / `STAR_PERCEPTIBILITY_FLOOR` from
     `@cosmos/photometry`.
   - Body = `pickStar`'s loop verbatim in structure (same `dist === 0` guard, same
     `cosA`/`acos`, same "smaller angle wins; ties by nearer dist"), with **one addition**: after
     `dist` and **before** `acos`, `continue` when
     `!starIsPerceptible({ absMag: batch.absMag[i]!, distancePc: dist, exposure:
     effectiveExposure, perceptibilityFloor })`. Ordering matters twice, same as TASK-100: the
     perceptibility test is cheaper than `acos`, and `dist` is the camera-relative parsecs the
     renderer uses.
   - `effectiveExposure` is **required** (no default) — an unmigrated caller must fail typecheck,
     not silently keep the over-claiming behavior. `perceptibilityFloor` defaults to
     `STAR_PERCEPTIBILITY_FLOOR`; never pass a pick-only floor.
   - **Fail-closed** by design: a non-finite `absMag` yields non-perceptible, so the point is
     skipped rather than claimed. State this in a comment as a deliberate choice — the opposite
     bias from the tile cull's fail-open, because a wrong claim is worse than a miss. (Copy
     TASK-100's comment wording.)

2. **`pickNearestStar` (`StarScene.tsx`):** replace the two `pickStar(...)` calls with
   `pickNearestVisibleStar(...)`, threading each batch's effective exposure:
   `effectiveStarExposure(profile, 'hyg', sliderExposure)` for `hygBatch`,
   `effectiveStarExposure(profile, 'exoplanet', sliderExposure)` for `exoBatch` (note the layer
   is `'exoplanet'`). Add the required parameters `pickNearestStar` needs to compute these —
   pass in the `profile` (a `StarVisibilityProfile`) and `sliderExposure` (a `number`); read both
   at the call site (step 3). Leave the hyg-vs-exo arbitration and the return shape byte-for-byte
   unchanged.

3. **Call site (`StarScene.tsx` `pickAt`, ~line 302):** read `sliderExposure =
   useSettingsStore.getState().exposure` at click time (same store read the Gaia path already
   does at ~324 — hoist a single read above the HYG pick and reuse it for the Gaia branch rather
   than reading the store twice), select the profile per "Relationship to TASK-102" above, and
   pass both to `pickNearestStar`. Do not read the store inside `pickNearestStar` — keep it pure,
   mirroring how `StarScene` computes `octreeExposure` and hands it to `pickNearestGaia`. Note:
   `StarScene.tsx:15` currently imports only `effectiveStarExposure, NATURAL_VISIBILITY_PROFILE`
   from `@cosmos/photometry`; add the `StarVisibilityProfile` **type** import (and
   `VISIBILITY_PROFILES` only if you take the mode-aware branch — it is dead code today since
   `useSettingsStore` has no `mode` field yet, so Natural is hard-selected).

4. **Unit tests in `apps/web/src/glue/star-pick.test.ts`** (mirror `octree-pick.test.ts`):
   - **Power test (must fail before the fix):** one `StarBatch` with two stars — a faint one
     **closer to the ray axis** (below the floor at the test exposure) and a bright one **slightly
     off-axis** (above the floor). Assert `pickNearestVisibleStar` returns the **bright** star's
     index, never the invisible one. To show it is a real gate, also assert that the un-gated
     `pickStar` on the same batch returns the **faint** star (proving the fixture exercises the
     gate). Record in NOTES that the equivalent assertion fails against the pre-gate path, with
     the **computed `brightness` of both fixture stars** (via `sampleRenderedStar`) so the fixture
     is provably straddling the floor, not accidentally both-above.
   - **All sub-floor → `null`:** a batch whose every star is below the floor returns `null` — no
     fallback to the "least invisible" star.
   - **Floor equality is claimable:** a star with `brightness === 0.004` is returned (matches the
     render/cull `< floor` boundary).
   - **Non-finite `absMag` skipped:** a `NaN`/`Infinity` `absMag` star is never returned; a mixed
     batch still returns the finite perceptible star.
   - **Exposure sensitivity:** the same faint star is not claimable at a low exposure and becomes
     claimable at a high one — the contract, not a bug (mirror TASK-100's Survey/Natural test;
     note that for HYG the two modes give the *same* exposure, so drive this test with two raw
     slider values, not two modes).
   - Build fixtures with real `StarBatch` fields — **reuse `octree-pick.test.ts`'s `makeBatch`
     helper**, which already fills every required field (`StarBatch` needs `colorIndexBV` and
     `hipIds` too, not only `positionsPc`/`absMag`/`catalogIds`/`count`/`originPc`/`idPrefix`).
     Do not hardcode `brightness` — derive floor-straddling `absMag` values from
     `sampleRenderedStar` so the test asserts against real photometry (CLAUDE.md testing rule 1:
     query the oracle, don't re-derive it).

5. The TASK-103 row **already exists** in `docs/agent-tasks/README.md` (Status table, `pending`) —
   do not append a duplicate. Flip only its Status cell per the README's own
   in-progress/done convention as you execute (rule 1 at the top of the README).

## Failure modes to watch

Mined from TASK-100's list (same defect class — they transfer) and this path's specifics:

1. **A pick-only floor.** Any floor other than the shared `0.004` at the shared effective exposure
   re-creates the mismatch in the other direction. Detection: constant imported from
   `@cosmos/photometry`, never redefined; exposure comes from `effectiveStarExposure`, the same
   helper the scene uses.
2. **Wrong distance.** `starIsPerceptible` needs **camera-relative** parsecs — the loop's `dist`
   — not `|positionPc|` (distance from Sol) and not the tile/batch-local coordinate. This path is
   extra exposed because the ray origin arrives as `cameraLocalPc - batch.originPc` and
   `cameraLocalPc` is only in parsecs because TASK-083 scales it (Step 0 item 3). Detection: a
   test with the camera far from the batch origin where `dist` and `|positionPc|` differ by more
   than the floor's margin, plus the Step-0 re-verify.
3. **Fail-open copied from the tile cull.** The cull fails open (dropping a tile loses pixels);
   the pick must fail closed (a wrong claim is worse than a miss). Detection: the non-finite
   `absMag` test.
4. **A green test that never exercised the gate.** If the fixture's faint star is above the floor
   anyway, the power test passes on unfixed code. Detection: the power test's paired
   `pickStar`-returns-faint assertion and the NOTES record of both stars' computed `brightness`.
5. **Wrong layer name.** The photometry layer for exoplanets is **`'exoplanet'`**, not `'exo'`;
   HYG is `'hyg'`. A typo'd layer key is a runtime `undefined` multiplier → `NaN` exposure →
   everything fails-closed to `null` (the pick goes dead, not over-claiming). Detection: typecheck
   (the enum is a union) + the exposure-sensitivity test returning a real hit.
6. **Silent behavior change for Gaia.** Only the hyg/exo path changes. Detection: `git diff`
   touches no `octree-pick.ts` and no `render-stars` code; the Gaia pick tests are unmodified.
7. **Store read inside the pure function.** If `pickNearestVisibleStar` or `pickNearestStar`
   reaches into `useSettingsStore`, the unit test can't run headless and the function stops being
   pure. Detection: exposure/profile arrive as parameters; the only store read is in `pickAt`.

## Acceptance gate

- `pnpm --filter @cosmos/web test` exits 0, including the new `star-pick.test.ts`.
- `pnpm typecheck` and `pnpm lint` exit 0.
- `pnpm verify` exits 0.
- NOTES records: the power test's pre-gate failure with both fixture stars' computed `brightness`;
  which TASK-102 branch (mode-aware vs Natural-hardcoded) was taken and why.
- `git diff` is confined to `apps/web/src/glue/star-pick.ts`, `apps/web/src/glue/star-pick.test.ts`,
  `apps/web/src/scene/StarScene.tsx`, `docs/agent-tasks/TASK-103-NOTES.md`, and the README row.
  In particular it touches **no** `render-stars` file and **no** `octree-pick.ts`.

## Verification beyond the gate

On the full pack (`.env.local` with the 4.7M pack, or the sample pack) at a settled vantage where
HYG stars are drawn: click a patch of sky that shows no star and confirm no HYG/exo info card
opens; then click a visibly drawn HYG star and confirm it still selects. Record both as reference
evidence (screenshots are reference-only, never a blocking gate — CLAUDE.md §4). Run
`pnpm test:e2e` once; only the documented pre-existing `flythrough4` near-Sol cap failure may
remain known-red (see the `flythrough4 .env.local pack contamination` note — measure on the sample
pack, not `.env.local`, before calling anything else red).
