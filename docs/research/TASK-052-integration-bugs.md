# Research: TASK-052 M4a integration bugs

Root-cause analysis of the five bugs found by manual inspection after the M4a
integration (see `docs/agent-tasks/TASK-052-integration-bugs.md` for the raw log).
Written so a fix agent can act on each without re-deriving the diagnosis. Code reading
only — no runtime profiling yet (BUG-4 needs it).

Confidence legend: **high** = traced to specific code; **medium** = strong candidate,
verify before fixing; **needs-measurement** = profile first.

---

## BUG-2 — Guided tour gets stuck / Saturn doesn't move  · confidence: high
**This is the big one — two distinct defects under one symptom, plus a third latent.**

### 2a. The tour never auto-advances (the "stuck flying in circles")
- `TourStep.dwellMs` is authored (`apps/web/src/glue/tours.ts:23-45`) but **consumed
  nowhere**. Grep for `dwellMs` outside core-types/tests: only the data definition.
- The tour store (`packages/app-state/src/tour-store.ts`) has a `playing` flag and
  `next/prev/setPlaying`, but **nothing drives advancement** — no timer reads `dwellMs`
  to call `next()`. `playing` is decorative.
- `TourChrome` (`packages/ui/src/TourChrome.tsx`) only advances on a manual Next click
  (`handleNext` → `onStepChange`). There is no dwell timer.
- Flow at runtime: start → `flyToStep(0)` flies the spline to the Sun → on completion
  `orbitBody({center: Sol, …})` starts (`apps/web/src/App.tsx:1185-1191`) → auto-orbit
  has `onEnd: null` and **runs forever** (`controller.ts:899-913`, `updateOrbitFrame`
  never terminates). Result: camera circles Sol indefinitely; tour never progresses.
  That is exactly "got stuck there flying in circles."
- **Fix direction:** drive auto-advance from `dwellMs`. When a step's fly-to spline
  completes, start the dwell (orbit if `step.orbit`), then after `dwellMs` call
  `useTourStore.getState().next()` and `flyToStep(next)` — but only while `playing` and
  not past the last step. Pause/resume must gate the dwell timer (and `pauseCinematic`/
  `resumeCinematic` already exist). Decide owner: cleanest is a small driver effect in
  `App.tsx` subscribed to the tour store, OR move the timer into `TourChrome`. Keep the
  camera flight in the app (the TASK-052 split: ui never touches the camera).

### 2b. Tour targets resolve to the host STAR, so Sun→Saturn is a zero-length move
- `resolveTargetUP` (`apps/web/src/App.tsx:1145-1161`): for a planet target it resolves
  to **the host system's galaxy position** (`hostPositionPc(hostId)`), i.e. Sol's
  galaxy coordinate. Step 0 (`sol`) and step 1 (`sol:saturn`) therefore resolve to the
  **same galaxy point**.
- `flyToStep` builds a spline from the current camera to that point. After step 0 the
  camera is orbiting Sol, so `from ≈ target` → `buildFlyToSpline` produces a spline with
  near-coincident keyframes (`apps/web/src/glue/tours.ts:58-96`; `dist≈0`, standoff
  collapses to `MIN_STANDOFF`). Centripetal Catmull-Rom over coincident knots degrades
  to "stay put" (`packages/nav/src/cinematic.ts` knot guards). Result: **"I go to Saturn
  the view doesn't move."**
- Compounding guard: `flyToStep` early-returns if `pos.context !== target.context`
  (`App.tsx:1177`). The whole tour is pinned to **galaxy scale** — it never descends into
  the system, despite Saturn's narration ("We descend into the Solar System to ride
  alongside it"). So even conceptually the tour can't show Saturn.
- **DECISION (2026-06-22, user):** go with **Option (ii) — re-scope the tour to
  galaxy-scale targets only (distinct stars)** as a **temporary** measure. Do NOT attempt
  the galaxy→system descent now. A proper tour redesign (which may bring back the descent)
  is deferred to an **explicit future task, to be proposed once all the TASK-052 bugs are
  fixed.**
