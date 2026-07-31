# Research — Did N5 M1 calibration actually exercise the dense Gaia pack?

Status: done (2026-07-31)  
Date started: 2026-07-28  
Machine: Apple M1 (this Mac)  
Related: `docs/research/integrated-gpu-targeting.md` §5.4 (N5 CLOSED 2026-07-27),
`apps/web/public/packs/octree-gaia/` (gitignored dense pack), TEMP hold instrument in
`Flythrough4Probe*.tsx` (uncommitted, from a prior session).

## Questions (falsifiable)

1. **Q1.** Did the recorded N5 run load the dense Gaia pack (~4.7–5.3M), or the committed
   135-star sample?
2. **Q2.** Did N5's measured worst case (`toGalaxy` ~1.11M pts) include streamed Gaia
   geometry, or only the procgen universe cloud?
3. **Q3.** On this M1, with the dense pack loaded and the camera held mid-`toSol` (Gaia
   starfield), does `medium` still clear ≤16 / ≤33 ms GPU — or does the starfield blow the
   N5 verdict?

## Kill / redirect conditions (written before measuring)

- **Kill "N5 covered Gaia perf":** if Q1 = sample, **or** Q2 = procgen-only. Then N5 still
  validates TASK-072's *universe boot* floor, but does **not** calibrate starfield cost —
  the hold measurement (Q3) is required before any Gaia-perf claim.
- **Redirect TASK-072 retune:** if Q3 at `medium` + dense pack exceeds 33 ms GPU p95 while
  work metrics show real streamed points (not an empty/ablated scene). Then the N5 "no
  retune" verdict is incomplete for the shipped dense-pack path.
- **Enable "N5 stands as-is":** only if Q1 = dense pack **and** Q2 included meaningful
  Gaia residency **and** Q3 still clears medium. Unlikely given §5.4's own wording
  ("universe segment … full procgen cloud").

## Claims (minted while investigating)

CLAIM:    Default Gaia manifest without `VITE_GAIA_OCTREE_MANIFEST_URL` is the 135-star sample.
EVIDENCE: `apps/web/src/app/packs.ts:25-26`
VERIFIED: 2026-07-28
RECHECK:  `rg -n "GAIA_OCTREE_MANIFEST_URL" apps/web/src/app/packs.ts`

CLAIM:    Local dense pack on this machine is 5,342,258 points / 1267 tiles (gitignored).
EVIDENCE: `python` sum of `pointCount` over `apps/web/public/packs/octree-gaia/octree.json` tiles; `du -sh` = 181M; `git check-ignore` confirms gitignored.
VERIFIED: 2026-07-28
RECHECK:  `python3 -c "import json;d=json.load(open('apps/web/public/packs/octree-gaia/octree.json'));print(sum(t['pointCount'] for t in d['tiles']), len(d['tiles']))"`

CLAIM:    N5 §5.4 measured `toGalaxy` at ~1,110,105 points — matching the procgen universe cloud size (~1.11M), not Gaia pack size.
EVIDENCE: `docs/research/integrated-gpu-targeting.md` §5.4 table; §6 AMD baseline also ~1,109,970 at procgen opacity 1.
VERIFIED: 2026-07-28
RECHECK:  `rg -n "1,110,105|1,109,970|full procgen" docs/research/integrated-gpu-targeting.md`

CLAIM:    N5 writeup does not record `VITE_GAIA_OCTREE_MANIFEST_URL` or any Gaia residency / streamedPoints work metric beside the GPU numbers.
EVIDENCE: `git show 6a57129 --stat` (docs only); §5.4 body names "full procgen cloud" as the worst case; no env var in commit message.
VERIFIED: 2026-07-28
RECHECK:  `git show 6a57129 --format=fuller --stat`

CLAIM:    Working tree already has TEMP `?tier=` + GPU timer + `?hold=1` starfield-hold instrumentation (uncommitted) aimed at measuring steady-state mid-`toSol` GPU — i.e. the prior session already treated Gaia starfield as the missing measurement.
EVIDENCE: `git diff --stat` on `Flythrough4ProbeApp.tsx` / `Flythrough4Probe.tsx`; `?hold=1` publishes `window.__flythrough4Hold` with `scenePoints` / `streamedPoints` / `gpu`.
VERIFIED: 2026-07-28
RECHECK:  `git diff apps/web/src/scene/Flythrough4Probe.tsx | head -80`

## Measurements

### C — starfield via field star (probe `?hold=1`) — 2026-07-28

Protocol: `?debug=flythrough4&hold=1&tier=medium` with
`VITE_GAIA_OCTREE_MANIFEST_URL=/packs/octree-gaia/octree.json` (5.34M pack). Probe flies
universe→galaxy, then to the first HYG star 5–60 pc from Sol that is **not** near a
system host (`hyg:2` @ 47.96 pc). No mid-flight freeze — measures after goTo arrival +
streaming settle.

```
CLAIM:    At medium tier on M1 Metal, steady-state GPU at a non-system field star with the
          dense Gaia pack loaded is ~0.2 ms p50 / 0.23 ms p95 (max 1.6 ms) — clears ≤16/≤33.
EVIDENCE: tools/n5-calib-recheck/results/2026-07-28T04-27-19-511Z_dense53m_medium_fieldstar.json
          context=galaxy, camPc=47.96, streamedPoints=1_008_192, loadedChunks=1268,
          coverage=1, procgenOpacity=0, gpu={n:149,p50:0.2,p95:0.229,max:1.615}
VERIFIED: 2026-07-28
RECHECK:  PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright \
          N5_BASE_URL=http://localhost:5174 N5_TIER=medium N5_PACK_LABEL=dense53m \
          node tools/n5-calib-recheck/run.mjs
```

