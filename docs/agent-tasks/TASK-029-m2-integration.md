# Task: M2 integration — Sol & exoplanet systems live in `apps/web`

**ID:** TASK-029
**Target package:** `apps/web` (+ `e2e/` flow specs)
**Size:** L — integration-heavy: assign to the strongest agent/human pair (§8.3)
**Phase:** 2 — integration (no parallel work alongside this task in `apps/web`)
**Depends on:** TASK-019, TASK-020, TASK-021, TASK-022, TASK-023, TASK-024,
TASK-025, TASK-026, TASK-027, TASK-028

## Goal

Assemble the M2 milestone (architecture §6 Phase 2): zoom from the star field into
Sol, watch planets orbit at 10⁶× time, visit Saturn's rings, then search
TRAPPIST-1, fly there, and tour its semi-procedural planets — with bookmarks that
survive a reload. Composition only: `apps/web` wires the frozen Phase 2 APIs;
**no package source may be modified.**

## Frozen Interface

Consumes only frozen APIs of: `core-types`, `coords`, `sim-time`, `orbits`, `data`
(v2), `render-stars`, `render-planets`, `app-state` (v2), `ui` (v2), `nav` (v3),
`scene-host` (v1.1).

Fixed wiring decisions (do not improvise):

- **Clock:** module-scoped `createSimClock()`. SceneHost prop
  `epochProvider = (dt) => { clock.advance(dt); return clock.epochJD; }` (stable
  ref). Store glue (plain module, not React): `useTimeStore` subscription applies
  `setPaused`/`setAccel` to the clock; `clock.onChange` → `useTimeStore.syncEpochJD`
  + emit `time/changed` on the app event bus; plus a 250 ms `setInterval` mirroring
  `clock.epochJD` into `syncEpochJD` while unpaused (the ≤ 4 Hz display throttle —
  never per-frame).
- **Packs:** startup fetches, in parallel: HYG (`/packs/manifest.json`, as in M1),
  `/packs/systems-sol.json`, `/packs/systems-exo.json` via `loadSystemsPack`, then
  `createCombinedSource(stars, [sol, exo])`. HUD adapter = combined source
  (`getBody`/`search`). Loading/error UX identical to M1 ("loading catalog…",
  retry button). `__cosmos.ready` only after all three.
- **Exo host stars:** `combined.extraHostBatch` → second `createStarPoints` mount,
  same per-frame offset pattern as the HYG batch (its origin is also `[0,0,0]`).
  Picks resolve through `combined.canonicalId('exoidx:' + i)`.
- **Textures:** one `KTX2Loader` instance (from `three/examples/jsm/loaders/KTX2Loader`),
  transcoder path `/basis/` — copy `basis_transcoder.js` + `.wasm` from
  `node_modules/three/examples/jsm/libs/basis/` into `apps/web/public/basis/`
  (committed). Load each `textures.*Url` of the anchored system on system mount;
  `texture.colorSpace = THREE.SRGBColorSpace` for albedos AND the ring strip.
  Failed texture ⇒ mesh falls back to `surfaceColorLinear` (no crash, console.warn).
- **Anchor scan (≤ 10 Hz, `setInterval` 100 ms, not per-frame):**
  `hit = combined.nearestHostSystem(cx, cy, cz)` with the camera's absolute
  galaxy-frame pc position. If `hit.systemId` differs from the current anchor AND
  `controller.contextId === 'galaxy'`:
  `tree.setAnchor('system', combined.hostPositionPc(hit.systemId))` FIRST, then
  `controller.setSystemAnchor({ id: hit.systemId, positionPc: … })` (TASK-027
  precondition order is normative).