- **Fix direction for this task (Option B):**
  - Rewrite `GRAND_TOUR` (`apps/web/src/glue/tours.ts:14-46`) so every step targets a
    distinct **star** (galaxy-context body), not a planet. Replace the `sol:saturn` step
    with a real star, and rewrite that step's narration so it no longer promises "we
    descend into the Solar System" (the tour stays at galaxy scale). Pick targets that are
    actually far enough apart that the fly-to spline has visible length (Sun and the
    Saturn-substitute must NOT resolve to the same point — that was the zero-length-move
    bug). Good candidates: Sol → a bright nearby star (e.g. Sirius / Vega) → TRAPPIST-1.
  - `resolveTargetUP` already handles star targets correctly
    (`App.tsx:1146-1158`, the `kind === 'star'` branch returns the star's galaxy position),
    so once the steps are all stars no resolver change is needed. The planet branch can
    stay for the future descent task.
  - Keep the same-context guard (`App.tsx:1177`) as-is — it's correct for a galaxy-only
    tour.
  - **Combine with 2a** (dwell auto-advance) — that fix is required regardless of A/B.
- **Deferred:** open a dedicated task "Design the guided tour" after the TASK-052 bug
  sweep, to decide whether the real tour descends into systems and to author its content.

### 2c. Latent: `handleNext`/`handlePrev` index math uses pre-update `stepIndex`
- `TourChrome.handleNext` calls `next()` then `onStepChange(Math.min(stepIndex+1, last))`
  using the `stepIndex` captured in the current render. Value is correct here, but it
  duplicates the advance logic across store + callback; if the store clamps differently
  the two can diverge. Low priority — fold into the 2a fix (single source of advancement).

### 2d. Post-fix UX polish — screen jumps + letterbox flicker (deferred, 2026-07-02)

**Status:** documented user observation after the Option B functional fix (TASK-053
session). **Not blocking** Phase 4a / TASK-053 gate closure — proper fix deferred to a
future **guided-tour redesign** task.

**User report (manual, dev build with BUG-2 fix applied):**
- The tour **works** now (advances through steps, no infinite orbit on Sol, Saturn step
  removed, does not drop into the solar system the way search/goto Sol does).
- It does **not** read as “flying smoothly to each star” — there are visible **screen
  jumps** between steps.
- **Cinematic letterbox flickers** — cinematic mode appears to turn on and off during the
  tour instead of staying engaged for the whole run.

**Why this is expected with the minimal Option B fix (confidence: medium, code reading):**

| Observation | Likely mechanism |
|---|---|
| Screen jumps | Each step calls `flyToStep` → `playSpline` from current camera to target with `minStandoffPc` galaxy framing. Auto-advance **cancels** the orbit cinematic and starts a **new** spline — a hard handoff, not a continuous path. Sol → Betelgeuse → TRAPPIST-1 are parsecs apart in a ~6 s spline. |
| Letterbox on/off | Letterbox is **per spline** (`buildFlyToSpline({ letterbox: true })`), not tour-scoped. Between spline end → `orbitBody` dwell → next `playSpline`, `letterboxActive` / `cinematicActive` can drop and remount. `__cosmos.cinematicActive` mirrors nav cinematic state, so the HUD letterbox chrome flickers. |
| Not a regression of 2a/2b | The old bug was “stuck forever” + zero-length Saturn move. The new behaviour is the minimum viable **functional** tour at galaxy scale — not the §6 M4 “believable flyover” polish bar. |

**Explicit non-goals for the BUG-2 functional fix:**
- Continuous authored fly-through path across the sky.
- Tour-level letterbox held for the entire run.
- Galaxy→system descent (deferred since 2026-06-22 Option B decision).

**Fix direction (future tour-redesign task):**
1. Hold letterbox (and `useOverlayStore.cinematic` or a dedicated `tourCinematic` flag)
   for the whole tour — splines run underneath without toggling chrome.
2. Author one continuous camera path (or cross-faded segments) instead of independent
   per-step fly-tos with cancel/restart.
3. Revisit step targets, narration, and whether steps descend into systems.

**Decision (2026-07-02, user):** ship functional fix for TASK-053; UX polish when the tour
is redesigned later. Recorded here so it does not pass unnoticed.

---

## BUG-3 — Cinematic view can't be closed (button covered)  · confidence: high
- The top-right "Cinematic" toggle (`packages/ui/src/OverlayControls.tsx:28-33`) flips
  `useOverlayStore.cinematic`, which is the ONLY thing that drives the letterbox bars
  (`apps/web/src/hud/Hud.tsx:127-143`, `active = cinematic || letterboxActive`). Note:
  this "cinematic" toggle is **purely cosmetic letterbox** — it does not start a spline or
  orbit; that path is separate (the tour).
- Z-order / paint: `.cosmos-ui-overlays` is `top:20px; right:20px; z-index:90`
  (`packages/ui/src/ui.css:522-530`). The letterbox top bar is `top:0; height:10vh;
  z-index:90` (`apps/web/src/styles.css:297-318`). On a ~900px-tall window 10vh ≈ 90px,
  so the **black top bar paints over the controls** (top:20px sits inside the bar).
  Equal z-index + the letterbox being LAST in DOM order (`Hud.tsx` renders
  `<OverlayControls/>` … `<Letterbox/>`) means the bar wins the paint → buttons invisible.
- `.hud-letterbox` is `pointer-events:none`, so the buttons underneath are probably still
  *clickable*, but the user can't **see** them to aim — and there is **no keyboard
  escape**: the App Esc handler only does system-exit / clear-selection
  (`App.tsx:1230-1247`); nothing toggles `cinematic` off.
- **Fix direction (pick one or combine):**
  1. Raise interactive chrome above the bars — give `.cosmos-ui-overlays` (and the tour
     card) `z-index` > the letterbox (e.g. 100), so they stay visible/clickable above the
     10vh bar. Cheapest, most robust.
  2. Inset the controls below the bar when cinematic is active (e.g. `top: calc(10vh +
     20px)`), so they're never occluded.
  3. Add `Esc` (and/or a visible "Exit cinematic" affordance) that calls
     `setCinematic(false)` — good UX regardless of the z-fix.
- Verify after fix: toggle Cinematic on, confirm the "Cinematic" button is visible and
  un-toggles; confirm Esc exits.

---

## BUG-5 — Labels jitter when the camera moves  · confidence: high
- Label screen positions are projected on a **`setInterval` at `LABEL_PROJECT_INTERVAL_MS`
  (≤10 Hz)** (`apps/web/src/scene/Overlays.tsx:133-168`), then published to React state
  (`subscribeLabels`→`setLabels` in `Hud.tsx:115-119`). The Canvas renders at ~60 Hz.
- So between projections (up to ~100 ms) the DOM labels are **frozen in pixel space while
  the scene keeps moving** → labels visibly swim/step relative to their targets whenever
  the camera moves. That is the jitter. (When the camera is still, they're fine — matches
  the report "jitter when the camera moves.")
- The 10 Hz cadence was a deliberate perf choice (§5.12: don't re-render the Canvas for
  labels). The mistake is updating label DOM via React state at 10 Hz instead of tracking
  the camera every frame imperatively.
- **Fix direction:** project labels in the per-frame render callback (there's already a
  `useFrameContext(…, PRIORITY_RENDER)` in `Overlays.tsx:106`) and update the label DOM
  **imperatively per frame** (the `SpeedReadout` pattern, `App.tsx:840-874`: rAF + direct
  `textContent`/`style.transform`, zero React renders). Keep label *set* membership
  (which labels exist / cull) on the cheap 10 Hz path; move only the x/y *positions* to
  per-frame. Net: smooth labels, still no Canvas re-render.
- Watch out: this reshapes the `ui` `LabelLayer` contract (it currently takes a
  `ProjectedLabel[]` snapshot). Either expose imperative handles or have the HUD own a
  ref-based label layer. Non-trivial — flag for the agent.

---

## BUG-1 — Nebulae render as flat green bokeh discs  · confidence: high
- The nebula "noise" sprite is **not noise** — `createNebulaNoiseTexture`
  (`apps/web/src/glue/nebulae.ts:83-100`) builds a plain **radial gradient** (one soft
  white disc, alpha 0.9→0).
- Each layer is an additive billboard sampling that one sprite
  (`packages/render-fx/src/nebula.ts:30-83`, `AdditiveBlending`, `depthWrite:false`).
  The only per-layer variation in the fragment shader is a **UV rotation by `vSeed`**
  (`packages/render-fx/src/shaders/nebula.frag.glsl.ts:18-26`). Rotating a **radially
  symmetric** gradient is a **no-op** — every layer renders the identical soft disc.
- So a field = ~12–16 identical soft discs at scattered centers/radii, added together =
  exactly the **overlapping translucent circles ("bokeh")** in the screenshot. The shader
  comment "sampled with a per-layer rotation so layers do not visibly repeat" is wrong for
  this texture. Additive bright tints + exposure make the teal/green remnant field glow
  hard.
- **Fix direction (in order of impact):**
  1. Give the sprite **actual structure**: replace the radial gradient with a fractal /
     value-noise (turbulence) alpha texture, still radially windowed so edges fade. This
     alone turns discs into cloud.
  2. Make per-layer variation real: add per-layer **UV offset + scale** (instanced
     attribute), not just rotation, so the shared sprite doesn't visibly tile/repeat.
  3. Tune the stack: more, smaller, lower-opacity layers; consider softer additive
     contribution so it doesn't blow out to solid color near the cores.
  These are all in `render-fx` (sprite gen lives in the app `glue/nebulae.ts`) — the
  contract (`createNebula` + `noiseTexture`) doesn't change.
- Secondary question to verify visually: the blobs sit large and centered at boot. The
  fields are 380–600 pc out with 55–90 pc radii (`glue/nebulae.ts:36-43`), which does
  subtend a big angle from Sol, so size is plausibly correct — but confirm the field
  origins convert correctly through `origin.toRenderSpace` and aren't collapsing toward
  the camera (`Overlays.tsx:113-127`). Low risk; the disc look is the real defect.

---

## BUG-4 — Universe view laggy  · confidence: needs-measurement
- No clear static root cause from reading. Per the project's debugging doctrine
  (measure/bisect/instrument, not theory), this needs profiling before any fix.
- Tools already in-tree: the frame profiler (`apps/web/src/glue/frame-profiler.ts`,
  `profileSpan` spans like `nav.surfaceFeed`, `nav.hyg.nearestStarIndex`), the
  `?debug=flythrough3` perf gate, and quality tiers (`packages/scene-host/src/quality.ts`).
- Candidate suspects to instrument first:
  - Streaming work in the universe context (`packages/streaming/*`, `glue/streaming.ts`)
    — chunk LRU / SSE / budget churn while far out.
  - The M4a combined HYG+Gaia octree cut (`glue/octree-combined.ts`, ADR-006) — more
    points / larger cuts than M3.
  - Procgen Milky Way regeneration (`glue/milky-way-gen.ts`) at universe scale.
  - The nav surface-feed short-circuit (`NavDriver.tsx:186-211`) — confirm it's actually
    short-circuiting in universe (it should hit the `contextId==='universe'` branch, not
    the HYG grid scan).
- **Fix direction:** reproduce in the universe context, capture `__breadcrumbProfile` /
  frame spans, bisect to the dominant span, then optimize that. Don't pre-optimize.

---

## Suggested fix sequencing for the agent(s)
1. ~~**BUG-3** (z-index + Esc)~~ — ✅ DONE, shipped in `f8e6d89`.
2. **BUG-1** (nebula sprite + per-layer UV) — contained to `render-fx` + `glue/nebulae.ts`.
3. **BUG-5** (per-frame imperative label projection) — touches `Overlays.tsx` + `ui`
   LabelLayer contract; medium.
4. **BUG-2** (tour auto-advance + target resolution) — largest; **needs a product
   decision** on whether the tour descends into systems (2b). Split: land 2a (dwell
   auto-advance) first; resolve 2b with the user.
5. **BUG-4** — separate profiling task; gate on measurement.

Each fix must keep `pnpm verify` green (boundary lint, zero-alloc `update()` test for any
nav change, existing nav/ui/app-state tests). Cross-check against the TASK-053 gate output
before starting — some of these (esp. BUG-4) may show up there with numbers.
