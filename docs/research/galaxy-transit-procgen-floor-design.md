# Design: galaxy transit visibility — procgen floor (B+E) + expected-behavior contract

**Status:** design agreed in principle (approach **B+E**), **not yet implemented**. This
doc is a self-contained handoff so a fresh session can prototype + measure + ship it.
**Prereqs already on `main`:** `df3e77c` (procgen faded by distance during flight) and
`1073dbf` (Gaia octree kept visible during flight). Those fixed two earlier layers; the
issue below is what remains.
**Companion:** `docs/research/goto-galaxy-transit-black.md` (the measurement trail).

---

## 1. The problem (3 sub-problems)

Flying the breadcrumbs (◂ Milky Way / ◂ Galaxy) or to a star, the transit looks broken.
Confirmed by measurement + a user screen recording (frames extracted with ffmpeg):

- **P1 — Empty band.** Between where the real catalog stops filling the view (~hundreds of
  pc from Sol — it is a compact, sub-pixel-from-afar cluster) and where the procgen cloud
  turns on today (`GAL_FADE_LO_PC = 18_000`), nothing renders → black mid-transit.
- **P2 — Stars/nebulas asymmetry.** Where procgen is partly on (the 18–45 kpc band), the
  star **cloud** is draw-capped (`GAL_FLIGHT_DRAW_MAX = 0.2`) and faint, while the nebula
  **sprites** (HII / dust) render at full opacity. Result, captured on video: 3 colored
  nebula blobs (green/blue/magenta) floating in black with **no stars**.
- **P3 — Snap at the ends.** Content appears/disappears abruptly at arrival/departure (a
  hard phase change), reads as "paints all at once".

### Evidence (already gathered, reproducible)
- Per-frame canvas **luminance probe** (a small 2D-canvas `drawImage` of the WebGL canvas;
  reads real pixels, unlike the ≤4 Hz `__cosmos` mirror). Descent Milky Way→Sol: max luma
  3/255, 0 visible px for the whole flight; pops to 255 at arrival.
- Streaming stats CONSTANT through the descent (`cut=9`, `draws=9`, `pts≈1.1M`, octree
  tile `opacity=1`) → **not streaming, not mounts, not the octree-hide**. The gate is
  content/representation, correlated with distance and `goToActive` phase.
- Video frame at mid-band, brightness-boosted: only the 3 nebula sprites, zero stars (P2).

---

## 2. Why it regressed (root history)

| Commit | What | Effect |
|---|---|---|
| `5a41bcb` (M3) | `GAL_PROCGEN_FLOOR = 0.5`; `procgenBlend = 0.5 + 0.5·smoothstep(18k,45k,dist)` | procgen **never below 0.5** → during flight the 0.2 draw-cap rendered a visible sparse star spiral the WHOLE trip (incl. near Sol). **This is the "it worked in M3 with 0.2" the user remembers — the 0.2 worked because of the floor.** |
| `3a646d8` | **Removed the floor**: `procgenBlend = min(coverageFade, distanceFade)` | Legit reason: parked near Sol, the 1M-point procgen cloud overdrew the real Gaia catalog (redundant + additive-overdraw perf). But it made procgen → 0 below 18 kpc → **emptied the transit**. The commit explicitly: "The retired M3 `GAL_PROCGEN_FLOOR` floor is NOT restored." |
| `df3e77c` (this work) | `procgenBlend = distanceFade` (dropped the in-flight coverage clamp) | Floorless still → 0 below 18 kpc. Made the upper band fade in (good) but left P1/P2. |

So: removing the floor fixed near-Sol redundancy and **broke the transit**, with no test to
catch it. That is exactly what the expected-behavior contract (§5) must prevent.

---

## 3. Constraints any fix must respect

- **R1** — Parked near Sol: no redundant procgen overdraw on the real catalog (`3a646d8`).
- **R2** — Far vantage: full spiral visible (`77db8ed`).
- **R3** — Flight perf: don't draw 1M additive points every frame. Real gate is
  `e2e/breadcrumb-perf.spec` (rAF timing). NOTE: `flythrough4` does **not** use `goToActive`
  (its probe replays the path directly), so the §5.4 budget gate is unaffected by
  flight-only behavior.
- **R4** — The real catalog IS the content when visible; procgen is filler, not a duplicate
  (M4a tier-unification intent).

---

## 4. Options considered

- **A — Flight-only floor** (restore M3 floor but only while `goToActive`). Works, but:
  arrival snap (needs a ramp), couples to flight state, and **overlays the procgen spiral on
  short local hops** (e.g. goto a star at 150 pc) where you want only the real local field.
- **B — Lower `GAL_FADE_LO_PC`** so procgen fades in down at ~where the real catalog stops
  filling (~hundreds of pc), closing the gap with NO flight special-casing. ← recommended
- **C — Low global floor (~0.15) everywhere.** Simple but reintroduces R1 overdraw at rest.
- **D — Make the real catalog visible from afar** (min point size / coarse-tile glow). Root
  fix but big (Phase-4 tier-unification debt); real field may never read as a galaxy.
