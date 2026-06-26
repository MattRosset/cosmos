# Research: black transit on galaxy breadcrumb flights (◂ Milky Way / ◂ Galaxy)

**Status:** **root cause confirmed** (live measurement) — fix not yet applied.
**Symptom owner:** the "goto se tilda / salta de pantalla / negro por segundo y algo"
report. Reframed below: it is **not** a freeze.
**Related:** `docs/research/TASK-040-breadcrumb-freeze.md` (the *previous*, perf, freeze —
already fixed), `docs/research/phase4-render-tier-handoff.md`,
`docs/research/gaia-visibility-and-realness-problem.md`.

---

## 1. Symptom (corrected)

Clicking **◂ Milky Way** (fly out to the ~49 kpc vantage) or **◂ Galaxy** (descend back
to the Sol field) runs a 5 s animated flight. During the flight the screen is **black for
~90 % of the trip in BOTH directions**, and the destination content (spiral, or Sol star
field) **pops in abruptly at the very end**.

This was initially mis-measured by me as a perf problem. It is not:

> "obviamente te va a dar fluido, no hay nada en pantalla" — the user, correctly.

Measuring frame time on a transit that renders nothing trivially reports "smooth". The
black transit **is** the bug; the main thread is healthy.

### What it is NOT (ruled out with numbers)

| Hypothesis | Test | Result |
|---|---|---|
| Main-thread freeze (old `nearestStarIndex`, 1744 ms/frame) | span profiler `?debug=breadcrumb-profile` over both flights | `nav.hyg.nearestStarIndex` **0.9 ms** max; **0** frames > 50 ms over 6549 frames. The TASK-040 fix holds. |
| GPU-upload stall on procgen mount | `galaxy.mountProcgen` span | **0.6 ms** max — no stall |
| Cold-start (worker generates 1 M points first time) | re-run after warm | spiral is fully built; transit is *still* black → not a generation-latency flash |

---

## 2. Root cause (confirmed)

**During any animated flight the procgen Milky Way is forced to opacity 0**, and the only
other galaxy-context content (the HYG/Gaia field) is concentrated within a few hundred pc
of Sol — so the entire 18 kpc–45 kpc band, where the spiral *would* be visible if parked,
renders black while flying through it.

The clamp is one line — `apps/web/src/scene/GalaxyScene.tsx:432`:

```ts
procgenBlend = flying ? Math.min(coverageFade, distanceFade) : distanceFade;
```

with `coverageFade = 1 - streaming.catalogCoverage()` (`:427`).

`catalogCoverage` **saturates to 1 everywhere in the galaxy** — the octree is
galaxy-scale-boxed but its stars are Sol-local, so the coarse tiles' geometric boxes fill
the screen and coverage reads ~1 at every distance (see
`[[procgen-coverage-distance-driven]]` / `gaia-visibility-and-realness-problem.md`).
Therefore:

```
coverageFade = 1 - 1 = 0
procgenBlend (while flying) = min(0, distanceFade) = 0   ← every frame of every flight
```

So the `Math.min` with `coverageFade` zeroes the spiral for the **whole** flight,
regardless of distance. A secondary cap, `GAL_FLIGHT_DRAW_MAX = 0.2`
(`GalaxyScene.tsx:96`), would also suppress it. On arrival `flying` flips to `false`, the
blend becomes `distanceFade` alone (= 1 at 49 kpc) over a 400 ms ramp
(`GAL_DRAW_CAP_RAMP_MS`) → the spiral **pops in**.

### Evidence — outbound (Sol → Milky Way), `procgenOpacity` per distance

16 Hz sampler reading `window.__cosmos` during the flight:

| dist (pc) | goTo | catalogCoverage | procgenOpacity |
|---:|:--:|:--:|:--:|
| 0 | false | 1 | 0 |
| 9 425 | **true** | 1 | **0** |
| 22 335 | **true** | 1 | **0** ← inside the 18–45 kpc spiral band, still black |
| 31 585 | **true** | 1 | **0** |
| 41 535 | **true** | 1 | **0** |
| 48 804 | **true** | 1 | **0** |
| 49 000 | false | 1 | **1** ← arrival: snaps 0 → 1 |

