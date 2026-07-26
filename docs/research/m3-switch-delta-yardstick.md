# Root-cause — why `M3 boundary switches are invisible` went red on the TASK-081 branch

**Date:** 2026-07-26
**Symptom as reported:** CI red on `e2e/tests/m3.spec.ts:181`, one assertion:
`galaxy→system switch invisible: 4.919 ≤ 4.625`.

**Verdict up front, in three parts:**

1. **TASK-081 did not make the switch worse.** The numerator moved +4.7 %; the gate flipped
   because the **denominator collapsed 84 %**. `maxFlightDelta` on `main` was held up by a
   single 28-unit outlier in the *universe* leg — a whole-screen flash that was itself the
   unit bug TASK-081 fixed. Removing it is the fix working, not a regression.
2. **The galaxy→system crossing was genuinely visible — and still is on `main`.** `enterSys`
   ≈ 4.2–4.9 against a flight median of ~0.6–1.3 measures a real discontinuity, present in
   *both* branches, that the gate could not see while the outlier propped up the bar.
3. **The visible thing is none of the three suspects.** Not the monolith gate, not the star
   field, not the far-plane clip. It is `SystemScene` drawn ~206,265× oversized in galaxy
   context — an artifact **only the M3 probe app can produce**, because it kept the system
   mounted in every context while the shipped app mounts it only in `system`.

---

## How this was measured

Local Playwright, chromium project (`--use-angle=swiftshader`, viewport 1280×720) — the same
renderer and viewport CI uses, so the numbers are comparable to the CI log. The M3 probe was
temporarily instrumented (uncommitted; reverted before the fix commit) with:

- `window.__m3Trace` — per frame: mean-abs sample delta, `contextId`, phase,
  `gl.info.render.{calls,points,triangles}`, `camera.{near,far}`.
- a full-resolution (1280×720) **blob census** — 4-connected components above luma 10/40/120
  — captured on the frame either side of each switch. The probe's own 160×90 sample cannot
  see a faint star (an 8×8 box average turns a lone 255 px into ~4), so every "the field
  vanished" statement below rests on the full-res census, not on the sample.
- full-resolution PNGs of both switch frames and their predecessors.
- a **CPU (float64) replica of the star vertex shader**, fed the live uniforms and the live
  camera matrices, counting on-screen / bright / z-clipped stars per frame.

---

## CLAIM 1 — The 28-unit "flight" frame on `main` was a universe-leg flash, not flight motion

```
CLAIM:    maxFlightDelta on main is set by isolated whole-screen flashes early in the
          UNIVERSE leg, with draw calls and point counts unchanged across them — the
          signature of a shader-side brightness/position pop, not of camera motion.
          On the TASK-081 branch those frames are gone and the universe leg is smooth.
EVIDENCE: MEASURED, local trace of `main` @ e8bd2f7-equivalent (run: 795 frames):
            f=1   d=10.169  ctx=universe  calls=38  pts=1114066
            f=29  d=29.313  ctx=universe  calls=45  pts=1219369   <- the yardstick
            f=57  d=21.672  ctx=universe  calls=45  pts=1219369
          Whole-run distribution, by context:
            main   universe: n=128 median=0.644 p90=1.969 max=29.313
            branch universe: n=95  median=0.699 p90=1.094 max=1.344
          The galaxy leg is unchanged in character (main max 3.767, branch max 3.091).
          CI agrees: main flight(median=1.286 max=28.169) vs branch (median=1.309 max=4.637)
          — same median, the max is what disappeared.
VERIFIED: 2026-07-26
RECHECK:  Instrument M3DescentProbe with a per-frame trace; on main, locate the frames with
          delta > 10 and confirm ctx=universe and constant gl.info.render.{calls,points}.
```

## CLAIM 2 — `enterSys` ≈ 4.2–4.9 is PRE-EXISTING; the branch did not create it

