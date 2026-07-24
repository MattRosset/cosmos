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
