# Task: M1 integration — real sky in `apps/web`: stars, picking, search, go-to

**ID:** TASK-015
**Target package:** `apps/web` (+ `e2e/` flow specs)
**Size:** L — integration-heavy: assign to the strongest agent/human pair (§8.3)
**Phase:** 1 — integration (no parallel work alongside this task in `apps/web`)
**Depends on:** TASK-009, TASK-010, TASK-012, TASK-013, TASK-014

## Goal

Assemble the M1 milestone (architecture §6 Phase 1): `apps/web` loads the HYG pack,
renders 120k real stars through `render-stars`, click-picks stars into the selection
store, shows the info panel, and flies to search results via `nav.goTo`. The
placeholder `Starfield` dies here. After this task the product is demoable: *browse
the real night sky in 3D — click Sirius, read its data, search and fly to Betelgeuse.*

## Frozen Interface

Consumes only frozen APIs: `@cosmos/data`, `@cosmos/render-stars`, `@cosmos/ui`,
`@cosmos/app-state`, `@cosmos/nav`, `@cosmos/coords`, `@cosmos/scene-host`,
`@cosmos/core-types`. **No package source may be modified** — composition lives
entirely in `apps/web/src/`.

Fixed wiring decisions (do not improvise):

- **Startup:** fetch `'/packs/manifest.json'` via `loadStarPack`. Until resolved,
  render the HUD shell with a "loading catalog…" line; on failure show the error and
  a retry button (no crash).
- **Initial camera:** `{ context: 'galaxy', local: [0, 0, 1e-5] }` (≈ 2 AU above
  Sol), identity orientation. Initial `distanceToNearestSurface` comes from the data
  source from frame one.
- **Star mount:** `createStarPoints({ batch: source.batch })`, added via R3F
  `<primitive>`. Per frame at `PRIORITY_RENDER`:
  `starPoints.setRenderOffset(origin.toRenderSpace(BATCH_ORIGIN, scratch))` where
  `BATCH_ORIGIN` is the batch origin as a `UniversePosition` (module const) and
  `scratch` is module-scoped. Exposure: subscribe (transiently, not per-frame React)
  to `useSettingsStore` and call `setExposure`.
- **Nearest-body feed:** per frame at `PRIORITY_NAV` (before the controller update;
  reuse `NavDriver`): `i = source.nearestStarIndex(cx, cy, cz)` with the camera's
  absolute galaxy-frame position; distance in context units (pc), floored at
  `1e-7` pc, into `controller.setDistanceToNearestSurface`. Skip Sol-at-zero-distance
  trap: if distance < 1e-7 pc use 1e-7.
- **Picking (§5.12 — picking dispatches to the store):** on `pointerup` with < 4 px
  total drag: build the ray in tile-local pc (camera absolute pos − `batch.originPc`;
  direction from camera quaternion + NDC of the click through the projection), call
  `pickStar(batch, o, d, 0.02)`; hit → `select('hyg:' + batch.catalogIds[i])`; miss →
  `select(null)`.
- **HUD:** mount `<SearchPalette>` + `<InfoPanel>` inside the existing `.hud` overlay
  (overlay root `pointer-events: none`, panels opt back in — import `ui.css`).
  `onGoTo(id)`: `select(id)` then
  `controller.goTo({ target: starUniversePosition(id), arrivalDistanceM: 1e13 })`.
- **Test hook for E2E:** `window.__cosmos = { ready: boolean, goToActive: boolean,
  selectedId: string | null }` updated cheaply (event subscriptions, not per-frame) —
  dev/E2E convenience, harmless in prod, documented in code.

## Inputs / Outputs

- **Inputs:** committed pack from TASK-008.
- **Outputs:** the running M1 app. Search "Sirius" → Enter → ~6 s flight → info panel
  shows Sirius at ~2.6 pc.

## Constraints & Forbidden Actions

- Do not modify any `packages/*` or `tools/*` source, nor the pack. API friction =
  `blocked` + report (the fix is a reviewed task against the owning package).
- Delete `apps/web/src/scene/Starfield.tsx`; keep `DebugMarkers`/`DebugHud` behind
  `?debug=markers` exactly as in TASK-006 (the debug scene remains the no-pack
  fallback and CI flythrough target).
- No allocations in any `useFrameContext` callback (scratch objects module-scoped).
- No new dependencies anywhere.
- React owns structure, never per-frame data (§2.2): selection/loading state may be
  React state; offsets/distances flow imperatively.

## Common Mistakes (architecture §5.1, §5.12, §9)

- Letting React re-render the Canvas subtree on HUD state changes — palette/panel live
  outside `<SceneHost>`; verify zero Canvas re-renders on selection change.
- Blocking the canvas with full-screen DOM overlays that eat pointer events.
- Computing the pick ray from the Three.js camera's world position — the camera object
  holds camera-relative coordinates (origin ≈ camera); take the absolute position from
  the flight controller state, direction from its quaternion.
- Subscribing HUD components to per-frame data (the `__cosmos` hook updates on events
  only).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. New `e2e/tests/m1.spec.ts` (chromium, on the harness from TASK-014):
   - **Load:** app reaches `__cosmos.ready === true`; stars canvas screenshot matches
     a committed baseline (initial Sol-side view, at rest).
   - **Search → fly:** Ctrl+K, type "betelgeuse", Enter → `goToActive` true, then
     false within 15 s; info panel visible with "Betelgeuse"; final screenshot matches
     baseline.
   - **Click-pick:** programmatic click on a known star's projected position (use
     "Sirius" flow first to face it, then click center) → `selectedId` becomes
     Sirius's id; clicking empty sky deselects.
   - **Perf smoke:** during the Betelgeuse flight, p95 frame < 50 ms, zero frames
     > 250 ms (CI-relaxed; reference-machine 60 fps is checked in TASK-017).
2. `pnpm verify` exits 0; `smoke`/`flythrough` specs still green (debug scene intact).
3. Manual checklist in the PR (desktop dev machine): 120k stars at 60 fps; click
   Sirius → panel data correct vs. Wikipedia; search→fly to Betelgeuse smooth, no
   overshoot; toggling panels causes no visible hitch.

## Deliverables

- `apps/web/src/App.tsx`, `src/scene/StarScene.tsx` (mount + offsets + picking),
  `src/scene/NavDriver.tsx` (nearest-star feed), `src/hud/Hud.tsx` (palette + panel
  wiring), `src/main.tsx`/`styles.css` as needed
- Deleted: `apps/web/src/scene/Starfield.tsx`
- `apps/web/package.json` (workspace deps: data, render-stars, ui, app-state)
- `e2e/tests/m1.spec.ts` + new baselines

## Context Files

- `docs/architecture.md` §3 (frame data flow), §5.12 (picking/selection), §6 (M1), §9
- READMEs of: `data`, `render-stars`, `ui`, `app-state`, `nav`, `coords`, `scene-host`
- `apps/web/src/App.tsx`, `src/scene/NavDriver.tsx` (current wiring to extend)
- `e2e/README.md` (baseline recording procedure)
