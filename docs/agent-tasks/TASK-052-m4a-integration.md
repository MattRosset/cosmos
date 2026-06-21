# Task: M4a integration — atmospheric flyover, Gaia-dense sky, overlays, tours, cinematic

**ID:** TASK-052
**Target package:** `apps/web` (+ `e2e/` flow specs)
**Size:** L — integration-heavy: assign to the strongest agent/human pair (§8.3).
**Exclusive** in `apps/web`/`e2e` (no parallel work alongside this task).
**Phase:** 4 — integration
**Depends on:** TASK-043, TASK-044, TASK-045, TASK-046, TASK-047, TASK-048, TASK-049,
TASK-050, TASK-051 (all Phase-4a lanes)

## Goal

Assemble the **M4a** milestone (architecture §6 Phase 4, terrain deferred to 4b — see the
Milestone note). On top of the existing M3 app, wire the frozen Phase-4a APIs:

- **Gaia-dense sky + render-tier unification** ([ADR-006](../decisions/ADR-006-gaia-subset-tier-unification.md)
  §5, [`phase4-render-tier-handoff.md`](../research/phase4-render-tier-handoff.md)): load
  the Gaia octree pack alongside HYG; **fade procgen off** using `streaming.catalogCoverage()`
  (replacing `GAL_PROCGEN_FLOOR`); **gate/retire the monolithic `StarScene`** so the
  catalog is never drawn twice — budgets near Sol *improve*.
- **Atmosphere on Earth** (ADR-005): mount `createAtmosphere` on the Earth `PlanetMesh`,
  gated by `useQuality().atmosphereEnabled`.
- **Nebulae** (§5.11): mount `createNebula` fields in the galaxy context.
- **Educational overlays** (§5.12): constellation lines (`createLineSet` fed by
  `data.constellationSource.segmentsPc()`), the screen-space label layer (app projects
  `data.labelCandidates` → `ProjectedLabel[]` at ≤ 10 Hz), and `OverlayControls` toggles.
- **Guided tours + cinematic** (§5.3/§5.12): `TourChrome` → on step change the app calls
  `nav.playSpline`/`orbitBody` to fly to the `TourStep.targetId`; `useOverlayStore.cinematic`
  + `letterboxActive` drive the letterbox chrome.

Composition only: `apps/web` wires frozen APIs; **no package or tool source may be
modified, nor the packs** (other than the committed sample packs the lanes already
produced).

## Frozen Interface

Consumes only frozen APIs of: `core-types`, `coords`, `sim-time`, `orbits`, `data` (v4),
`render-stars`, `render-galaxy`, `render-planets` (v2), `render-fx` (v1), `app-state`
(v3), `ui` (v3), `nav` (v5), `scene-host` (v1.2), `workers`, `procgen`, `streaming`
(v1.1).

Fixed wiring decisions (do not improvise):

- **Gaia pack (startup, parallel with existing packs):** `loadOctreePack(
  '/packs/octree-gaia-sample/octree.json', { pool })` in addition to the HYG octree.
  Both feed the SAME streaming policy (one `OctreeSource` per tree, or a combined source —
  reuse the M3 octree wiring; do not add a parallel loader path, handoff doc §4). The full
  Gaia pack URL is a deploy-time config; the committed sample is the default in dev/CI.
- **Tier unification (ADR-006 §5, the core M4a change):**
  - Each frame, compute `cov = streaming.catalogCoverage()`. Drive the procgen galaxy
    cloud opacity = `1 - cov` (clamped), replacing `GAL_PROCGEN_FLOOR`/`GAL_FLIGHT_DRAW_MAX`
    in `GalaxyScene.tsx`. Keep the universe-scale **impostor** procgen path (handoff §3).
  - **Gate the monolithic `StarScene`** (M2 HYG `stars.bin`): mount it only while the
    octree root tile is not yet ready (or remove it if octree+Gaia cover all M-demo paths
    — handoff §4). Never draw the HYG catalog as both monolith and tiles simultaneously.
  - Render Gaia tiles through the **existing `render-stars` point machinery** (ADR-003 §3:
    tiles reuse the star-pack layout) — same mount path as HYG tiles, keyed by `chunkId`.
- **Atmosphere:** mount `createAtmosphere({ planetRadiusUnits: earthRadiusInContextUnits })`
  as a child of the Earth mount; per frame `setRenderOffset(origin.toRenderSpace(earthPos))`
  + `setStarDirection(sunDir)` + `setExposure(...)`; mount/unmount from
  `useQuality().atmosphereEnabled` (the scene-host post-chain pattern). One atmosphere
  (Earth) for M4a.