```
CLAIM:    The galaxy→system switch-frame delta is the same size on main and on the branch;
          it is not a TASK-081 effect. What TASK-081 changed at that frame is the target
          star: on main the whole frame only darkened; on the branch the Sol sprite lights
          up (the fix), while the rest of the change is unchanged.
EVIDENCE: MEASURED, switch-frame pixel census (160×90 sample, 14,400 px):
            main   f=431  delta=4.412  darker=1060 px  brighter=   0 px
            branch f=415  delta=4.477  darker=1087 px  brighter=  20 px
          The 20 "brighter" pixels are the screen centre: (80,45) 66 -> 255, i.e. Sol,
          which TASK-081 stopped extinguishing. CI numbers agree (main 4.681, branch 4.901).
          Run-to-run spread on this quantity is ~±0.3 across 6 local runs.
VERIFIED: 2026-07-26
RECHECK:  Run the trace on both branches; compare enterSystemDelta and the darker/brighter
          split of the switch frame.
```

## CLAIM 3 — It is NOT the monolith gate (suspect 1)

```
CLAIM:    StarScene's ADR-006 §5.2 monolith gate cannot fire in ?debug=m3 at all: it is
          wrapped in `if (streaming !== undefined)` and M3App mounts StarScene WITHOUT the
          streaming prop. The context-dependent branch never executes in this probe.
EVIDENCE: READ FROM SOURCE. apps/web/src/scene/StarScene.tsx:166 gates the whole block;
          apps/web/src/app/M3App.tsx mounts <StarScene stars combined origin controllerRef />
          with no `streaming`. (StarScene.tsx:81 documents exactly this: "Absent
          (M2/ctxswitch/M3 debug paths) => monolith always drawn".)
VERIFIED: 2026-07-26
RECHECK:  grep -n "streaming" apps/web/src/app/M3App.tsx  # StarScene mount has no such prop
```

## CLAIM 4 — It is NOT the far-plane clip (suspect 3), and the star field is not what changes

```
CLAIM:    Widening the camera far plane by 1e6 (so that no star can be far-clipped in system
          context) changes neither the switch delta nor the number of drawn stars. The
          F7 clip is real but it is NOT what makes the boundary visible.
EVIDENCE: MEASURED, A/B on the branch, with the knob verified in the running app (the trace
          records camera.far per frame, so the build is proven to carry the change):
            CAMERA_FAR_PC=1e6   enterSys=4.753 / 4.477   (2 runs)
            CAMERA_FAR_PC=1e12  enterSys=4.782 / 4.475   (2 runs, camera.far=1e12 in trace)
          Full-res blob census at the switch, far=1e12:
            before blobs@40=233  px@40=62860   after blobs@40=16  px@40=1740
          i.e. the field still collapses with the far plane effectively removed.
          Independently, the CPU float64 replica of the star vertex shader, fed the live
          uniforms + camera matrices, reports the star field UNCHANGED across the flip:
            before  onScreen=722  brightOnScreen=201  clippedZ=0  (of 6838 sampled)
            after   onScreen=722  brightOnScreen=201  clippedZ=0
          The star field is geometrically and photometrically continuous across the switch,
          which is precisely what TASK-081 set out to achieve.
VERIFIED: 2026-07-26
RECHECK:  Set CAMERA_FAR_PC=1e12 in StarScene, rebuild, confirm camera.far in the probe
          trace, and re-read enterSystemDelta. It must not move outside the ±0.3 spread.
```

## CLAIM 5 — It IS SystemScene, drawn ~206,265× oversized in galaxy context

