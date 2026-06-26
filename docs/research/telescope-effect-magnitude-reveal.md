# Telescope effect — reveal faint real stars on zoom

**Type:** idea + design + implementation brief (exploratory). **Priority:** medium-high (it is the
feature that turns Gaia's faintness from a liability into the payoff). **Lane:** `apps/web` scene
(`GalaxyScene`) + camera/nav (FOV or a telescope mode) + `render-stars` exposure. **Size:** M.

> Read first: `docs/research/gaia-visibility-and-realness-problem.md` (the data this builds on),
> and the static foundation already landed: `GALAXY_FIELD_EXPOSURE_BOOST` in
> `apps/web/src/scene/GalaxyScene.tsx`. Sibling: `docs/agent-tasks/procgen-near-sol-density-blend.md`.

## The idea (from the 2026-06-26 session)

Standing in the galaxy view, point at a patch of sky and **activate a telescope effect**: stars
that were too faint to see fade in, as if you pointed a telescope at that spot. You see *more real
stars* the more you "zoom", while every star stays at its **true 3D position and magnitude** — the
realism of distance is preserved; you are only *collecting more light*, not inventing stars.

This directly mirrors a real telescope, which does two independent things:
1. **Magnifies** — narrows the field of view (angular zoom).
2. **Gathers more light** — a bigger aperture reaches a **fainter limiting magnitude**, so more
   stars become visible in the same patch.

The "see stars you couldn't before" is #2. In the app that maps to **raising the effective
exposure / lowering the visibility threshold** as you zoom in.

## Why this is the right feature (grounded in the measured data)

From `gaia-visibility-and-realness-problem.md`: 90% of the 3M Gaia pack is apparent mag 10–14, and
at the default exposure only ~1.6% (47k) is perceptible. Those faint stars are currently dead
weight — invisible at the postcard vantages, paying 119 MB for nothing visible. The telescope
effect **inverts that**: the faint 90% becomes the *reward of zooming in*. The deep pack stops
being waste and becomes the content of the feature.

**This flips the pack-cut decision (research §8.D / the cut-vs-exposure thread):** if we build the
telescope effect, we **want the deep pack (mag ≤ 12.5, ideally the full ~4.7M)** — do NOT cut it
down. The faint stars are precisely what fades in on zoom. (Without the telescope, a mag ≤ 10 cut
at ~18 MB loses nothing visible; *with* it, the faint tail is the payload.)

The render model already supports it cleanly (`stars.{vert,frag}.glsl`):
```
brightness = clamp(10^(−0.4·m), 0, 1) · uExposure       // flux × exposure
```
`uExposure` multiplies after the magnitude term, so raising it lifts the faint stars into view
without touching positions — exactly "collect more light." Bright stars clamp at flux 1, so they
do not blow out as exposure climbs. This is the same uniform the static
`GALAXY_FIELD_EXPOSURE_BOOST = 6` (effective ~150) already drives; the telescope effect makes that
boost **dynamic** instead of constant.

## What "zoom" is today (a constraint for the design)

The camera FOV is **fixed at 60°** (`packages/scene-host/src/SceneHost.tsx:200`,
`THREE.PerspectiveCamera`). There is **no optical zoom** — "getting closer" is camera *translation*
(WASD / double-click-to-fly), not FOV narrowing. So the telescope effect needs an explicit trigger;
it cannot piggyback on an existing zoom control because none exists. Three candidate triggers (§
Approaches).

## Approaches (pick after a quick prototype)

1. **Telescope mode toggle (simplest).** A key/button enters "telescope": narrow the FOV (e.g. 60°
   → 10–20°, the magnify half) **and** ramp `GALAXY_FIELD_EXPOSURE_BOOST` up (e.g. ×6 → ×40, the
   light-gathering half) over a short ease. Exit restores both. Reticle at screen center = where the
   "scope" points. Cheapest, reads clearly as "a telescope", and the FOV+exposure couple is the
   real-telescope analogy. Cons: a mode, not continuous.
2. **Continuous FOV-coupled exposure.** Add a scroll/zoom control that narrows FOV continuously; tie
   the boost to FOV by the real-optics law `boost ∝ (FOV_wide / FOV_now)^k` (limiting magnitude
   scales with magnification). Most "real", continuous, but introduces a new zoom control + must not
   fight the translation-based navigation.
3. **Distance/speed-coupled (automatic, no new control).** As the camera slows and dwells near a
   region (or descends deep on the octree), auto-raise the boost. "Lean in and the faint stars
   emerge." No UI, but subtler and risks feeling like a bug if uncommunicated.

Likely best: **(1) for a first shippable version** (clear, contained, demoable), evolving toward
**(2)** if continuous zoom is wanted. (3) is a nice ambient layer on top.

## Implementation sketch (approach 1)

- **Trigger + state:** a `telescopeActive` (and/or a `telescopeZoom ∈ [0,1]`) in app-state or a
  scene ref; key/button to toggle. Keep it **out of React render** (transient, like the existing
  exposure subscription in `GalaxyScene`).
- **FOV:** ease `camera.fov` 60° → target (e.g. 15°) and `camera.updateProjectionMatrix()` per frame
  while active. The camera handle is in `scene-host` (`frame-loop.ts`, `SceneHost.tsx`).
- **Exposure:** make the octree boost a function, `effectiveBoost = lerp(6, TELESCOPE_BOOST,
  telescopeZoom)`, applied where `makeOctreeMount` sets exposure (the two call sites already edited
  for the static boost). Procgen/StarScene/SystemScene untouched.
- **Couple FOV↔exposure** so they ramp together (magnify + light-gather = one gesture).
- **SSE/streaming note:** narrowing FOV (or descending) raises screen-space error → the octree cut
  descends → more/finer tiles stream in (more real stars actually loaded, not just brightened).
  Confirm this interacts well with the budgets (BUG-10 P0 holds; re-measure `streaming.update` while
  zoomed). The deeper tiles ARE the fainter stars — the streaming and the exposure reveal reinforce.
- **Determinism / probes:** keep the flythrough4 / m4a gates green (telescope is an additive mode;
  default path unchanged).

## Realism guardrails

- Never move or invent stars — only change FOV + exposure. Positions/magnitudes stay real.
- The faint stars revealed must be the **real Gaia faint tail** (keep the deep pack), not procgen
  filler — otherwise the "I'm seeing real deep-sky stars" promise breaks. (This is also why the
  identity wiring, research §5, matters: zoom in, then click a revealed star and get its real
  `source_id`.)
- Tune `TELESCOPE_BOOST` against the magnitude data: to reach the pack's mag-12.5 floor the
  effective exposure needs ~480+ (research §3), so a telescope target of ×20–×40 (effective
  ~500–1000) reveals essentially the whole pack — that is the deepest the data supports.

## Open questions

1. Mode toggle vs continuous zoom vs automatic — which reads best? (prototype 1, screenshot.)
2. Does narrowing FOV + deeper streaming stay within frame budget while moving? (measure.)
3. Should the Milky-Way band (procgen / the real 1.88× plane over-density) intensify on zoom too, or
   only the resolved stars? (ties to `procgen-near-sol`.)
4. Visual language: vignette / reticle / subtle scope framing so it reads as "telescope", not just
   "everything got brighter"?
5. Interaction with the static `GALAXY_FIELD_EXPOSURE_BOOST` default — telescope ramps *from* it.

## Acceptance (when built)

- In galaxy view, activate telescope on a patch → faint real stars fade in smoothly; deactivate →
  restore. Positions unchanged. Screenshots: before / during / after at a fixed orientation.
- Bright stars do not blow out; frame budget holds while active and moving (`streaming.update` +
  render phase timers within budget); flythrough4 / m4a gates green; `pnpm verify` exits 0.
- The deep pack is justified: zoomed-in reveal shows real Gaia mag 10–12.5 stars (not procgen).

## Pointers

- Data + render model: `docs/research/gaia-visibility-and-realness-problem.md`.
- Static foundation: `GALAXY_FIELD_EXPOSURE_BOOST` in `apps/web/src/scene/GalaxyScene.tsx`.
- Camera/FOV: `packages/scene-host/src/{SceneHost.tsx,frame-loop.ts}` (fov 60°, PerspectiveCamera).
- Render: `packages/render-stars/src/shaders/stars.{vert,frag}.glsl.ts`, `star-points.ts`.
- Exposure store: `packages/app-state/src/settings.ts`.
- Sibling (the band, near-Sol): `docs/agent-tasks/procgen-near-sol-density-blend.md`.