- **Nebulae:** a small committed set of `NebulaField`s (seed-defined positions/colors in
  the galaxy context; an app-level `apps/web/src/glue/nebulae.ts`, NOT a pack). Mount
  `createNebula` with a pre-loaded noise texture (the existing galaxy-asset bake pattern);
  per frame `setRenderOffset` + `setOpacity`. Gate by quality tier (cap on low).
- **Constellations:** load `loadConstellationPack('/packs/constellations.json')` at
  startup; build `createConstellationSource(pack, hygSource)`; one `createLineSet` whose
  `segments` are the app's rebased camera-relative copy of `segmentsPc()`; per frame
  `setRenderOffset` + `setVisible(useOverlayStore.constellations)`.
- **Labels:** a ≤ 10 Hz interval (the existing `__cosmos` throttle cadence) projects
  `data.labelCandidates(source)` world positions → screen px via the camera, producing
  `ProjectedLabel[]` for `<LabelLayer>`; `setVisible` follows `useOverlayStore.labels`.
- **Tours:** define a committed `Tour` (e.g. "Grand tour: Sol → Saturn → TRAPPIST-1");
  `<TourChrome onStepChange={i => flight.playSpline(splineForStep(i)) } onExit={() =>
  flight.cancelCinematic()} />`; `TourStep.orbit` ⇒ `flight.orbitBody(...)` during dwell.
  `letterboxActive`/`useOverlayStore.cinematic` toggle a CSS letterbox overlay.
- **Test hook:** extend `window.__cosmos` with `{ catalogCoverage, procgenOpacity,
  atmosphereMounted, overlays: { constellations, labels }, tour: { active, stepIndex },
  cinematicActive }`, updated on the existing ≤ 4 Hz interval (never per-frame). Keep the
  existing `streaming`/`qualityTier` hooks.

## Inputs / Outputs

- **Inputs:** committed packs (HYG, systems, HYG octree, **Gaia octree sample**,
  **constellations**), the procedural Milky Way + nebulae (seed-defined), committed tour
  definition.
- **Outputs:** the running M4a app — fly the Gaia-dense Milky Way to Earth with a visible
  atmosphere, toggle constellation lines + labels, run a guided tour with cinematic
  letterbox — no loading screens, fewer redundant points near Sol than M3.

## Constraints & Forbidden Actions

- Do not modify any `packages/*` or `tools/*` source, nor the packs. API friction =
  `blocked` + report (the fix is a reviewed task against the owning package).
- No allocations in any `useFrameContext` callback (scratch module-scoped); per-frame work
  is offset/opacity/star-dir relays + the streaming `update` — the §5.8/§9 doctrine.
- New dependencies: NONE (everything ships with the consumed packages).
- React owns structure, never per-frame data (§2.2): mounts (atmosphere, nebula, line-set,
  Gaia/HYG tiles) are event/state-driven; offsets/opacities/projections flow imperatively
  or via ≤ 10 Hz intervals.
- **M1/M2/M3 behavior is preserved** in their contexts; all debug modes
  (`?debug=markers|jitter|ctxswitch|flythrough3|soak3`) keep working; `__cosmos.ready`
  still gates only after all packs (incl. Gaia + constellations) + the local group build.
- No loading screen / blank frame at any scale boundary (the inherited M3 invariant).
- Bundle gate: `apps/web` JS stays under the TASK-014 budget; the new packs are static
  assets, not JS — verify the main bundle does not regress.

## Common Mistakes (architecture §5.1, §5.8, §5.10, §5.12, §9; ADR-006)

- Drawing the catalog twice (monolith `StarScene` + octree tiles) — the whole point of
  the unification is *fewer* points near Sol; gate the monolith (ADR-006 §5.2).
- Counting procgen toward coverage / fading procgen by a hard floor — drive opacity from
  `catalogCoverage()`, keep the universe-scale impostor (handoff §3).
- Mounting the atmosphere unconditionally — gate on `atmosphereEnabled` so it is absent at
  medium/low (the §9 degradation contract; ADR-005 §5).
- Projecting labels per frame on the main thread — throttle to ≤ 10 Hz (§5.12); `ui` takes
  screen coords, never the camera.
- Letting React re-render the Canvas subtree on overlay/tour/tier changes — toggles + tour
  flow through stores/intervals, not per-frame.
