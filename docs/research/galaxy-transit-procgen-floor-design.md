# Design: galaxy transit visibility — procgen floor (B+E) + expected-behavior contract

**Status:** **IMPLEMENTED (2026-06-27)** — approach **B+E** shipped in `GalaxyScene.tsx`
and re-measured (§10). The prototype-and-measure step (§8) plus the implementation are
both done; the §6 contract is now also a code comment at the `procgenBlend` site.
**Prereqs already on `main`:** `df3e77c` (procgen faded by distance during flight) and
`1073dbf` (Gaia octree kept visible during flight). Those fixed two earlier layers; the
issue below is what remains.
**Companion:** `docs/research/goto-galaxy-transit-black.md` (the measurement trail).

---

## 1. The problem (3 sub-problems)

Flying the breadcrumbs (◂ Milky Way / ◂ Galaxy) or to a star, the transit looks broken.
Confirmed by measurement + a user screen recording (frames extracted with ffmpeg):

- **P1 — Empty band.** Between where the real catalog stops filling the view (**measured ≈
  1.5–2.5 kpc**, §8 — it is a compact, sub-pixel-from-afar cluster) and where the procgen cloud
  turns on today (`GAL_FADE_LO_PC = 18_000`), nothing renders → **black across ~2–21 kpc**
  (measured, §8) mid-transit.
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
- Change: lower `GAL_FADE_LO_PC` to **~1500–2000 pc** (MEASURED hand-off ≈ 1.5–2.5 kpc, §8 —
  NOT the "hundreds of pc" originally assumed; LO=18 kpc is ~7–10× too far out). Procgen then
  ramps on right where the real field fades out → no empty band, parked or flying.
