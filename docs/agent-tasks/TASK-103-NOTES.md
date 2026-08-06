# TASK-103 — NOTES (judgment log)

Log every judgment call as it happens (CLAUDE.md). Post-merge triage each into exactly one of:
spec/task bug · executor bug · doctrine gap.

## Step 0 — fact re-verification (2026-08-06)

All 5 spec facts verified TRUE against live code on this branch (base `origin/main` @ ba853eb,
which includes the TASK-100 merge PR#45). No contradiction → proceeding.

1. `pickNearestStar` calls `pickStar(hygBatch, hygOrigin, dir, PICK_MAX_ANGLE_RAD)`
   (`StarScene.tsx:474`) and `pickStar(exoBatch, …)` (`:483`), no brightness arg; arbitrates by
   smaller `angleRad` (`:486`). TRUE.
2. `pick.ts` `pickStar` is pure angular, `dist === 0` guard only, no exposure/absMag/floor. TRUE.
3. `pickAt` passes `p` scaled to parsecs via `unitsToPc` (`StarScene.tsx:295-302`), then
   `pickNearestStar(hygBatch, exoBatch, combined, p, dir)` (`:302`). TRUE.
4. `@cosmos/photometry` exports `starIsPerceptible`, `effectiveStarExposure`,
   `NATURAL_VISIBILITY_PROFILE`, `VISIBILITY_PROFILES`, `STAR_PERCEPTIBILITY_FLOOR`;
   `StarExposureLayer` union contains `'hyg'` and `'exoplanet'`; both = multiplier **1** in
   Natural (`index.ts:44-45`) AND Survey (`:55-56`). TRUE.
5. `StarScene.tsx:15` imports `effectiveStarExposure, NATURAL_VISIBILITY_PROFILE`; Gaia path reads
   `useSettingsStore.getState().exposure` at click time (`:324`). TRUE.

## Judgment call — branch base (main, not task/102)

**Decision:** created `task/103-…` off `origin/main` (has TASK-097 dep + TASK-100 merge), NOT off
`task/102`. TASK-103 is spec-declared independent of TASK-102, and mirroring TASK-100 requires
`octree-pick.ts` (present on main via PR#45). **Consequence:** the spec's step 5 said "the
TASK-103 row already exists in README" — that was true on the task/102 branch, false on main.
Re-added the row fresh (same wording it had on task/102); did NOT add the TASK-102 row (its own
branch owns it). *Provisional triage: spec/task bug (step 5's precondition assumed the 102-branch
base).* 

## Judgment call — TASK-102 profile branch: Natural-hardcoded

`useSettingsStore` (`packages/app-state/src/settings.ts:3-6`) has NO `mode` field on this base, so
TASK-102 (VIS-05) has not landed. Per spec "Relationship to TASK-102", I hard-select
`NATURAL_VISIBILITY_PROFILE` at the click site, exactly as TASK-100 did for the Gaia path — the
mode-aware `VISIBILITY_PROFILES[mode]` branch would be dead code (no `mode` to read). HYG/exo
multiplier is 1 in both profiles anyway, so this is behavior-identical to Survey. When 102 lands,
one call-site edit switches the profile and the pick follows automatically.

## Judgment call — `makeBatch` copied, not imported

Spec step 4 says "reuse `octree-pick.test.ts`'s `makeBatch` helper". That helper is a local (non-
exported) function in a file the spec Frozen § marks untouchable ("`octree-pick.ts` … and its
tests"). Exporting it would edit the frozen test; a shared test-util would force an import edit
into it too. So I copied `makeBatch` verbatim into `star-pick.test.ts` — the same sanctioned
mirroring the pick functions themselves use (`pick.ts` ↔ `octree-pick.ts` ↔ `star-pick.ts`).
*Provisional triage: spec/task bug (step 4 assumed the helper was importable; it isn't without
touching a frozen file).*

## Power test — pre-gate failure recorded (spec Acceptance gate)

Fixture straddles the floor at HYG effective exposure 25 (= slider 25 × multiplier 1), 10pc,
computed via `sampleRenderedStar` (the shared oracle, not re-derived):

- faint idx0, absMag 6.0 → **brightness = 0.0028175878977086417** (BELOW floor 0.004 → invisible)
- bright idx1, absMag 4.0 → **brightness = 0.11217019457425655** (above floor → drawn)

The POWER test asserts, in the same run, that the **un-gated `pickStar` returns idx0** (the faint
on-axis star) while the **gated `pickNearestVisibleStar` returns idx1** (the bright drawn star).
That paired assertion IS the pre-gate failure: the production change swaps `pickStar` →
`pickNearestVisibleStar`, so the old geometry-only path returned the invisible star — exactly the
defect. Console line emitted by the test:
`TASK-103 POWER: faint(idx0) brightness=0.0028175878977086417 < floor=0.004 < bright(idx1)=0.11217019457425655 @HYG=25`

## Implementation summary

- New pure app-glue `apps/web/src/glue/star-pick.ts` → `pickNearestVisibleStar` (single-batch
  `pickStar` + `starIsPerceptible` gate before `acos`; `effectiveExposure` required,
  `perceptibilityFloor` defaults to `STAR_PERCEPTIBILITY_FLOOR`; fail-closed on non-finite absMag).
- `StarScene.tsx`: `pickNearestStar` now takes `profile` + `sliderExposure`, routes each batch
  through `effectiveStarExposure(profile, 'hyg'|'exoplanet', slider)` into `pickNearestVisibleStar`.
  Removed the now-unused `pickStar` import. Call site hoists ONE `useSettingsStore.getState().exposure`
  read + `profile` and reuses them for both the HYG/exo and Gaia branches (previously the Gaia branch
  read the store a second time).
- `star-pick.test.ts`: 6 tests (sanity, POWER, exposure-sensitivity via two raw sliders,
  all-sub-floor→null, floor-equality, fail-closed NaN+Infinity). All green.

## Gate results (2026-08-06)

- `pnpm --filter @cosmos/web test` — green (star-pick.test.ts 6/6; full web suite passed).
- `pnpm typecheck` — green. `pnpm lint` — 0 errors. `pnpm verify` — 24/24 tasks successful.
- `git diff` confined to: `star-pick.ts`, `star-pick.test.ts`, `StarScene.tsx`, this NOTES, README
  row. No `render-stars` file, no `octree-pick.ts` touched (verify with `git diff --stat`).
