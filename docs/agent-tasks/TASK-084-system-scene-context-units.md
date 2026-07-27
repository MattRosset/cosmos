# Task: Make SystemScene's bodies context-scaled (the mesh half of TASK-081)

**ID:** TASK-084
**Target package:** `apps/web` (`SystemScene`) + `render-planets` (mesh / orbit line / atmosphere)
**Size:** M
**Phase:** Maintenance track — scale-transition lane
**Depends on:** **TASK-081** — mirrors its *pattern* (`glue/context-scale.ts`), but needs a
**different, system-anchored** scale. `pcScales` is galaxy/parsec-anchored
(`unitsToPc = CONTEXT_UNIT_METERS[ctx] / CONTEXT_UNIT_METERS.galaxy`); it cannot be reused
directly here (see §Fix, decision D1). No hard code dependency — TASK-081 is merged.

> **Status: spec-reviewed 2026-07-27** (`/spec-review`, Opus 4.8). Facts F1–F5 re-verified
> against live code; F5 line numbers refreshed after the TASK-086 merge. The four open forks
> in the original stub (helper reuse, draw-vs-hide policy, scale channel, frozen surface) are
> resolved below with evidence. Ready for hand-off. Mechanism is **measured and photographed**
> in `docs/research/m3-switch-delta-yardstick.md` (CLAIM 5).

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
- **F5 — production cannot reach it today.** `StarApp.tsx:594` returns `null` when
  `mountedSystemId === null` (the `mountedSystem` memo), `:225` only sets it on
  `e.to === 'system'`, and `<SystemScene>` is mounted at `:658` guarded by that memo.
  (Line numbers refreshed 2026-07-27 post-TASK-086 merge; were `:552-558`/`:218`.)
  `RECHECK: grep -n "mountedSystemId\|to === 'system'\|SystemScene" apps/web/src/app/StarApp.tsx`

## Fix (reviewed contract)

Mirror TASK-081's *shape*: one derived scale, applied at a single per-frame site, exact-`1`
in the anchor context.

**D1 — the scale, and where it lives.** Add a sibling to `pcScales` in
`apps/web/src/glue/context-scale.ts`:

```ts
/** System-baked geometry (AU) → active-context units. Exactly 1 in `system` (the anchor). */
export function systemToContextScale(ctx: ContextId): number {
  if (ctx === 'system') return 1; // IEEE-754-exact; required, not an optimization (see pcScales note)
  return CONTEXT_UNIT_METERS.system / CONTEXT_UNIT_METERS[ctx];
}
```

Do **not** derive this by dividing two `pcScales` results — that ratio-of-ratios is the exact
trap `context-scale.ts:24-28` warns against (can land on `0.9999999999999999` and move the
`system`-context baseline off bit-identical).

**D2 — apply it to size only, via per-child object scale.** All three size-bearing children are
independent siblings under `rootGroup` — `mesh.object` (`SystemScene.tsx:205`), `line.object`
(`:217`), `atm.object` (`:280`). Per frame write `object.scale.setScalar(systemToContextScale(ctx))`
on each. This is allocation-free (matches `planet-mesh.ts:66`'s existing `setScalar`), and object
`scale` is independent of object `position`, so it **cannot** disturb the render offset (which is
a position, set via `setRenderOffset` at `:337`) — the offsets are already correct in every
context (F2) and must stay untouched. **Never scale `rootGroup` itself** — that would scale the
already-correct offsets too. The mesh's outer `object.scale` is currently unused (the build-time
`setScalar` at `planet-mesh.ts:66` is on the inner `sphereMesh`), so the outer-object write
compounds cleanly: `scaleUnits × systemToContext`.

**D3 — draw correctly, do not add a visibility gate.** The Goal ("true angular size in *every*
scale context") already answers the stub's open question: scale correctly and let it be sub-pixel
outside `system`. A `visible = ctx === 'system'` gate is rejected — it hard-codes a policy the
tour/preview/probe callers (the only things that reach this path, F5) may need to lift, and the
~30 draw calls are paid *only* by a caller that deliberately mounts a system off-context. If a
zero-pixel cull is wanted later it belongs in a separate task, gated on projected size, not on
context id.

## Frozen surface — do not touch

The executor will be tempted by each of these; none is the fix.

- **The AU bake.** `contextUnitMeters: AU_METERS` (`SystemScene.tsx:194`) and
  `atmosphereRadiusUnits = radiusKm*1000 / AU_METERS` (`:234-235`). Geometry is baked **once**
  in system units at build; the per-frame scale (D2) corrects for context. Do not change the bake
  to active-context units — that recomputes geometry per context and defeats the build-once model.
- **The render offsets.** `origin.toRenderSpace(...)` → `mesh.setRenderOffset(...)`
  (`SystemScene.tsx:333-337`). Already correct in every context (F2). The scale is size-only.
- **`rootGroup.scale`.** Scaling the group scales the offsets too (D2). Scale the children.
- **`pcScales` / `PcScales` in `context-scale.ts`.** Add `systemToContextScale` alongside it;
  do not repurpose the galaxy-anchored one.

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

## Acceptance gate

1. `pnpm verify` exits 0.
2. `pnpm test:e2e` exits 0. **`m3` must stay green**: `M3App` no longer mounts the system
   outside `system` context (`M3App.tsx:122` returns `null` when `mountedSystemId === null`),
   so this task must not change the m3 numbers at all — if `enterSystemDelta` moves off ~0.001,
   something else changed.
3. A measurement, not an assertion. Mount a system from **galaxy** context (a probe or a
   `__cosmosDev` hook is fine — name it in the spec's NOTES) and, reading both quantities from
   the app via `window.__cosmos` (`projectToScreen` for the body center + limb; never recompute
   the projection in the test — CLAUDE.md testing rule 1):
   - assert the projected diameter equals `2*r/d` (r = body radius, d = camera→body distance,
     both read from the app) within **±5%**;
   - **log the chosen input and both measured quantities** (context id, body id, r, d, measured
     px, expected px) so a CI-only failure is triagable from logs alone (CLAUDE.md testing rule 6).
   - **Guard against the trivial pass** (memory *verify-render-before-perf*): also assert the
     same body's projected diameter in `system` context is bit-identical to today — the fix must
     move the galaxy-context size **without** moving the system-context one.