- Cinematic/tour flight in absolute coords across a context switch — `nav` v5 animates in
  the target frame; pass `UniversePosition` keyframes (§5.3).
- Nebula overdraw on low tier — cap layers / gate by tier (§5.11).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. New `e2e/tests/m4a.spec.ts` (chromium, TASK-014 harness):
   - **Tier unification (the headline):** on the M3 descent path, near Sol
     `__cosmos.streaming.renderedPoints` and `drawCalls` are **≤ the M3 baseline** (assert
     a drop, ADR-006 §5.4) while Gaia tiles are loaded; `__cosmos.procgenOpacity → 0` when
     `__cosmos.catalogCoverage` reaches ~1; the HYG monolith is gated off once tiles cover.
   - **Atmosphere:** approaching Earth at tier `high`, `__cosmos.atmosphereMounted` is
     true and a sampled limb pixel shows the scatter tint; forcing tier `medium`/`low`
     (CDP/`qc.setTier`) unmounts it (`atmosphereMounted` false).
   - **Overlays:** toggling constellations via the store renders line geometry
     (`__cosmos.overlays.constellations` true; a non-background pixel appears along a known
     segment); toggling labels shows `<LabelLayer>` entries; both off → none.
   - **Tour + cinematic:** starting the committed tour sets `__cosmos.tour.active`; advancing
     flies nav to each step (context ends correct, `cinematicActive` true during flight);
     `letterbox` shows the chrome; exit returns to free flight.
   - **No loading screen** at any scale boundary after `ready` (the M3 frame-sampling
     assertion still holds); streaming caps respected (`inFlight ≤ 6`, `renderedPoints ≤
     2M` at high, `drawCalls ≤ 300`).
2. `pnpm verify` exits 0; `smoke`/`flythrough`/`m1`/`m2`/`m3`/`jitter`/`ctxswitch`/
   `flythrough3`/`soak3`/`context-loss` specs still green (prior milestones unchanged);
   bundle gate green.
3. Manual checklist in the PR (desktop dev machine): Gaia visibly densifies the sky with
   no double-drawn stars near Sol; Earth shows a believable atmosphere that disappears on
   low tier; constellations + labels toggle cleanly; the guided tour reads smoothly with
   cinematic letterbox; memory does not climb during a 2-min free flight (TASK-053 does
   the soak).

## Deliverables

- `apps/web/src/scene/GalaxyScene.tsx` (Gaia tile mounts + coverage-driven procgen fade,
  replacing the `GAL_PROCGEN_FLOOR` hack), `apps/web/src/scene/StarScene.tsx` (gate the
  HYG monolith), `apps/web/src/scene/SystemScene.tsx` (Earth atmosphere mount +
  quality gate), `apps/web/src/scene/Overlays.tsx` (constellation line-set + nebulae +
  label projection), `apps/web/src/glue/nebulae.ts` (seed-defined fields), `apps/web/src/
  glue/overlays.ts` (constellation source + label projection throttle), `apps/web/src/
  glue/tours.ts` (tour defs + step→spline), `apps/web/src/hud/Hud.tsx` (mount
  `OverlayControls` + `LabelLayer` + `TourChrome` + letterbox), `apps/web/src/App.tsx`
  (load Gaia octree + constellation packs; providers)
- `apps/web/package.json` (workspace dep: `@cosmos/render-fx`)
- `e2e/tests/m4a.spec.ts` + new baselines

## Context Files

- `docs/decisions/ADR-005-atmospheric-scattering.md` (§5 gating),
  `docs/decisions/ADR-006-gaia-subset-tier-unification.md` (§5 the unification policy),
  `docs/research/phase4-render-tier-handoff.md` (§2 mitigations to replace, §4 checklist,
  §5 files likely touched)
- `docs/architecture.md` §3 (per-frame data flow), §5.8/§5.10/§5.11/§5.12, §6 (M4), §9, §10
- READMEs of every consumed package (render-fx, render-planets v2, data v4, app-state v3,
  ui v3, nav v5, streaming v1.1)
- `apps/web/src/` current M3 wiring (extend, don't rewrite) — `scene/GalaxyScene.tsx`,
  `scene/StarScene.tsx`, `scene/SystemScene.tsx`, `glue/streaming.ts`, `glue/quality.ts`,
  `glue/galaxy-assets.ts`, `glue/test-hook.ts`
- `docs/agent-tasks/TASK-040-m3-integration.md` (the integration + `__cosmos` hook
  pattern to extend)
