# TASK-100 NOTES — pick perceptibility gate

Judgment calls and evidence, logged as the work happened (not reconstructed after).

## Step 0 — facts re-verified against live code (all true; no spec update needed)

1. `apps/web/src/glue/octree-pick.ts` exported `pickNearestGaia(tiles, cameraLocalPc, rayDirUnit,
   maxAngleRad)`; inner loop computed `dist` before the `acos`, no brightness test anywhere. ✓
2. `StarScene.tsx` calls `pickNearestGaia` from `pickAt` (line ~315) and reads slider exposure via
   `useSettingsStore.getState().exposure`. ✓
3. `GalaxyScene.tsx` computes octree exposure via
   `effectiveStarExposure(NATURAL_VISIBILITY_PROFILE, 'galaxy-octree', sliderExposure)` (line ~114). ✓
4. `@cosmos/photometry` exports `starIsPerceptible`, `effectiveStarExposure`,
   `NATURAL_VISIBILITY_PROFILE`, `STAR_PERCEPTIBILITY_FLOOR`. ✓

TASK-097 is merged into `main` (`5877d49`, PR#44), so the hard-block dependency is satisfied.

## Power test — pre-change RED run (required evidence)

Fixture (`octree-pick.test.ts`, describe "TASK-100 perceptibility gate", test "POWER"): one tile,
two gaia points, camera at origin, ray `+x`, effective exposure Natural = 150.

- idx0 catalogId **900**, faint, absMag 7.5, at `[10,0,0]` — EXACTLY on the ray (angle 0).
  `sampleRenderedStar` brightness @150 = **0.0010666667** → **below** the floor 0.004 → invisible.
- idx1 catalogId **901**, bright, absMag 1.0, at `[10,0.05,0]` — ~0.005 rad off-axis.
  brightness @150 = **59.716** → far above the floor → drawn.

Run against the **un-gated** (main) `pickNearestGaia` — reverted the source, kept the new test:

```
$ vitest run src/glue/octree-pick.test.ts -t "POWER"   # source reverted to main
TASK-100 POWER: faint(900) brightness=0.0010666666666666665 < floor=0.004 < bright(901)=59.716... @NAT=150
× POWER: a faint ON-axis star below the floor loses to a bright OFF-axis star above it
AssertionError: expected 900 to be 901   (received 900)
```

The un-gated pick returns **900** — the faint, on-axis, imperceptible star — exactly the defect
(a click on empty-looking sky claims a star the frame never drew). With the gate restored, the
full file is **18/18 green** and the power test returns **901** (the drawn star). This proves the
test exercises the gate rather than passing on unfixed code (failure mode 4).

## Settled-Sol pass-rate measurement (step 6) — BLOCKED on a displayed browser pane

Step 6 asks for the scanned-vs-passing candidate count at settled Sol on the full pack
(`VITE_GAIA_OCTREE_MANIFEST_URL=/packs/octree-gaia/octree.json`), predicted ≈7.9% by Claim 5.

Setup done: `.env.local` already points at the full pack (`.../octree-gaia/octree.json`, ~3M /
1267 tiles, present locally); dev server started on :5173; galaxy context at Sol (`local
[0,0,0]`), exposure 25.

Blocked, honestly: the in-app Browser pane is **not displayed**, so the page never composites and
`requestAnimationFrame` never fires — streaming stays at `loadedChunks: 0`, `renderedPoints: 0`,
`catalogCoverage: 0` (the idle→hidden throttle in memory `preview-tab-idle-hidden`). A manual rAF
pump from `javascript_tool` times out for the same reason. Two further obstacles even once frames
flow: (a) there is **no committed read seam** for the visible octree tiles + their gaia ranges
(`octreePickHolder` and `octreeCombined` are module/closure-scoped, not on `window.__cosmos`), so
the scan-count replay needs a temporary, uncommitted instrumentation to keep the diff confined to
the four permitted files; (b) reaching "settled Sol" with 1267 tiles streamed.

Not faked. The gate calls `starIsPerceptible` — the identical shared oracle Claim 5's script used
— at the Natural octree exposure (`effectiveStarExposure(NATURAL,'galaxy-octree',slider)`, the
same value `GalaxyScene` renders with) and the loop's camera-relative `dist`, so a faithful live
replay should reproduce ≈7.9%. That is a hypothesis from construction, NOT the measurement the
spec asked for; recording it as measured would violate rule 2. **To complete:** display the
Browser pane, let the octree stream at Sol, then run the tile-scan replay (temporary hook) and
record scanned vs passing here.

## Design decisions

- **Required `effectiveExposure`, optional `perceptibilityFloor`.** Positional args 5 and 6.
  Required-not-defaulted so an unmigrated call site fails typecheck instead of silently keeping
  the over-claiming behavior (spec deliverable 1). Floor defaults to `STAR_PERCEPTIBILITY_FLOOR`
  and is imported, never redefined — no pick-only floor (failure mode 1).
- **Gate placement:** after the `dist === 0` guard, before `acos`. It is the cheaper test and it
  must use the loop's camera-relative `dist` (failure mode 2), not `|positionPc|`. The formula is
  not reimplemented — it calls `starIsPerceptible` (the shared oracle).
- **Fail-closed on non-finite `absMag`:** `starIsPerceptible` returns false for non-finite inputs,
  so such a point is skipped rather than claimed. This is the OPPOSITE bias from the tile cull
  (which fails open, because dropping a tile loses pixels) — for a pick, a wrong claim is worse
  than a miss. Stated in a source comment (failure mode 3).
- **Existing-test exposure threading:** all pre-existing calls got Natural = 150 threaded through.
  One exception — the TASK-089 attribute-carrying test uses absMag 7.2 (brightness 0.00185 @150,
  sub-floor), so it runs at Survey = 1000 (0.0124, perceptible). It asserts carried attributes,
  not the gate, so raising its exposure is the honest minimal fix rather than editing the fixture.

## Gate results

- `pnpm --filter @cosmos/web test` — **PASS** (12 files, 87 tests; octree-pick 18/18).
- `pnpm verify` (lint + typecheck + unit test + build) — **PASS** (24/24 tasks).