```
CLAIM:    N5 §5.4 (universe toGalaxy) did NOT exercise this path — its ~1.11M pts were the
          procgen cloud; starfield GPU with dense Gaia was unmeasured until this run.
EVIDENCE: integrated-gpu-targeting.md §5.4 table (toGalaxy points ≈1.11M = procgen baseline);
          this run's streamedPoints=1.008M at camPc≈48 with coverage=1 / procgen=0.
VERIFIED: 2026-07-28
RECHECK:  compare §5.4 toGalaxy points vs this result's streamedPoints + camPc
```

## What I looked for and didn't find

- No N5 NOTES file recording which Gaia URL was baked into the build.
- No prior `__flythrough4Hold` / field-star results under `docs/`.
- No evidence in §5.4 that streamed Gaia points were part of the 1.11M `toGalaxy` figure.

### D — starfield full-frame sweep (harness, all tiers) — 2026-07-31

Protocol: `tools/n5-calib-recheck/run.mjs` (headed Chromium, `--use-angle=metal`, viewport
1440×900 @ dpr 2 **set at launch, never resized**), `?debug=flythrough4&hold=1&tier={high|
medium|low}` against the dense-pack server (:5174). The reconstructed hold instrument flies
universe→galaxy, then issues its own `goTo` toward Sol but STOPS 2.4 pc short (`arrivalDistanceM
= 2.4 × 3.086e16`) — deep in the local star field, galaxy context, well outside the
galaxy→system boundary (~0.016 pc), so it never enters the solar system. Settles until
`inFlight===0`, then measures 150 frames. Screenshots saved alongside each JSON.

```
CLAIM:    Parked in the dense starfield (2.4 pc from Sol, galaxy ctx, all 1268 tiles resident,
          procgen faded), the REAL Gaia+HYG stars are cheap on M1 Metal at every tier:
          high 894,849 pts → 1.46/1.58/2.14 ms; medium/low 8,763 pts → <0.9 ms p95.
EVIDENCE: results/2026-07-31T05-22-35-132Z_dense53m_high_fieldstar.{json,png} (scenePoints
          894849, gpu p50 1.461/p95 1.578/max 2.141, buffer 2880×1800, coverage 1, procgen 0);
          medium/low JSONs same stamp family (scenePoints 8763, p95 0.887 / 0.183).
VERIFIED: 2026-07-31
RECHECK:  PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright \
          N5_BASE_URL=http://localhost:5174 N5_TIER=high N5_PACK_LABEL=dense53m \
          node tools/n5-calib-recheck/run.mjs   # then inspect the .png fills the frame
```

```
CLAIM:    The app's GPU cost is the PROCGEN universe cloud, not the streamed Gaia stars. Parked
          starfield (895k real pts) is ~20–30× cheaper than the toGalaxy procgen worst case.
EVIDENCE: §5.5(b) high starfield p95 1.58 ms vs §5.5(a) high toGalaxy p95 48.4 ms (1.37M pts,
          procgen opacity 1); procgenOpacity=0 at the starfield hold.
VERIFIED: 2026-07-31
RECHECK:  compare high starfield p95 vs high toGalaxy p95 in integrated-gpu-targeting.md §5.5
```

```
CLAIM:    Measuring via the in-app browser pane is unreliable: resizing the pane AFTER the R3F
          app mounts leaves the renderer sized for the old pane, so gl.render fills only a
          top-left corner (GL_VIEWPORT reads full, but the manual render viewport is stale),
          under-counting fill. The harness (viewport fixed at launch) renders full-frame.
EVIDENCE: in-pane hold screenshot = stars only in top-left ~27%; canvas rect/buffer/GL_VIEWPORT
          all consistent at 1440×900 / 2880×1800 yet only the corner drew. Harness screenshot
          (same params, fixed viewport) fills the whole frame.
VERIFIED: 2026-07-31
RECHECK:  compare an in-pane post-resize screenshot to results/*_high_fieldstar.png
```

## Verdict

**Reframe → now measured.** N5 is **valid and reinforced**, on the dense pack:

1. **Universe boot floor (TASK-072):** unchanged — `high` blows the budget (procgen `toGalaxy`
   p95 48 ms on the dense pack), `medium` clears. The original §5.4 verdict stands.
2. **Starfield / Gaia cost (the previously-missing claim):** now measured full-frame at all
   tiers — the real Gaia starfield is **cheap** (`high` ~895k pts @ 1.58 ms p95; `medium`/`low`
   <0.9 ms). No retune signal from the starfield at any tier.
3. **Why:** the app's GPU cost is the **procgen universe cloud**, not the streamed stars;
   §5.4's ~1.11M "worst case" was procgen. `medium`/`low` are **pack-independent** (point cap).
4. **Methodology fix:** the trustworthy path is the fixed-viewport harness, not the resized
   in-app pane (which crops the render). Recorded so the next recheck doesn't relearn it.

**Kill/enable resolution:** the "N5 covered Gaia perf" kill *did* fire (Q1 = sample, Q2 =
procgen-only), so N5 as written didn't calibrate starfield cost — but the follow-up measurement
(D) now supplies it and it clears `medium`, so the **"no retune" verdict holds** for the dense
pack. Folded into `integrated-gpu-targeting.md` §5.5.
