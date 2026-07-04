# Task: Nebula Tier B — distance fade (B4) + domain-warp filaments (B3)

**ID:** TASK-073
**Target package:** `packages/render-fx` (nebula shader/material) + `apps/web` Overlays glue
**Size:** M
**Phase:** Maintenance track — visual-quality thread
**Depends on:** none (Tier A shipped 2026-06-27)

## Goal

The three overlay nebula fields (`neb:orion`, `neb:reflection`, `neb:remnant`) stop
reading as "solid objects pasted at full opacity from every range" and gain gas-like
filaments. This implements the two *mechanical* items of Tier B from
`docs/research/nebula-visual-quality.md`: **B4** (distance/aerial fade in `Overlays.tsx`
— nebulae bloom in softly on approach, consistent with the procgen contract style) and
**B3** (low-frequency domain warp on the sprite fBm so structure flows instead of
isotropic blobs).

**B1 (dust-lane absorption) and B2 (soft particles) are explicitly deferred**: B1 needs
a blend-mode/two-pass design decision (additive can't darken) and B2 needs the depth
texture — both are design-first work, not mechanical (see the open questions in the
research doc §4). Do not attempt them here.

## Scope guard

This touches only the three *overlay* nebulae. The procgen galaxy dust/HII layers are a
**separate system** that has been confused with these before — see
`galaxy-transit-procgen-floor-design.md` §10. If an edit lands in procgen files, the
task went off the rails.

## Frozen Interface

- `createNebula`'s public signature: additive params only (new optional fields with
  defaults preserving current output — existing calls unchanged must render
  byte-identically in shader terms).
- Additive blending stays (B1's non-additive pass is the deferred design).
- The three committed field placements/colors are content, not code — untouched.

## Deliverables

1. **B4:** per-field opacity taper by camera distance in `Overlays.tsx` glue: full
   opacity within `fadeNearPc`, →0 beyond `fadeFarPc`, smoothstep between; defaults
   chosen per-field so the current close-up look (the Tier-A capture, ~130 pc) is
   unchanged and the far-vantage "solid blob" softens. Drive the existing material
   opacity uniform — do not add a per-frame material rebuild.
2. **B3:** in the nebula fragment shader, warp the fBm sample coordinate by a
   low-frequency noise offset (`p + k·noise2(p·s)`, k/s as uniforms with defaults
   tuned to "filaments, not smear"). Seeded/deterministic — no `Math.random`, no time-
   varying animation (static structure; animation is out of scope).
3. Before/after captures at the documented reproduction vantage (research doc §6)
   attached to the PR — **reference material, not a gate** (screenshot policy).

## Out of scope

- B1, B2, all of Tier C (raymarch/SDF). New fields. Bloom threshold verification
  (listed in the research doc as a check for *after* A4+bloom — different thread).
- Any procgen/galaxy-transit change.

## Failure modes to watch

- **Transit regression:** the goto-galaxy transit passes near/through these fields;
  a badly-set `fadeFarPc` could pop a nebula in mid-flight. Verify with the existing
  transit e2e path; fade windows must be wide (soft) relative to flight speed.
- **Uniform-vs-rebuild:** driving fade by recreating materials per frame allocates in
  the frame loop (banned). Opacity is a uniform write.
- **Warp destroying the Tier-A look:** k too high turns layers into smear; the PR must
  include the §6 reproduction capture showing filament structure at the same vantage
  as the Tier-A baseline image.

## Acceptance Tests

1. `pnpm verify` exits 0 (render-fx unit/determinism tests green — shader change must
   keep the deterministic-output tests passing or update them with justification in
   the PR, never silently).
2. Unit: the fade function (pure, exported) — inside/outside/boundary/smoothstep
   midpoint values exact.
3. `pnpm test:e2e` green — flythrough/transit gates unaffected (work budgets unchanged:
   same draw calls, same point/sprite counts; this is shader-math + one uniform).
4. Screenshot comparisons are reference-only (`!process.env.CI`), per doctrine.

## Context Files

- `docs/research/nebula-visual-quality.md` (Tier map, §4 open questions, §6 reproduction)
- `packages/render-fx` nebula sources (`createNebula`, fragment shader)
- `apps/web/src/scene/Overlays.tsx` (field instantiation — B4 home)
- `docs/research/galaxy-transit-procgen-floor-design.md` §10 (the systems-confusion guard)