```
CLAIM:    On the frame before the switch the probe renders the Sun as a textured sphere
          ~11 degrees wide plus its orbit rings; on the switch frame those disappear and
          the Sun becomes a point sprite. That transition IS the measured delta.
          Cause: SystemScene's meshes and orbit polylines are sized in SYSTEM units (AU)
          — createPlanetMesh({contextUnitMeters: AU_METERS}) -> sphereMesh.scale — while
          their render offsets come from origin.toRenderSpace, which returns ACTIVE-context
          units. In galaxy context the offsets are parsecs and the geometry is still AU,
          so every body is drawn CONTEXT_UNIT_METERS.galaxy / .system = 206,266× too large.
          Arithmetic: Sol's radius 6.957e5 km = 4.65e-3 AU; read as parsecs that is 959 AU,
          seen from the 5,000 AU arrival distance => angular radius atan(959/5000) = 10.9deg.
EVIDENCE: MEASURED + SEEN. Full-resolution PNGs of the two frames either side of the
          galaxy->system switch: before = textured sphere filling the centre + 4 orbit
          ellipses; after = a single ~40 px Sol sprite on an empty field.
          Draw-call attribution: gl.info.render.calls in galaxy context drops 37 -> 7 when
          SystemScene is not mounted, with gl.info.render.points unchanged (204,066) — the
          30 missing calls are the system's meshes, rings and orbit lines.
          Top-contributing pixels of the switch frame land exactly on the sphere:
            (75,43) 240->3  (72,43) 231->3  (92,40) 231->3   [160x90 sample coords]
          and 50 % of the total |delta| is in the innermost radial fifth of the frame.
VERIFIED: 2026-07-26
RECHECK:  Capture canvas.toDataURL on the switch frame and its predecessor in ?debug=m3
          and look at them; or count gl.info.render.calls with and without SystemScene.
```

## CLAIM 6 — The shipped app never renders that frame; only the probe app does

```
CLAIM:    StarApp (production) mounts SystemScene ONLY while contextId === 'system'.
          M3App used `mountedSystemId ?? M3_SOL_SYSTEM_ID`, so the probe kept the system
          mounted in universe and galaxy context too — a composition the user cannot reach.
          The M3 gate was therefore measuring the probe, not the shipped pipeline it
          claims to measure ("drives the REAL nav controller through the SHIPPED pipeline").
EVIDENCE: READ FROM SOURCE.
            apps/web/src/app/StarApp.tsx:552-558  mountedSystemId === null => null
            apps/web/src/app/StarApp.tsx:218      set to e.anchorId only when e.to === 'system'
            apps/web/src/app/M3App.tsx (before)   const id = mountedSystemId ?? M3_SOL_SYSTEM_ID
VERIFIED: 2026-07-26
RECHECK:  grep -n "mountedSystem = useMemo" -A4 apps/web/src/app/{StarApp,M3App}.tsx
```

## CLAIM 7 — Aligning the probe with production removes the measured symptom

```
CLAIM:    With SystemScene mounted under the production rule, both boundaries become
          invisible by the gate's own yardstick, and the new yardstick frame is ordinary
          motion rather than an outlier.
EVIDENCE: MEASURED, full m3 spec, chromium/SwiftShader, workers=1:
            before fix  enterGal=2.640  enterSys=4.753  flight(median=0.688 max=3.091)
            after  fix  enterGal=0.419  enterSys=0.001  flight(median=0.125 max=2.767)
          maxFlightDelta is now the peak of a smooth ~20-frame ramp at the start of the
          galaxy->Sol dive (2.44 -> 3.03 -> 0.96 over f=98..118), i.e. the fastest ordinary
          flight motion in the run — not a one-frame spike.
          `enterSys = 0.001` is the switch frame being pixel-identical to its predecessor:
          at the 5,000 AU arrival the correctly-scaled system is sub-pixel, so mounting it
          adds nothing visible. The system's content appears as it is approached, inside
          ordinary flight frames (system-context median 0.267, max 1.540 — no spike).
          Both m3 screenshot baselines (m3-galaxy, m3-system) passed UNMODIFIED — no
          re-record was needed. The galaxy keyframe is taken 32 kpc out, where the
          oversized system was still sub-pixel, so the baseline never contained it.
VERIFIED: 2026-07-26 — `playwright test m3.spec.ts --project=chromium --workers=1
          --grep-invert=@perf` => 4 passed.
RECHECK:  Re-run that command; enterSys must stay far below maxFlightDelta.
```

---

## Mechanism, in one sentence

`SystemScene` renders its bodies at system-unit scale in every context, so while the M3 probe
kept it mounted outside `system` the descent showed a 206,265×-oversized Sun that snapped to
its true size at the boundary; that snap was the switch-frame delta all along, and it only
became a red gate once TASK-081 removed the universe-leg unit flash that had been holding
`maxFlightDelta` at 28.

