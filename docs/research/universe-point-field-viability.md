# Research: is the universe point-field view viable with what the engine has?

**Date:** 2026-07-24
**Decision this serves:** whether to spec a `universe`-scale view built from a **dense
field of procedural points representing galaxies**, of which **exactly one** (the Milky
Way) resolves — continuously, no cut — from *point* → *impostor billboard* → *volumetric
1M-point cloud* as the camera approaches. The rest of the field is scenery: never
resolved, never selectable. This is the top rung of a four-rung descent
(universe → galaxy → system → near-Earth) whose lower three rungs already ship.

**Premise under attack (stated so it can die):** *"the engine already has the pieces —
point renderers, a procgen pipeline, an impostor→cloud fade — so the universe field is
assembly, not new machinery."* That sentence is the thing this document must confirm or
kill. It is currently **unverified**: it was assembled from a design conversation, not
from measurement.

## Ordering, stated honestly

Steps 1–2 (below) are committed **before** the investigation proper opens a source file
for this question.

**Declared caveat — prior reads in this session.** While drafting a spec that was then
halted (the user's call: *"capaz estoy pensando algo que no es viable… usemos research y
confirmemos"*), this session had already opened: `impostor.ts`, `galaxy-points.ts`
(first 45 lines), `render-stars/src` export listing, `procgen/src` export listing,
`glue/streaming.ts`, `local-group.ts` (both), `GalaxyScene.tsx` (two regions), and
`goto.ts`. Those reads happened **before** these kill conditions were written, so nothing
below may cite them as evidence. Every claim in Findings must carry a `RECHECK` command
run *after* this file was committed.

---

## Step 1 — Falsifiable questions

- **Q1 (renderer reuse).** Can either existing point renderer (`createStarPoints`,
  `createGalaxyPoints`) draw a point field whose positions live in **universe-context
  units (Mpc)**, or are they wired to galaxy/pc semantics — parsec-scale sizing laws,
  B−V blackbody color, arm-geometry dust darkening — such that a universe field needs a
  new renderer and shader?
- **Q2 (where the field comes from).** Does anything generate ≫12 positions at Mpc scale,
  and can the **streaming/procgen worker pipeline** carry such a field — or is the procgen
  tier structurally galaxy-context-only (keyed to star clouds inside one galaxy), forcing
  the field to be a static one-shot buffer?
- **Q3 (THE HAND-OFF — the heart of the question).** What does the Milky Way's far-LOD
  impostor actually do as the camera retreats past the exit gate? Does it shrink toward
  sub-pixel and vanish, or does it hold a minimum apparent size? I.e. **is there already
  a "galaxy as a dot" state to hand off from**, or must a third LOD state and an explicit
  cross-fade be built?
- **Q4 (scale limits).** How large can the field's radius be before the coordinate system
  or the f32 GPU downcast degrades? Concretely: what is the rebase threshold in universe
  units, and where does the Mpc→f32 conversion happen for a point at, say, 50 Mpc?
- **Q5 (what can be gated).** With no GPU-time instrument anywhere in the repo (established
  by the preflight, 2026-07-23), is there a **deterministic work-budget** knob — points
  drawn, draw calls, tier caps — that a CI gate could assert on for this field without a
  wall-clock number?
- **Q6 (selection honesty).** Is picking wired at universe context? The design requires
  the decorative points to be **non-selectable**; is that the default (nothing picks them)
  or would they become clickable dead ends for free?

## Step 2 — Kill / redirect conditions (written before investigating)

- **Q1 REDIRECTS** the whole estimate if both renderers hard-code galaxy semantics in the
  shader (pc-based size law, B−V attribute required, arm geometry uniforms): "reuse the
  point renderer" dies and the task grows a new shader. It **confirms reuse** only if a
  renderer takes positions + a render offset in *context units* and is agnostic about
  which context that is.
- **Q2 REDIRECTS** if the streaming procgen tier is galaxy-context-only: the field then
  cannot stream and must be a bounded static buffer, which caps the achievable point count
  and must be written into the spec as a constraint rather than discovered later. It
  **KILLS the "millions of points" framing** if no path can carry more than a small
  fixed count without new streaming work.
- **Q3 is the one that can KILL the design as described.** If the impostor has no
  small-size/point state — if it simply scales to nothing — then "a point that turns out
  to be a galaxy" is **new machinery, not assembly**, and the premise is dead as written.
  If instead there is a minimum apparent size (or a point-sprite path that already does
  this for stars), the hand-off is a tuning problem and the premise survives.
- **Q4 CONSTRAINS**: a small maximum radius is a spec constraint, not a kill — unless the
  radius needed for "countless galaxies" exceeds what the coordinate system tolerates, in
  which case the visual density must come from count-in-a-small-volume, and that changes
  what the view can honestly claim to depict.
- **Q5 BLOCKS THE GATE, NOT THE WORK.** If no deterministic proxy exists, the spec may not
  carry an acceptance number and must say so (the preflight's standing rule: never write a
  frame budget this repo cannot cite).
- **Q6 CONSTRAINS COPY**: if the decorative points are pickable, the spec must make them
  inert, and the view must not imply they are visitable places.

**The verdict is allowed to be: KILL — "this view is not viable with what exists; here is
the measurement."** It is equally allowed to be *reframe* (e.g. "the field is viable but
only as static, bounded, and with a purpose-built dot state"). Nothing in this document is
obliged to enable the spec that was halted to write it.

---

## Findings

### Q1 — RENDERER REUSE → **CONFIRMED, and the unit mismatch is exactly absorbable**

```
CLAIM:    `createStarPoints` is reusable for a field whose positions are in UNIVERSE
          units. It takes a StarBatch (positions + absMag + colorBV) plus a
          per-frame `setRenderOffset(offsetUnits)` in CONTEXT units, and draws the
          whole batch in ONE draw call. Nothing in it names parsecs except the
          distance-modulus constant in the shader.
EVIDENCE: packages/render-stars/src/star-points.ts:16-33 (options + "ONE draw call for
          the whole batch"), :82-97 (setRenderOffset, hi/lo f32 split);
          packages/render-stars/src/shaders/stars.vert.glsl.ts:49-57.
VERIFIED: 2026-07-24
RECHECK:  cat packages/render-stars/src/star-points.ts
```

```
CLAIM:    The shader's parsec assumption is a CONSTANT, absorbable per-point with zero
          shader edits. It computes m = aAbsMag + 5·(log10(d) − 1) treating d as pc.
          For d in Mpc, log10(d_pc) = log10(d_Mpc) + 6, so
          m = (aAbsMag + 30) + 5·(log10(d_Mpc) − 1) — i.e. feeding aAbsMag' = M + 30
          reproduces the identical size law in universe units. The size law itself
          (sNat = uBasePointPx·10^(−0.2m)) is unit-free.
EVIDENCE: packages/render-stars/src/shaders/stars.vert.glsl.ts:49-57.
VERIFIED: 2026-07-24 (algebra, from the shader source as written)
RECHECK:  sed -n '46,60p' packages/render-stars/src/shaders/stars.vert.glsl.ts
```

```
CLAIM:    `createGalaxyPoints` is the WRONG renderer to reuse for the field: it is the
          in-galaxy star cloud, carrying arm geometry for shader-side dust-lane
          darkening (scaleLengthPc, armCount, armPitchRad, armWindings, armWidthPc).
EVIDENCE: packages/render-galaxy/src/galaxy-points.ts:8-24,38-45.
VERIFIED: 2026-07-24
RECHECK:  sed -n '1,45p' packages/render-galaxy/src/galaxy-points.ts
```

### Q2 — WHERE THE FIELD COMES FROM → **REDIRECT: the kill condition fired. The field cannot stream.**

```
CLAIM:    The procgen streaming tier is structurally GALAXY-CONTEXT-ONLY. Every chunk
          the policy creates is stamped 'galaxy'; there are exactly TWO `context: '…'`
          assignments in the whole policy and BOTH are 'galaxy'. The procgen chunk's
          half-extent is a disc radius in PARSECS, and each `procgenGalaxies` entry
          yields exactly ONE chunk of `params.starCount` points — a star cloud INSIDE
          one galaxy, not a field OF galaxies.
EVIDENCE: packages/streaming/src/policy.ts:331 (`context: 'galaxy'` in
          ensureProcgenChunk), :327 (halfExtentUnits = discRadiusPc), :323-324
          (chunk id `gal<seed>:sec0`), :515-531 (selectProcgen: one chunk per entry).
          `Select-String -Path packages/streaming/src/policy.ts -Pattern "context: '"`
          → 2 hits, lines 214 and 331, both 'galaxy'.
VERIFIED: 2026-07-24
RECHECK:  grep -n "context: '" packages/streaming/src/policy.ts   # expect 2 hits, both galaxy
```

**Consequence (this is the redirect):** the field must be a **static, bounded, one-shot
buffer** — generated once, mounted as a single `THREE.Points`, never streamed or evicted.
That is not fatal (one batch = one draw call, per Q1), but "millions of points streaming
in as you fly" is **not** available without new streaming work, and the spec must state
the field as a fixed budget rather than discover this later.

### Q3 — THE HAND-OFF → **REFRAME: the premise was half wrong. The dot state does not exist where it is needed, and no cross-fade spans two renderers.**

```
CLAIM:    The impostor has NO minimum apparent size and no point representation. Its
          vertex shader billboards a fixed world-space radius (`viewPos = camCenter +
          position`, the plane pre-scaled to radiusUnits) with no gl_PointSize, no
          clamp, no floor — so as the camera retreats it shrinks toward sub-pixel
          without bound. There is no "galaxy as a dot" state in render-galaxy.
EVIDENCE: packages/render-galaxy/src/shaders/impostor.vert.glsl.ts:9-16;
          packages/render-galaxy/src/impostor.ts:22,42 (PlaneGeometry(1,1),
          mesh.scale.set(radiusUnits, radiusUnits, 1)).
          MEASURED — pattern count over impostor.ts + impostor.vert + impostor.frag for
          `PointPx|gl_PointSize|min|clamp` → **0 hits**.
VERIFIED: 2026-07-24
RECHECK:  grep -c "PointPx\|gl_PointSize\|min\|clamp" packages/render-galaxy/src/impostor.ts packages/render-galaxy/src/shaders/impostor.*.ts
```

```
CLAIM:    The "dot with a floor" mechanism DOES exist, twice, but only in the POINT
          renderers — never in the impostor. Both clamp screen size and (in stars)
          conserve flux when the floor bites, which is exactly the behavior a
          galaxy-as-point needs.
EVIDENCE: render-stars: uMinPointPx/uMaxPointPx + `vSizeDim = min(1, (sNat/sRen)^2)`
          (shaders/stars.vert.glsl.ts:52-60; default minPointPx 3, star-points.ts:34).
          render-galaxy: the floor lives in galaxy-points.ts:10,39,62 +
          galaxy.vert.glsl.ts:9,29 — the star CLOUD, not the impostor.
VERIFIED: 2026-07-24
RECHECK:  grep -n "MinPointPx\|minPointPx" packages/render-galaxy/src/*.ts packages/render-galaxy/src/shaders/*.ts
```

```
CLAIM:    Today's only galaxy LOD cross-fade is INTERNAL to one procgen mount and is
          driven by the streaming LOD level, not by distance directly: cloud and
          impostor share one mount and swap over lod ∈ [2, 6] via smoothstep, where
          lod comes from the chunk's projected pixel extent.
EVIDENCE: apps/web/src/scene/GalaxyScene.tsx:56-57 (LOD_CLOUD_FULL=2,
          LOD_IMPOSTOR_FULL=6), :256,263,269 (cloudFactor drives cloud vs impostor
          opacity within the same mount);
          packages/streaming/src/policy.ts:520-529 (lod from projectedPixelExtent).
VERIFIED: 2026-07-24
RECHECK:  sed -n '250,272p' apps/web/src/scene/GalaxyScene.tsx
```

**Settled:** the halted spec's premise — *"the pieces exist, this is assembly"* — is
**half true, and the wrong half was the load-bearing one.** No new *shader* is needed: the
point state is a solved problem in `render-stars`, and the sprite and volumetric states
already exist in `render-galaxy`. What does **not** exist is a cross-fade **between two
different renderers in two different packages** (a `THREE.Points` from render-stars handing
off to a billboard mesh from render-galaxy). Every fade in the app today is *within* one
mount, between objects created together. That hand-off is the new machinery, and it is the
one thing the whole view depends on.

### Q4 — SCALE LIMITS → **not a constraint at any radius this view would use**

```
CLAIM:    The rebase threshold is 10,000 CONTEXT UNITS = 10,000 Mpc in universe context,
          ~4 orders of magnitude beyond a Local-Group-scale field, and f32 precision at
          field distances is irrelevant to point rendering (ULP of an f32 near 50 is
          ~4e-6; positions are additionally stored relative to a batch origin and the
          camera-relative offset is carried as an f32 hi/lo pair).
EVIDENCE: packages/core-types/src/coords.ts:13,26 (universe 3.0857e22 m;
          REBASE_THRESHOLD_UNITS = 10_000);
          packages/render-stars/src/star-points.ts:82-97 (hi/lo split).
VERIFIED: 2026-07-24
RECHECK:  cat packages/core-types/src/coords.ts
```

### Q5 — WHAT CAN BE GATED → **deterministic proxies exist; a frame budget still may not be written**

```
CLAIM:    Deterministic, CI-assertable knobs already exist and are mirrored to the test
          hook: renderedPoints, drawCalls, plus a per-tier draw cap for procgen. But the
          cap applies to PROCGEN MOUNTS via computeProcgenDrawFraction — a static
          universe field would be outside it and needs its own explicit cap.
EVIDENCE: apps/web/src/glue/procgen-draw-budget.ts:23-27 (high Infinity / medium 250k /
          low 90k), :35-40 (computeProcgenDrawFraction);
          apps/web/src/glue/test-hook.ts:31-41 (streaming.renderedPoints, drawCalls).
VERIFIED: 2026-07-24
RECHECK:  cat apps/web/src/glue/procgen-draw-budget.ts
```

The GPU-cost absence from the 2026-07-23 preflight (Q2) still stands and is **not**
re-litigated here: no spec built on this doc may state a frame budget.

### Q6 — SELECTION HONESTY → **satisfied for free**

```
CLAIM:    A separate universe field batch would be non-selectable by default. Picking
          runs `pickStar` over the HYG and exoplanet batches only, inside StarScene's
          pointer handler, with an angular threshold; nothing enumerates other batches.
EVIDENCE: apps/web/src/scene/StarScene.tsx:12,19 (PICK_MAX_ANGLE_RAD),
          :323,332 (pickStar over hygBatch / exoBatch only), :259 (the same closures
          are what the e2e hook exposes).
VERIFIED: 2026-07-24
RECHECK:  grep -n "pickStar" apps/web/src/scene/StarScene.tsx   # expect hyg + exo only
```

---

## What I looked for and did NOT find (verified absences)

- **No size floor, point size, or clamp anywhere in the impostor** (0 hits over
  `impostor.ts` + both impostor shaders). The galaxy has no dot state.
- **No procgen chunk outside galaxy context**: both `context: '…'` assignments in
  `policy.ts` are `'galaxy'`.
- **No generator emitting more than 12 Mpc-scale positions.** `Mpc` appears in
  `packages/nav` only in `controller.ts` (anchor math), `galaxy-switch.ts` (the anchor
  type) and `local-group.ts` (the 12-record generator); **zero** hits anywhere in
  `packages/procgen` — procgen knows only about star clouds inside a galaxy.
- **No cross-fade between a render-stars object and a render-galaxy object** anywhere in
  `apps/web/src/scene`. Every opacity hand-off found is within a single mount.
- **No GPU-time instrument** (re-confirming the preflight, not re-measured here).

## Beliefs (second-class — a spec may NOT cite these as Step 0 facts)

- A field in the 10⁴–10⁵ point range should read as "countless" and cost far less than the
  1M-point procgen cloud the app already draws at the far vantage. Asserted from the
  shape of the code and the existing 109k-star catalog draw; **not measured**.
- The point→impostor cross-fade is probably a smoothstep over camera distance with the
  two objects co-drawn in the overlap band. Not attempted; the risk is that additive
  blending makes the overlap band brighter than either endpoint.

---

## Step 6 — Verdict: **ENABLE, with one reframe — and one redirect that outranks it**

**The view is viable.** Nothing found here kills it. Q1 confirms the point renderer is
reusable in universe units with the distance-modulus constant absorbed into a per-point
attribute (no shader edit); Q4 shows scale is a non-issue; Q6 gives the "decorative points
are inert" requirement for free; Q5 supplies deterministic gate knobs.

**The reframe:** the halted spec's premise — *"the pieces exist, this is assembly"* — is
corrected by Q3. The three visual states exist, but the **cross-fade between two different
renderers in two different packages does not, and nothing in the app does anything like
it**. That single hand-off is the deliverable; everything else is wiring. And Q2 removes a
capability that was being assumed: the field **cannot stream** (procgen is
galaxy-context-hardcoded), so it must ship as a static bounded buffer with its own draw cap.

**The redirect (raised by the user mid-investigation, and it outranks the universe view):**
the same point→object hand-off is *already* on the shipping path one rung down — selecting
a star, approaching, and entering the system context — and the user reports it reads as a
jump. That symptom is consistent with what Q3 establishes: **no cross-fade spans a point
renderer and an object renderer anywhere in this app.** If that is the cause, then the
universe view would be building a second instance of a defect the app already has, one rung
above where anyone can see it. **This document does not diagnose that jump** — it was
reported, not measured, and the honest next step is a `root-cause` pass on the
galaxy→system transition, not more reading. Fixing (or at least explaining) the hand-off
where it already hurts is worth more than adding a rung that needs the same fix.

**Claims a spec writer should lift into Step 0:** Q1's two claims (star-points reuse +
the +30 magnitude absorption), Q2's galaxy-context-hardcoding, Q3's three claims (no
impostor floor; the floor exists in the point renderers; today's fade is intra-mount),
Q5's cap gap, Q6's pick path.