- `procgenOpacity < 0.02` for **100 %** of the 83 flight frames.
- `catalogCoverage = 1` for the entire flight (range `[1, 1]`).

### Evidence — inbound (Milky Way → Sol)

Mirror image: `procgenOpacity = 0` for **100 %** of flight frames; the Sol star field only
becomes visible in the last ~hundreds of pc (HYG concentrated near origin), so it too
"pops" at the end. `renderedPoints` held flat at 1 109 399 and `drawCalls` at 9 the whole
descent — the geometry is "rendered" but projects to nothing while far from Sol.

### Visual confirmation

- Mid-flight screenshot (both directions): essentially pure black, 1–2 faint dots.
- Arrival screenshot: full spiral (outbound) / full Sol field + Sol disc (inbound).

---

## 3. Why the "freeze / jump" feeling

- **Freeze:** 5 s of an unchanging black frame reads as a hang even though rAF runs at
  full rate (0 long frames).
- **Jump / "salta de pantalla":** the content appears in a single step at arrival (the
  `flying → false` opacity snap + 400 ms ramp), and the galaxy⇄system context switch is an
  instantaneous coordinate reconversion (`controller.ts doSwitch`) — both read as cuts.

---

## 4. Fix direction (not yet applied — for review)

The intent of the `flying` clamp was to protect the near-Sol flight budget (don't draw the
1 M-point cloud during the dense flythrough4 descent). But it overshoots: it kills the
spiral across the *entire* outer-galaxy band where there is no perf concern and no other
content. Options, smallest first:

1. **Drop `coverageFade` from the flight blend** and rely on `distanceFade` + the
   `GAL_FLIGHT_DRAW_MAX` draw cap: `procgenBlend = distanceFade` (flying or not). The cloud
   then fades in across 18→45 kpc *during* the flight (no pop), and is still capped to 20 %
   draw while flying so the near-Sol budget is unaffected (distanceFade ≈ 0 below 18 kpc
   anyway). **Recommended** — it directly removes the `min(0, …)` that causes the bug.
2. Gate the `coverageFade` clamp to the near-Sol regime only (e.g. apply it below
   `GAL_FADE_LO_PC`, use `distanceFade` above it).
3. Bridge the empty band between the HYG field (~hundreds of pc) and `GAL_FADE_LO_PC`
   (18 kpc) so something is always on screen — larger change, separate from this clamp.

Verify a fix the same way: the §2 sampler must show `procgenOpacity` rising smoothly with
distance during the flight (not a terminal 0→1 snap), and mid-flight screenshots in the
18–45 kpc band must show the spiral.

---

## 5. Reproduce / measure

Dev server, `?debug=breadcrumb-profile` (activates the span profiler). In the page console
or via eval, install a per-frame sampler over `window.__cosmos`
(`cameraPosition`, `procgenOpacity`, `catalogCoverage`, `streaming.*`), then click each
breadcrumb and read the trajectory. Headline checks:

- span profiler (`window.__breadcrumbProfileBuild()`): **0** long frames → confirms not perf.
- trajectory: `procgenOpacity` pinned at 0 while `goTo === true`, snapping to 1 on arrival
  → confirms the content gap.

**Caveat learned the hard way:** do not hand-set the exposure slider to extreme values
during measurement — high exposure + the procgen dust-lane `MultiplyBlending` layers
darken the near-Sol view to black and pollute the result. Always re-measure from a clean
reload at default exposure (25×).

---

## 6. Not covered here (follow-up)

The original report also mentioned goto **into a system** (descend to a star → `SystemScene`
mounts KTX2 textures + builds meshes). That is a different code path and was **not**
measured in this session. If a real sub-second stall exists anywhere, that mount is the
most likely place (texture decode is synchronous-ish after the await) — measure it
separately with the same sampler + the `galaxy.mountProcgen`-style spans.