- **Density caveat (measured, §8):** the smoothstep is gentle over a wide span, so a naïve
  worry is "low blend = still black." The data refutes it: the cloud is a dense 1M-point
  field, so even `distanceFade≈0.056` renders 65 visible px (6× the real catalog's best). A
  plain LO drop likely fills the band. BUT at LO=2000 the blend at 5 kpc is only ~1% (borderline).
  Two safe choices: (a) set **LO≈1500** so the whole 2–18 kpc band stays ≥ a few % (recommended),
  or (b) keep LO=2000 and, only if the §9 re-measure shows a faint 4–7 kpc sub-band, switch the
  ramp to a steeper/two-segment curve. Prefer (a); it is one constant.
- Respects R1 (below the new LO, still 0 near Sol → no overdraw on the dense catalog: at 1.5 kpc
  the real field is already visPx ≤1, so the crossover is not a double image), R2 (HI unchanged →
  full spiral at vantage), no P3 snap (no flight coupling), R4 (procgen only fills where the real
  field can't).

### E — couple stars and nebulas
- In `makeProcgenMount.applyFrame` (`GalaxyScene.tsx:212-227`): the cloud gets
  `setDrawFraction(drawFraction)` AND opacity; the dust/HII sprites get only opacity. Make
  them share one visibility so you never get nebulas-without-stars. Make it **structural**
  (one procgen-layer visibility factor that drives cloud + lanes + hii + impostor), not
  "remember to cap the nebulas too" — that asymmetry is exactly how P2 was born.
- **DROP `GAL_FLIGHT_DRAW_MAX` (data-backed, §8).** Measurement decided the open question: the
  in-flight cloud draw-cap is the *sole* cause of P2 and protects **no measured budget**. The
  resting 48 kpc vantage already draws the full 1M-point cloud continuously (`distanceFade=1`,
  no cap) — that is the user's idle state — so full-draw in the 26–45 kpc band *during flight*
  introduces no new worst case. Near Sol, where full-draw would be expensive, `blend≈0` keeps the
  cloud off anyway. The cap (like the `:449` octree-hide guard the §6 work already removed) saves
  nothing and only blanks/thins the screen. Removing it makes B render fully and dissolves P2 by
  itself. (Can't GPU-measure frame time in the throttled preview tab — see §8 note — so the CI
  `breadcrumb-perf.spec` foreground gate is the final budget check; the structural argument says
  it will pass.)

### Open decisions (the user picks — they shape B/E)
1. Show the procgen galaxy when **parked at mid-distance** (5–10 kpc), or only in motion?
   B = yes when parked too (consistent). If "only in flight" is wanted, that argues for A.
2. On a goto to a **local star** (~150 pc), show the background spiral or only the real local
   field? **Resolved by the measured LO:** with `GAL_FADE_LO≈1500–2000 pc`, any local hop below
   ~1.5 kpc stays `blend=0` → only the real local field, no background spiral. The hand-off being
   at ~2 kpc means "fill the gap" and "keep local hops clean" do **not** conflict — there is room
   between local-hop distances (≤ hundreds of pc) and the mid-band gap (2–18 kpc).

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

## 7. How to resume (implement — measurement is done, see §8)

1. ~~Measure the hand-off distance~~ **DONE (§8): ≈ 1.5–2.5 kpc.** Set `GAL_FADE_LO_PC` to
   **~1500–2000** (recommend 1500). HI stays 45_000.
2. Apply B (lower LO) + E (drop `GAL_FLIGHT_DRAW_MAX`, couple procgen-layer visibility
   structurally) on a branch.
3. **Re-measure the lowered ramp** with the per-frame luminance probe (§9 recipe): every
   sampled distance from ~2 kpc to vantage must have visPx > 0 (no black sub-band), and
   nebulas-without-stars must not occur. Confirm local hops (< 1.5 kpc) still show only the
   real field.
4. Perf: `breadcrumb-perf.spec` rAF timing (CI, foreground — the throttled preview tab can't
   GPU-measure, §8 note) must stay within budget (R3).
5. `pnpm verify` (lint+type+test+build); leave Playwright e2e to CI.

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

---

## 8. Measured results (2026-06-27 — the data behind §5)

Per-frame luminance probe (an 80×45 2D-canvas `drawImage` of the live WebGL canvas, read
inside a rAF callback so the drawing buffer is intact). Parked at fixed distances via a
temporary `__cosmosDev.parkGalaxy(distPc)` dev hook (goTo to a point on +X facing the origin;
**removed after measuring**). `procO` = the applied `procgenOpacity`; where `procO=0` the luma
is the **real catalog alone**. `visPx` = pixels brighter than 20/255 (visibility floor).

| dist (real) | distanceFade | procgen | lumaMax/255 | visPx | what |
|---:|---:|:--:|---:|---:|---|
| 0 (Sol) | 0 | off | 178 | 11–13 | real field |
| 0.63 kpc | 0 | off | 62 | 7 | real |
| 0.88 kpc | 0 | off | 49 | 4 | real |
| 1.77 kpc | 0 | off | 22 | 1 | real — near hand-off |
| 2.74 kpc | 0 | off | 10 | **0** | **black** |
| 4.92 kpc | 0 | off | 10 | 0 | black |
| 7.75 kpc | 0 | off | 4 | 0 | black |
| 11.9 kpc | 0 | off | 4 | 0 | black |
| 18.2 kpc | 0 | off | 3 | 0 | black (right at LO) |
| 21.9 kpc | 0.056 | **on** | 120 | **65** | faint procgen already visible |
| 27.9 kpc | 0.303 | on | 255 | 136 | crisp spiral |
| 35.8 kpc | 0.731 | on | 255 | 116 | spiral |
| 47.9 kpc | 1.0 | on | 255 | 58 | vantage, full |

Screenshots: **10.5 kpc = pure black** (only UI chrome + crosshair); **27.7 kpc = edge-on disk
with bulge, dust lanes, magenta HII regions.**

### Findings
1. **Hand-off ≈ 1.5–2.5 kpc.** Real-catalog visPx: 11→1 by 1.8 kpc, 0 by 2.7 kpc; brightest
   star < 20/255 by ~2.7 kpc. `GAL_FADE_LO_PC=18_000` is ~7–10× too far → **empty band P1 is
   ~2–21 kpc, measured black**, parked or flying.
2. **Low procgen blend already reads** (dense 1M-pt cloud): `distanceFade=0.056` → visPx 65,
   6× the real field's best. visPx is *higher* in the mid-band (65–136) than at the far vantage
   (58) → filling the gap adds MORE content, not less. (This is why a plain LO drop likely
   suffices; the smoothstep gentleness is largely offset by cloud density.)
3. **Draw-cap budget question — resolved structurally, not by frame timing.** The throttled
   preview tab (`document.hidden=true` → rAF ~0.5 Hz; AudioContext keep-awake did not defeat it)
   makes in-tab frame-time meaningless for GPU budget. But the resting 48 kpc vantage already
   full-draws the cloud continuously, so dropping `GAL_FLIGHT_DRAW_MAX` adds no new worst case
   (§5 E). Final budget check = CI `breadcrumb-perf.spec` (foreground).

## 9. Re-measurement recipe (reuse after applying B+E)

To re-verify the lowered ramp (no temp hook needed if you only check a breadcrumb flight; the
park hook is only for static fixed-distance sweeps):

- Dev server (`pnpm --filter @cosmos/web dev`), load the app, wait `__cosmos.ready`.
- Luma probe MUST run inside a rAF callback (outside it the WebGL buffer is already composited →
  reads black; this cost a detour). Pattern:
  ```js
  const probe = Object.assign(document.createElement('canvas'), {width:80,height:45});
  const pctx = probe.getContext('2d',{willReadFrequently:true});
  const measure = () => new Promise(r => requestAnimationFrame(() => {
    pctx.drawImage(document.querySelector('canvas'),0,0,80,45);
    const d = pctx.getImageData(0,0,80,45).data; let max=0,vis=0;
    for(let i=0;i<d.length;i+=4){const l=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];if(l>max)max=l;if(l>20)vis++;}
    r({lumaMax:Math.round(max),visPx:vis});
  }));
  ```
- **rAF is throttled to ~0.5 Hz in the hidden preview tab.** Don't poll-wait via rAF (times out).
  Instead: fire the goTo / `parkGalaxy`, `await new Promise(r=>setTimeout(r, 5000+))` (wall-clock
  lets the throttled loop advance the flight), then `measure()`. Read distance from the ≤4 Hz
  `__cosmos.cameraPosition` mirror.
- Static park sweep needs the temp hook (re-add to BOTH `__cosmosDev` blocks in `App.tsx`, ~:528
  and :1605 — there are two; full page reload after editing, HMR doesn't re-run the effect):
  ```ts
  parkGalaxy: (distPc, durationMs = 200) => {
    const ctrl = controllerHolder.current; if (!ctrl) return;
    ctrl.goTo({ target:{context:'galaxy',local:[distPc,0,0]},
      lookAtTarget:{context:'galaxy',local:[0,0,0]},
      arrivalDistanceM: CONTEXT_UNIT_METERS.galaxy, durationMs });
  }
  ```
  (goTo to the *origin* with an arrival distance does NOT work from Sol — camera starts AT the
  origin, so the direction is degenerate and it never moves. Target a point at distance, face the
  origin.) **Remove the hook before committing.**

---

## 10. Implementation + post-ship measurement (2026-06-27)

Shipped on `main` work branch. Changes in `apps/web/src/scene/GalaxyScene.tsx`:

- **B**: `GAL_FADE_LO_PC` 18_000 → **1_500** (HI unchanged). Procgen now ramps on at the
  measured hand-off (~1.5 kpc) instead of 7–10× too far out.
- **E (cap)**: deleted `GAL_FLIGHT_DRAW_MAX` / `GAL_DRAW_CAP_RAMP_MS` / `drawCapRef` and the
  flight snap/ramp (and the now-dead `wasFlyingRef`). No in-flight draw suppression.
- **E (coupling)**: the first cut set `drawFraction = procgenBlend`, which **re-created P2** —
  at low blend the cloud was doubly dimmed (few points × low opacity → invisible) while the
  fixed-count procgen nebula sprites survived → measured nebulas-without-stars at ~5 kpc.
  Fix: `drawFraction` is now a **perf-only** knob (`= 1` when the layer is on); **opacity
  (= procgenBlend) is the sole visual fade**, shared by cloud + lanes + HII + impostor, so
  stars and nebulas fade together. Below LO (`procgenBlend ≈ 0`) the whole procgen mount is
  hidden (`m.hide()` — must be explicit, `m.seen` is set before the gate) → no 1M-pt overdraw
  near Sol (R1).
- §6 contract added as a code comment at the `procgenBlend` site.

**Surprise (worth recording):** the **3 colored blobs** (green/blue/magenta) that §1 P2 read
as procgen HII/dust are actually the **overlay nebulae** (`NEBULA_FIELDS` in
`scene/Overlays.tsx` / `glue/nebulae.ts`) — a *separate* local-sky system rendered at
`setOpacity(1)` whenever `tier !== 'low'`, independent of distance/procgen. That is why they
stay visible near Sol with `procgenOpacity = 0` (correct — they are local-sky features). P2's
real fix is that the procgen **star cloud** now fills the band at every distance, so blobs are
never alone in black. Re-tuning the overlay nebulae is out of scope for this task.

### Re-measured (static park sweep, screenshots — the throttled-tab rAF luma probe reads
black frames unreliably, so screenshots are the trustworthy signal here):

| dist | before (was) | after |
|---:|---|---|
| ~1.0 kpc | real field | procgen OFF (`procO=0`), sparse real field + overlay nebulae — local view (contract) |
| ~2.5 kpc | **black** | faint stellar disk forming (`procO≈0.0017`), not black |
| ~5.0 kpc | **nebulas, no stars (P2)** | faint full stellar disk **with** stars under the nebulae |
| ~10.5 kpc | **pure black (P1)** | full edge-on disk + bright bulge |

`pnpm verify` (lint+typecheck+test+build) green. CI `breadcrumb-perf.spec` (foreground) is the
remaining budget gate (R3) — the in-tab GPU timing is meaningless under throttling (§8 note).