- **System scene (mounted on `onContextSwitch` to 'system', unmounted on exit):**
  - Records: `getSystem(anchorId)`. Build once per mount: `packElements` over all
    bodies WITH elements (planets in slot order, then moons);
    `createPlanetMesh` per body (`contextUnitMeters = CONTEXT_UNIT_METERS.system`);
    `createOrbitLine` per body from
    `orbitPolylineAu(elements, 256)` with every point rotated by
    `applyMat3(ECLIPTIC_TO_GALACTIC, …)` at build (planet lines parent = host at
    origin; moon lines parent = their planet).
  - Per frame at `PRIORITY_RENDER` (single `useFrameContext`, module-scoped
    scratch, zero allocations): `propagateBatch(packed, ctx.epochJD, outAu)`;
    for each body: rotate via `applyMat3` into galactic axes → absolute system
    position = own AU vector (+ parent's for moons); write
    `origin.toRenderSpace({ context: 'system', local }, scratch)` →
    `mesh.setRenderOffset(scratch)`; star direction = `−normalize(absolute)`
    (host at origin) → `setStarDirection`; spin =
    `2π × fract((ctx.epochJD − 2451545.0) × 24 / rotationPeriodH)` (skip when
    absent) → `setSpinAngleRad`; orbit-line offsets = parent's camera-relative
    position. Sol disc (`unlit`, no elements): position = system origin.
  - UniversePosition scratch objects are reused mutables (cast once, documented)
    — never rebuilt per body per frame.
- **Nearest-surface feed:** in 'galaxy' context unchanged from M1 (star feed).
  In 'system' context: per frame, `min(distanceToBody_i − radius_i)` over the
  mounted bodies in CONTEXT UNITS (AU; radius = radiusKm×1000/unit), floored at
  1e-9, into `controller.setDistanceToNearestSurface`.
- **Picking:** planets first — on the existing pointerup-with-<4px-drag handler,
  raycast (`THREE.Raycaster`, click-time allocation fine) against the planet
  meshes' group; hit object carries its BodyId via `userData.bodyId` set at
  mount → `select(id)`. No planet hit → existing star pick (HYG batch + exo
  batch, smaller `angleRad` wins) → miss → `select(null)`.
- **Go-to chaining (search/info "Go to" on any id):**
  - Star/host target: as M1 (`goTo` host position, `arrivalDistanceM = 5e14` —
    inside the 7.5e14 enter threshold so arrival triggers the context switch).
  - Planet target: if its system is currently anchored AND mounted: target =
    current propagated absolute system position (UniversePosition),
    `arrivalDistanceM = max(8 × radiusKm × 1000, 5e6)`.
    Else: two-leg flight — store `pendingPlanetId`, goTo its HOST first; on
    `onContextSwitch` into that system, issue the second goTo to the planet.
    Any user cancel (`onGoToEnd(false)`) clears `pendingPlanetId`.
  - Every successful selection pushes `useHistoryStore.push(id, new Date()
    .toISOString())`.
- **HUD:** add `<TimeControls onSyncToNow={() => clock.syncToNow(Date.now())}/>`
  and `<BookmarksPanel …>` to the existing overlay. `onCapture(name)` builds
  `{ id: crypto.randomUUID(), name, createdAtIso: new Date().toISOString(),
  position: controller.state.position, orientation: controller.state.orientation,
  epochJD: clock.epochJD, anchorSystemId: contextId === 'system' ? anchorId :
  undefined }`. `onGoToBookmark`: `clock.setEpochJD(b.epochJD)`; if
  `b.anchorSystemId`: set tree anchor + `setSystemAnchor` for that system first
  (and if currently anchored elsewhere in 'system' context, goTo flow falls back
  to: exit wait is NOT required — restoring uses `goTo` with
  `target = b.position`, `arrivalDistanceM = 1e3`, which crosses contexts safely
  per TASK-013/027); orientation is applied on arrival via `onGoToEnd(true)`
  one-shot.
- **Test hook:** extend `window.__cosmos` with `{ contextId, anchorSystemId,
  epochJD, cameraPosition: { context, local } }` — updated from `onContextSwitch`
  / `clock.onChange` / the 250 ms interval (events + timer, never per-frame).

## Inputs / Outputs

- **Inputs:** committed packs (TASK-008/021/022), committed basis transcoder.
- **Outputs:** the running M2 app. Sol → accel 1e6× → planets visibly orbit;
  Saturn shows rings + Titan; TRAPPIST-1 tour works; bookmark survives F5.

## Constraints & Forbidden Actions

- Do not modify any `packages/*` or `tools/*` source, nor the packs. API friction
  = `blocked` + report (fix is a reviewed task against the owning package).
- No allocations in any `useFrameContext` callback (scratch module-scoped).
- New dependencies: NONE (KTX2Loader + Raycaster ship with `three`; transcoder
  files are static assets).
- React owns structure, never per-frame data (§2.2): mounting/unmounting the
  system scene on context switch is React state (rare); positions/spins flow
  imperatively.
- Debug modes (`?debug=markers`, `?debug=jitter`) keep working unmodified.
- Bundle gate: `apps/web` JS stays under the TASK-014 budget — KTX2Loader and the
  new packages must not push it over; transcoder wasm is an asset, not bundle.

## Common Mistakes (architecture §5.1, §5.12, §9, §10)

- Letting React re-render the Canvas subtree on HUD state changes — TimeControls
  re-renders at 4 Hz; it lives OUTSIDE `<SceneHost>` and must cause zero Canvas
  re-renders (verify like M1).
- Computing the pick ray from the Three.js camera's world position — camera
  object is camera-relative; absolute position comes from the controller state
  (planet raycast FROM the three camera is correct precisely BECAUSE the scene
  is camera-relative — document both halves).
- sRGB/linear confusion making planets washed out — albedo textures are sRGB
  (`SRGBColorSpace`), `surfaceColorLinear` fallbacks are linear; scene-host owns
  output encoding (§10).
- Subscribing HUD components to per-frame data — epoch flows through the 250 ms
  mirror, never `useFrameContext`.
- Evicting/unmounting the system the camera is inside (§5.8) — the anchor-scan
  guard (`contextId === 'galaxy'`) is what prevents it; do not remove it.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. New `e2e/tests/m2.spec.ts` (chromium, TASK-014 harness):
   - **Enter Sol:** from `__cosmos.ready`, search "Saturn", Enter →
     `goToActive` → eventually `contextId === 'system'`,
     `anchorSystemId === 'sol'`; arrival screenshot (Saturn + rings + orbit
     line) matches a committed baseline.
   - **Time:** click pause → two screenshots 2 s apart are pixel-identical
     (diff ratio < 0.001); set +1e6× (click ⏩ ×6) → two screenshots 3 s apart
     differ (diff ratio > 0.01) and `__cosmos.epochJD` advanced by ≈ 35 days
     ± 20%.
   - **TRAPPIST-1:** search "TRAPPIST-1 e", Enter → two-leg flight completes
     within 40 s; `anchorSystemId === 'exo:trappist-1'`; info panel shows the
     planet record (radius, a, period).
   - **Bookmark round-trip:** capture "ringside" at Saturn; `page.reload()`;
     panel lists it; click fly-to → within 20 s
     `__cosmos.cameraPosition` within 1e-4 AU of the bookmarked local (compare
     via the exposed position) and `epochJD` restored ± 1e-6.
   - **Perf smoke:** during the Sol approach flight, p95 frame < 50 ms, zero
     frames > 250 ms (CI-relaxed; reference-machine 60 fps is TASK-030's).
2. `pnpm verify` exits 0; `smoke`/`flythrough`/`m1`/`jitter`/`context-loss`
   specs still green (M1 behavior in galaxy context unchanged); bundle gate green.
3. Manual checklist in the PR (desktop dev machine): planets orbit smoothly at
   1e6× with no hitching; Saturn rings + terminator look right vs. reference
   imagery (§5.10 review); TRAPPIST-1 planets render with distinct colors; no
   visible snap at the context switch in either direction; HUD panels cause no
   dropped frames.

## Deliverables

- `apps/web/src/App.tsx` (packs + adapter + providers),
  `src/scene/SystemScene.tsx` (mount + per-frame propagation/offsets/picking),
  `src/scene/StarScene.tsx` (exo batch addition), `src/scene/NavDriver.tsx`
  (anchor scan + nearest-surface dual feed), `src/glue/time.ts` (clock⇄store),
  `src/glue/goto.ts` (two-leg chaining + bookmark restore), `src/hud/Hud.tsx`
  (TimeControls + BookmarksPanel wiring)
- `apps/web/public/basis/basis_transcoder.{js,wasm}` (committed)
- `apps/web/package.json` (workspace deps: sim-time, orbits, render-planets)
- `e2e/tests/m2.spec.ts` + new baselines

## Context Files

- `docs/architecture.md` §3 (frame data flow), §5.10, §5.12, §6 (M2), §9, §10
- READMEs of every consumed package (data v2, render-planets, nav v3, sim-time,
  app-state v2, ui v2, scene-host v1.1)
- `apps/web/src/` current M1 wiring (extend, don't rewrite)
- `docs/agent-tasks/TASK-027-nav-context-switch.md` (anchor precondition order)
- `e2e/README.md` (baseline recording procedure)
