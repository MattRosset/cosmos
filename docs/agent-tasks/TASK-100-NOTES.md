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

## Settled-Sol pass-rate measurement (step 6) — MEASURED, reproduces Claim 5 exactly

Setup: `.env.local` → full pack (`/packs/octree-gaia/octree.json`, ~3M pts / 1268 tiles); dev
server on :5173; galaxy context at Sol (`local ≈ [0,0,0.06]`, `unitsToPc=1`), slider exposure 25
→ effective octree exposure **150** (`effectiveStarExposure(NATURAL,'galaxy-octree',25)`). Octree
fully streamed: `loadedChunks: 1268`, `renderedPoints: 1,770,736`, `catalogCoverage: 1`.

The browser pane had to be **displayed** first — while hidden the page never composites, rAF never
fires, and streaming stays at 0 (the idle→hidden throttle, memory `preview-tab-idle-hidden`). No
committed read seam exists for the visible tiles, so the scan was replayed by importing the live ES
module singleton from the console (`import('/src/glue/octree-pick-feed.ts').octreePickHolder` — the
same instance GalaxyScene writes), applying the SAME `starIsPerceptible` at the same effective
exposure and the loop's camera-relative `dist`. Nothing was committed for this.

Result at settled Sol, over the 25 tiles that survive both draw-time culls:

```
scanned = 233795   passed = 18476   passPct = 7.90%
```

**Identical to Claim 5** (18,476 / 233,795 = 7.90%, verified 2026-08-05). The wired gate and the
research oracle agree to the point — neither path drifted.

## Verification beyond the gate (live, full pack at settled Sol)

1. **Live invariant — a claimed star is a drawn star.** 64×36 = 2304-pixel `__cosmos.pickAt`
   sweep: 37 pixels returned a `gaia:*` id; **all 37 perceptible, 0 invisible claimed** (recomputed
   the gate for each returned catalogId). gate map size 213,954.
2. **Decisive A/B on the production function over production data.** Aimed a ray straight at an
   invisible Gaia star (catalogId 395025, absMag −2.81, 5680 pc, on-axis angle 0):
   - `pickNearestGaia(..., effExposure=1e9)` (pre-gate behavior) → claims **395025** at angle 0 —
     the invisible on-axis star. This is the exact defect.
   - `pickNearestGaia(..., effExposure=150)` (Natural, shipped) → **refuses 395025** and returns a
     different star, catalogId 103445 (absMag 1.2, angle 0.008), which is perceptible.
3. **Manual click (real pointer events at exact CSS px).** Clicking Sol selected `hyg:0`; clicking
   a Gaia pixel selected `gaia:2362083445587361152` (the D4 source_id upgrade of provisional
   catalogId 331431) and the breadcrumb resolved to **"Gaia DR3"** — a drawn Gaia star still
   selects. Clicks on faint-looking sky selected hyg stars or nothing, never an invisible Gaia.
   (Near-Sol Gaia octree stars are sparse faint background points intermixed with HYG, so no Gaia
   pixel has a robust ±3px neighborhood — manual pixel-clicking is jitter-sensitive by nature, not
   because of the fix; screenshot→CSS scale is ×1.6, canvas 1280×720.)

`pnpm test:e2e` — not re-run this session (no e2e-spec or app-behavior change beyond the unit-gated
pick; only the documented `flythrough4` near-Sol cap may remain known-red per memory).

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
