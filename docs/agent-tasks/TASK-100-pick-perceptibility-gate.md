# TASK-100: Stop the Gaia pick from claiming imperceptible stars

**Initiative:** visibility-aware galaxy streaming (VIS-06a — promoted ahead of the streaming
candidates)
**Size:** S
**Class:** behavior fix with a power-proven gate
**Depends on:** TASK-097 (hard block: the perceptibility oracle). Independent of TASK-098 and
TASK-099 — do not wait for either.

## Goal

`pickNearestGaia` scans every Gaia point in every drawn tile with no brightness test, so a click
on empty-looking sky returns a star that contributes no pixels. Gate each candidate on the same
perceptibility predicate the renderer and the tile cull already use, so the pick can only claim a
star the frame actually shows.

This is the one measured, user-visible defect the streaming research surfaced that needs no
selector redesign, no new pack format, and no new diagnostics. It ships first because it is also
the cheapest real validation that `@cosmos/photometry` is the right seam.

## Why now — the measurement

`docs/research/galaxy-octree-streaming-value-near-sol.md` Claim 5, verified 2026-08-05: inside
the 25 tiles that survive both draw-time culls at settled Sol, only 18,476 of 233,795 points
(7.90%) reach the floor `0.004`. The other 92.10% are invisible and every one of them is a
live pick candidate. Related prior context: `docs/research/gaia-pick-identity-gap.md`.

## Step 0 — verify the spec's facts

Re-confirm before editing. If one is false, STOP and update this spec.

1. `apps/web/src/glue/octree-pick.ts` still exports `pickNearestGaia(tiles, cameraLocalPc,
   rayDirUnit, maxAngleRad)` and its inner loop computes `dist` (camera-relative parsecs) before
   the angular test, with no brightness test anywhere.
2. `apps/web/src/scene/StarScene.tsx` still calls `pickNearestGaia` from `pickAt` and reads
   slider exposure from `useSettingsStore`.
3. `apps/web/src/scene/GalaxyScene.tsx` applies the galaxy-octree exposure multiplier to octree
   mounts (after TASK-097 this is `effectiveStarExposure(NATURAL_VISIBILITY_PROFILE,
   'galaxy-octree', sliderExposure)`).
4. `@cosmos/photometry` exports `starIsPerceptible`, `effectiveStarExposure`,
   `NATURAL_VISIBILITY_PROFILE`, and `STAR_PERCEPTIBILITY_FLOOR` (TASK-097).

## Context — read first

- `docs/research/galaxy-octree-streaming-value-near-sol.md` — Claim 5 and its recheck.
- `docs/research/gaia-pick-identity-gap.md` — why the octree pick path exists at all.
- `docs/decisions/ADR-007-star-visibility-modes.md` — perceptibility is camera- and
  profile-dependent by design; residency is never a display or pick promise.
- `apps/web/src/glue/octree-pick.ts` — the function to change.
- `apps/web/src/scene/StarScene.tsx` — the only production call site.

## Frozen — do not touch

- The angular selection rule (smaller angle wins; ties by nearer distance), `maxAngleRad`
  semantics, the gaia-only range scope, and `gaiaHitWins` arbitration against hyg/exo.
- Rendering, streaming, culling, the HYG/exo pick path, and the identity upgrade to
  `gaia:<source_id>`.
- The floor stays `0.004`, imported from `@cosmos/photometry`. Never retune it, and never add a
  pick-only floor: a pick-visible star that the renderer does not draw is exactly the bug.
- `pickNearestGaia` stays pure (no store, no DOM, no THREE) and unit-testable without WebGL.

## Out of scope

- Mode state/UI (VIS-05), streaming selection, prefetch, bands, pack changes.
- Making the pick cheaper by other means (spatial index, early-out by tile) — measure first.
- Changing what the info card says about naked-eye visibility (catalog truth, ADR-007 item 5).

Findings during this task go to `docs/research/`; scope creep goes to a new task file, not into
this diff.

## Deliverables / steps

**Log every judgment call — anything this task didn't decide and you had to — to
`docs/agent-tasks/TASK-100-NOTES.md` beside the diff, visibly, as you go (not reconstructed
after).**

1. Add a required `effectiveExposure: number` parameter to `pickNearestGaia` (and an optional
   `perceptibilityFloor` defaulting to `STAR_PERCEPTIBILITY_FLOOR`). A required parameter, not an
   optional one with a default: an unmigrated call site must fail typecheck, not silently keep
   the old behavior.
