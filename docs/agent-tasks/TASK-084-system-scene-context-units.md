# Task: Make SystemScene's bodies context-scaled (the mesh half of TASK-081)

**ID:** TASK-084
**Target package:** `apps/web` (`SystemScene`) + `render-planets` (mesh / orbit line / atmosphere)
**Size:** M
**Phase:** Maintenance track — scale-transition lane
**Depends on:** **TASK-081** (reuses the `pcScales` helper it introduces).

> **Status: STUB, not spec-reviewed.** Filed from the m3 switch-delta root cause. The
> mechanism is **measured and photographed**; the *fix shape* below is a proposal, not a
> reviewed contract. Run `/spec-review` before handing this to an executor.

## Goal

The anchored system renders at its true angular size in every scale context, not only in
`system`. Today `SystemScene`'s geometry is sized in **system units (AU)** while its render
offsets come from `origin.toRenderSpace`, which returns **active-context** units — the exact
contract mismatch TASK-081 fixed for the point renderers, on a different renderer family.
In galaxy context every body is drawn `CONTEXT_UNIT_METERS.galaxy / .system` = **206,266×**
too large: Sol's 4.65e-3 AU radius is read as 4.65e-3 pc = 959 AU, which from the 5,000 AU
arrival distance is an 11°-wide sphere.

Full writeup, with the before/after frames and the draw-call attribution:
`docs/research/m3-switch-delta-yardstick.md` (CLAIM 5).

**Why it is latent, not user-visible, today:** production (`StarApp.tsx:552-558`) mounts
`SystemScene` only while `contextId === 'system'`, so nothing reaches the broken path. It
becomes reachable the moment anything mounts a system from outside — a galaxy-scale preview
of the selected system, a cross-context tour step, or a probe app.

## Step 0 — facts to re-verify (verified 2026-07-26). If any is false, STOP and report.

- **F1 — geometry is baked in system units.** `packages/render-planets/src/planet-mesh.ts:42`
  `const scaleUnits = (record.radiusKm * 1000) / contextUnitMeters;` → `:66`
  `sphereMesh.scale.setScalar(scaleUnits)`, with `SystemScene.tsx:194`
  passing `contextUnitMeters: AU_METERS` (`= CONTEXT_UNIT_METERS.system`, `:29`).
  `RECHECK: grep -n "scaleUnits\|contextUnitMeters" packages/render-planets/src/planet-mesh.ts`
- **F2 — the offsets are active-context units.** `SystemScene.tsx:333` calls
  `origin.toRenderSpace(systemPosScratch, renderScratch)` and feeds the result straight to
  `mesh.setRenderOffset` (`:337`), whose parameter is documented `offsetUnits`
  (`planet-mesh.ts:19`). In `system` context the two agree; nowhere else.
  `RECHECK: sed -n '329,340p' apps/web/src/scene/SystemScene.tsx`
- **F3 — orbit lines carry the same unit.** `orbitPolylineAu` output (AU) is handed to
  `createOrbitLine({ pointsUnits: poly })` (`SystemScene.tsx:209-216`).
- **F4 — the atmosphere too.** `createAtmosphere({ planetRadiusUnits: b.atmosphereRadiusUnits })`
  with `atmosphereRadiusUnits = radiusKm*1000 / AU_METERS` (`SystemScene.tsx:234-235`).
- **F5 — production cannot reach it today.** `StarApp.tsx:552-558` returns `null` when
  `mountedSystemId === null`, and `:218` only sets it on `e.to === 'system'`.

## Proposed fix shape (NOT reviewed)

Mirror TASK-081: keep one conversion site, keep galaxy/`system` bit-identical.

- Per frame, derive `systemToContext = CONTEXT_UNIT_METERS.system / CONTEXT_UNIT_METERS[ctx]`
  (exactly `1` in `system` context — an early return, as in `glue/context-scale.ts`).
- Apply it to the three size channels only (mesh scale, orbit-line points, atmosphere shell
  radius), **not** to the offsets — those are already correct in every context.
- The mesh scale is an object-space `scale`, so it is a per-frame `setScalar` write; the
  orbit line and atmosphere need a scale uniform or an object scale, whichever keeps the
  frame path allocation-free (§9).

**Open question for the reviewer:** whether the sane behavior outside `system` is "draw it
correctly (sub-pixel)" or "do not draw it at all". Correct-and-sub-pixel costs ~30 draw calls
per frame for zero pixels; a `visible = ctx === 'system'` gate is cheaper but hard-codes a
policy the tour/preview work may need to lift. Decide before implementing.

## Out of scope

- **The other probe apps.** `M4aApp`, `StreamingProbeApp`, `Soak4ProbeApp` and
  `Flythrough4ProbeApp` still keep the system mounted in every context via
  `mountedSystemId ?? M3_SOL_SYSTEM_ID`. They were left alone on purpose:
  `flythrough4.spec.ts:228-243` gates recorded draw-call and point counts against
  `apps/web/src/scene/flythrough4-m3-baseline.json`, so changing what those apps mount moves
  a recorded baseline. If this task makes the oversized draw correct, revisit them **with**
  the baseline question, not in passing. (`M3App` was already aligned with production — see
  `docs/research/m3-switch-delta-yardstick.md` CLAIM 6/7.)
- The point renderers (TASK-081), the impostor (TASK-082), the pick path (TASK-083).
- The camera clip planes — shared with the planet meshes, which write depth.

## Acceptance gate (draft)

1. `pnpm verify` exits 0.
2. `pnpm test:e2e` exits 0. **`m3` must stay green**: `M3App` no longer mounts the system
   outside `system` context, so this task must not change the m3 numbers at all — if
   `enterSystemDelta` moves off ~0.001, something else changed.
3. A measurement, not an assertion: mount a system from galaxy context (a temporary probe is
   fine) and show the body's projected diameter matches `2*r/d` within a few percent, where
   both are read from the app — not recomputed in the test (CLAUDE.md testing rule 1).