## Consequences

1. **Fixed here:** `M3App` now mounts `SystemScene` under the production rule. This is the
   whole diff — no threshold, assertion, comparator or renderer was touched.
2. **Filed, not fixed:** the underlying `SystemScene` unit-contract bug (**TASK-084**). It is
   latent in the shipped app today only because production never mounts the system outside
   `system` context; the moment anything does (a preview of a system from galaxy scale, a
   cross-context tour), it draws a 206,265×-oversized planet. It is the same class of bug as
   TASK-081/082/083 and belongs to that lane.
3. **Still open, unchanged by this work:** the other probe apps (`M4aApp`,
   `StreamingProbeApp`, `Soak4ProbeApp`, `Flythrough4ProbeApp`) carry the same
   `?? M3_SOL_SYSTEM_ID` fallback. They were deliberately left alone: `flythrough4.spec.ts`
   gates recorded draw-call/point baselines against `flythrough4-m3-baseline.json`, and
   changing what those apps mount would move those baselines. Noted in TASK-084.
4. **Observation about the gate itself, deliberately NOT acted on here.** The comparator is
   `enterSystemDelta ≤ maxFlightDelta` — a yardstick defined by **one frame out of ~700**,
   the least representative sample there is of the "ordinary flight motion" the assertion
   names. Three consequences, all three observed in this investigation:

   - **A bug anywhere else loosens the gate.** On `main` the bar was 28.169 — a universe-leg
     flash that was itself a unit bug. While it existed, any switch under 28 passed, which is
     how a real 4.9-against-1.3 discontinuity (3.7×) stayed green for this gate's whole life.
   - **Fixing the product tightens the gate.** That is what turned it red here: TASK-081 moved
     the numerator +4.7 % and the denominator −84 %. A gate that gets stricter as a *side
     effect* of an unrelated improvement is coupling two quantities that have no reason to be
     related.
   - **The bar can come from a different leg of the flight.** The max may be a universe-leg
     frame while the assertion judges the galaxy→system crossing — different scale, different
     speed, different content.

   Post-fix the same long tail is still there in the galaxy leg: **median 0.035, p90 0.206,
   max 3.029** — the max is 14.7× the p90 and 86× the median.

   **What is NOT claimed:** run-to-run *variance* of `maxFlightDelta` was not measured. Across
   6 local runs it was in fact fairly stable (post-fix 2.77–3.09, one 3.82; `main` 29.3 local
   vs 28.2 on CI). The fragility demonstrated here is **coupling**, not instability — the bar
   inherits any anomaly in the rest of the scene. Do not cite this section as evidence of
   flakiness.

   A percentile comparator (p99 of the flight deltas, or a multiple of p90) would be more
   honest, but it needs **calibration**, not a swap: which percentile, which multiple, and a
   demonstration that the gate still fails on a real regression — a comparator loosened past
   the defect it exists to catch is worse than a fragile one. And changing it inside the PR
   whose job is to turn it green is exactly the move that must not be made silently: it needs
   its own reasoning, its own measurement, and its own commit, made when the gate is *already*
   green so it is visible that the change is not what saved it.

## Two false greens this investigation hit (both cost real time)

- **A failed build served a stale bundle.** `pnpm --filter @cosmos/web build` runs
  `tsc --noEmit && vite build`; a type error in the instrumentation aborted it, the previous
  `dist/` stayed on disk, and `vite preview` happily served it — so an A/B "measured" the
  same binary twice. Caught by grepping the built bundle for the instrumentation string.
  **Rule that follows:** grep the artifact (or assert the knob's value from inside the app)
  before believing an A/B. Every far-plane number in CLAIM 4 is backed by `camera.far` read
  out of the running app for that run.
- **A layer-attribution A/B that changed two things.** Running with `hide=stars` dropped
  `enterSys` to 0.606 and looked like proof that the star field was responsible. It is not:
  `StarScene` also owns `camera.near/far` (StarScene.tsx:137-141), so hiding it left the
  scene on R3F's default clip planes — a different scene, not the same scene minus stars.
  The conclusion that survived was reached by looking at the frames instead.