2. In the inner loop, after `dist` and **before** the `acos`, skip the point when
   `starIsPerceptible({ absMag: batch.absMag[i], distancePc: dist, exposure: effectiveExposure,
   perceptibilityFloor })` is false. Ordering matters twice: it is the cheaper test, and it must
   use the same camera-relative distance the renderer uses. Do not reimplement the formula.
3. Keep the existing `dist === 0` guard and the existing malformed-input behavior of the
   photometry package: a non-finite `absMag` yields non-perceptible, so such a point is skipped
   rather than claimed. State this in a comment — it is a deliberate fail-closed choice for
   picking, opposite to the tile cull's fail-open, because a wrong claim is worse than a miss.
4. Pass the value from `StarScene.tsx` as
   `effectiveStarExposure(NATURAL_VISIBILITY_PROFILE, 'galaxy-octree', <slider exposure>)`, read
   at click time. Natural is hard-selected until VIS-05; when mode state lands, this one call
   site switches profile and the pick follows automatically.
5. Unit tests in `apps/web/src/glue/octree-pick.test.ts`:
   - **Power test (must fail before the fix):** two gaia points in one tile — a faint one closer
     to the ray axis and a bright one slightly off-axis, chosen so the faint one is below the
     floor and the bright one above it at the same exposure. Assert the returned `catalogId` is
     the bright star. Record in NOTES that this test was run against the pre-change function and
     failed.
   - Exposure sensitivity: the same faint star becomes claimable at a Survey-level effective
     exposure (1000) and is not at Natural (150). This is the contract, not a bug.
   - A tile whose points are all below the floor returns `null` (no fallback to the "least
     invisible" star).
   - Floor equality is claimable (`brightness === 0.004`), matching the render/cull boundary.
   - Non-finite `absMag` is skipped, and a mixed tile still returns the finite bright star.
   - Existing tests (gaia-only ranges, `originPc` rebasing, tie-breaks, `gaiaHitWins`) keep
     passing with only the new argument threaded through.
6. Log, in NOTES, the measured candidate-count reduction: at settled Sol on the full pack
   (`VITE_GAIA_OCTREE_MANIFEST_URL=/packs/octree-gaia/octree.json`), the count of scanned points
   versus the count that pass the gate. Claim 5 predicts ≈7.9% pass. A wildly different number
   means one of the two paths is wrong — investigate before shipping.

## Failure modes to watch

1. **A pick-only floor.** Any floor other than the shared `0.004` at the shared effective
   exposure re-creates the mismatch in the other direction. Detection: constant imported, never
   redefined; the exposure comes from the same helper the scene uses.
2. **Wrong distance.** Photometry needs camera-relative parsecs, which is the loop's `dist`, not
   `|positionPc|` (distance from Sol) and not the tile-local coordinate. Detection: a test with a
   camera far from Sol where the two differ by more than the floor's margin.
3. **Fail-open copied from the tile cull.** The cull is conservative because dropping a tile
   loses pixels; the pick must be conservative in the opposite direction. Detection: the
   non-finite-`absMag` test.
4. **A green test that never exercised the gate.** If the fixture's faint star is above the floor
   anyway, the test passes on unfixed code. Detection: the power test's pre-change red run,
   recorded in NOTES with the actual brightness values of both fixture stars.
5. **Silent behavior change for HYG/exo.** Only the octree gaia path changes. Detection:
   `git diff` touches no `render-stars` pick code, and the existing hyg pick tests are unmodified.

## Acceptance gate

- `pnpm --filter @cosmos/web test` exits 0, including the new tests.
- `pnpm typecheck` and `pnpm lint` exit 0.
- `pnpm verify` exits 0.
- NOTES records the power test's pre-change failure with both fixture stars' computed brightness,
  and the settled-Sol pass-rate measurement from step 6.
- `git diff` is confined to `apps/web/src/glue/octree-pick.ts`, its test file,
  `apps/web/src/scene/StarScene.tsx`, and the NOTES file.

## Verification beyond the gate

On the full pack at settled Sol, click a patch of sky that shows no star and confirm no Gaia card
opens; then click a visibly drawn Gaia star and confirm it still selects. Record both as
reference evidence. Run `pnpm test:e2e` once; only the documented pre-existing `flythrough4`
near-Sol cap failure may remain known-red.