- **E — Couple stars↔nebulas** so they share effective visibility. Orthogonal; fixes P2.
- **F — Reshape flight easing** to spend less time in the dead band. Shortens, doesn't fix.

---

## 5. Recommended approach: **B + E**

### B — extend the procgen fade-in downward
- Today: `distanceFade = smoothstep(GAL_FADE_LO_PC=18_000, GAL_FADE_HI_PC=45_000, dist)`
  (`apps/web/src/scene/GalaxyScene.tsx:93-94`, used at `:431-432`).
- Change: lower `GAL_FADE_LO_PC` to ~where the real catalog hands off (candidate 500–1500 pc;
  **must be measured**, see §7). Procgen then ramps on right where the real field fades out →
  no empty band, parked or flying.
- Respects R1 (below the new LO, still 0 near Sol → no overdraw on the dense catalog), R2
  (HI unchanged → full spiral at vantage), no P3 snap (no flight coupling), R4 (procgen only
  fills where the real field can't).

### E — couple stars and nebulas
- In `makeProcgenMount.applyFrame` (`GalaxyScene.tsx:212-227`): the cloud gets
  `setDrawFraction(drawFraction)` AND opacity; the dust/HII sprites get only opacity. Make
  them share one visibility so you never get nebulas-without-stars. Simplest: drive both off
  the same factor, or apply the draw-cap intent to the whole procgen layer, not just the
  cloud. Decide whether to keep ANY in-flight cloud draw-cap (`GAL_FLIGHT_DRAW_MAX`) — if
  kept, nebulas must be capped to match; if dropped, measure perf (R3).

### Open decisions (the user picks — they shape B/E)
1. Show the procgen galaxy when **parked at mid-distance** (5–10 kpc), or only in motion?
   B = yes when parked too (consistent). If "only in flight" is wanted, that argues for A.
2. On a goto to a **local star** (~150 pc), show the background spiral or only the real local
   field? If "only local", the procgen-on threshold must sit ABOVE local-hop distances
   (i.e., `GAL_FADE_LO` not too low) — this directly sets the B tuning floor.

### Risks to verify
- Crossover zone (real + procgen both visible) must read as a continuous hand-off, not a
  double image. Verify with screenshots across the band.
- If `GAL_FADE_LO` too low → overdraw/redundancy creeps toward Sol (R1). Too high → residual
  gap. The measured hand-off distance (§7) sets it.

---

## 6. Expected-behavior contract (DOCUMENT THIS — the anti-regression goal)

Once shipped, record this as the procgen-visibility contract (here + a code comment):

| Camera phase | Real catalog | Procgen cloud + nebulas | Rationale |
|---|---|---|---|
| Parked, near Sol (< ~hundreds pc) | owns the view | **off** (0) | R1, R4 |
| Parked/moving, mid (band LO→HI) | sub-pixel | **ramps on, stars+nebulas together** | fills P1, P2 |
| Parked, far vantage (≥ HI) | gone | **full spiral** | R2 |
| In flight, any distance | per above | **same as parked at that distance** (no extra suppression that empties the view) | P1/P3 |
| Always | — | **stars and nebulas visible together** (never sprites alone) | P2 |

---

## 7. How to resume (prototype + measure)

1. **Measure the hand-off distance** for B: from Sol, sample where the real catalog
   (HYG+octree) stops filling the view (luma > threshold). Fly out slowly / sample at fixed
   distances. That distance ≈ the new `GAL_FADE_LO_PC`.
2. Apply B (+E) on a branch. Verify with the **per-frame luminance probe**: a mid-breadcrumb
   frame must NOT be black (max luma > threshold) AND nebulas-without-stars must not occur.
3. Perf: `breadcrumb-perf.spec` rAF timing + the `?debug=breadcrumb-profile` span profiler
   (`galaxy.render`) must stay within budget (R3).
4. `pnpm verify` (lint+type+test+build); leave Playwright e2e to CI.

### Code map
- `apps/web/src/scene/GalaxyScene.tsx`: `GAL_FADE_LO_PC`/`GAL_FADE_HI_PC` (:93-94),
  `GAL_FLIGHT_DRAW_MAX` (:96), `procgenBlend` logic (:424-440), `makeProcgenMount.applyFrame`
  cloud vs sprite opacity/draw (:204-243).
- M3 reference: `git show 5a41bcb:apps/web/src/scene/GalaxyScene.tsx` (the `GAL_PROCGEN_FLOOR`
  version).

### Measurement tooling notes
- Luminance probe + rAF-pump pattern (the preview tab throttles rAF when idle — pump inside
  an awaited eval to drive+measure). See `goto-galaxy-transit-black.md`.
- ffmpeg is installed (winget Gyan.FFmpeg) for extracting/boosting video frames:
  `ffmpeg -ss T -i video.mp4 -frames:v 1 -vf "crop=...,eq=brightness=..:saturation=.." out.jpg`.

### Regression invariant to add (CI)
"During a breadcrumb flight, no mid-transit frame is black (sampled luminance above a floor),
and procgen star-cloud visibility is coupled to nebula-sprite visibility." This is the test
whose absence let `3a646d8` silently break the transit.
