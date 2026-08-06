# ADR-007: Star Visibility Modes (Natural / Survey)

**Status:** Accepted
**Date:** 2026-08-06
**Refines:** architecture §2 (real catalogs for credibility), §5.7 (the Gaia subset)
**Builds on:** [ADR-006](ADR-006-gaia-subset-tier-unification.md) (one authoritative star
layer per scale)
**Formalizes:** [`docs/research/telescope-effect-magnitude-reveal.md`](../research/telescope-effect-magnitude-reveal.md),
[`docs/research/gaia-visibility-and-realness-problem.md`](../research/gaia-visibility-and-realness-problem.md),
[`docs/research/galaxy-octree-streaming-value-near-sol.md`](../research/galaxy-octree-streaming-value-near-sol.md)

## Context

The app streams a real Gaia DR3 catalog, and most of it is invisible. Measured at a settled
Sol view (`galaxy-octree-streaming-value-near-sol.md`, Claim 5): inside the 25 tiles that
survive both draw-time culls, **18,476 of 233,795 points (7.90%)** reach the frozen
perceptibility floor `0.004`. The other 92% are resident, uploaded, rendered and pickable
without contributing a pixel.

Two different products are hiding in that number, and until now nothing said which one is
being built:

1. a **sky that looks right** — the enriched default the exposure slider was tuned for; or
2. a **way to see the catalog that is actually there** — deeper exposure revealing the faint
   tail that makes the real data worth carrying.

Several tasks downstream (photometry extraction, picking, streaming selection, pack format)
each need to answer "would this star be perceptible?", and each would otherwise invent its
own answer. This ADR fixes the vocabulary and the numbers so they cannot drift apart.

It also names a tension that would otherwise be discovered late: **a deeper mode makes
photometric streaming reductions smaller**, because more of the catalog crosses the same
floor. That is a deliberate trade, recorded in decision 9.

## Decision

### 1. Two modes

```ts
type StarVisibilityMode = 'natural' | 'survey';
```

Natural is the default on every boot. Persistence is not introduced by this initiative.

### 2. Natural preserves today's rich field

Natural is **not** a naked-eye simulation, and must not be described as one. It is the
current, intentionally enriched default:

- exposure slider default stays **25**, range stays `[0.1, 200]`
  (`packages/app-state/src/settings.ts`);
- the galaxy octree multiplier stays **6**, so default effective octree exposure is
  `25 × 6 = 150`;
- HYG / exoplanet / system star rendering stays on its current raw-slider multiplier (1);
- procgen cloud exposure stays independent (`CLOUD_EXPOSURE_BOOST` solves a different
  representation problem and is out of scope here).

### 3. Survey is exposure-only

- galaxy octree multiplier is **40**, so default effective octree exposure is `25 × 40 = 1000`;
- the slider remains a relative trim; switching mode never rewrites its stored value;
- camera FOV stays **60°** (`packages/scene-host/src/SceneHost.tsx`);
- no reticle, vignette, magnification, or optical claim of any kind;
- UI copy is **Survey** or **Deep survey**. Never *Telescope*.

### 4. One floor for everyone

Both modes use perceptibility floor **`0.004`**. The mode changes effective exposure, not the
floor. Render, pick, cull and streaming all test the same predicate at the same floor, so a
star that is claimable is a star that is drawn.

```
naturalOctreeExposure = sliderExposure × 6
surveyOctreeExposure  = sliderExposure × 40
perceptible           ⇔ shaderBrightness ≥ 0.004
```

### 5. Three terms that are not the same thing

- **naked-eye visibility** — a catalog fact derived from apparent magnitude, shown on star
  cards (`packages/ui/src/astro-derive.ts`, `InfoPanel.tsx`). It does **not** change when the
  display mode changes: a star that needs a telescope from Sol still needs one while Survey
  is drawing it.
- **render perceptibility** — the result of the current camera, profile and shader. Changes
  with distance, exposure and mode.
- **residency** — data being loaded. Never a promise that anything is visible or clickable.

### 6. Survey reveals only real stars

Survey raises exposure on the catalog. It never increases procgen density and never presents
invented stars as survey detections.

### 7. Consumers converge on one implementation

Every consumer eventually reads the same profile through `@cosmos/photometry` (TASK-097).
No consumer re-implements the formula.

### 8. Frozen numbers

`0.004`, `6`, `40`, `[0.1, 200]`, default `25`, FOV `60°`. Changing any of them requires an
amendment to this ADR, not a task-local edit.

### 9. Survey pays full price, and that is accepted

Raising effective octree exposure from 150 to 1000 lifts much of the faint tail above the same
floor. Every photometric reduction downstream — the tile brightness cull, subtree `minAbsMag`,
any future band layout — therefore shrinks or disappears in Survey.

This is a deliberate trade, not a defect. Natural is the default and is where the saving
lives. Downstream work must report streaming and pack results **per profile** rather than
averaging them, and a candidate that wins only in Natural is still a legitimate win.

## Alternatives rejected

- **Make Natural a strict naked-eye simulation.** Would regress the current default, which
  was deliberately enriched and is what the slider was tuned against.
- **Call the deep mode "Telescope".** A telescope is narrower FOV *and* more light
  (`telescope-effect-magnitude-reveal.md`). Exposure alone is a false optical claim. An
  optical mode remains possible later, as a separate initiative.
- **Lower the floor instead of raising Survey's exposure.** The floor is shared by render,
  pick, cull and streaming; moving it splits consumer semantics and silently changes what is
  clickable everywhere.
- **Persist the mode across boots.** Deferred — it is a settings decision with its own
  migration question, and nothing here depends on it.

## Consequences

- TASK-097 can extract `@cosmos/photometry` with both profiles frozen and no product
  questions left open.
- TASK-100 can gate the Gaia pick on perceptibility knowing which exposure to ask about.
- TASK-101 measures pack-format candidates per profile, and can report a Natural-only win
  honestly.
- The 92% of faint points stops being pure waste the moment Survey ships: it becomes the
  content the mode exists to reveal. Until then, this ADR is the reason the data is worth
  keeping resident.
