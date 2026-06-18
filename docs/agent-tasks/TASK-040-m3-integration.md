# Task: M3 integration — continuous Milky Way → Sol → Earth zoom, no loading screens

**Status:** **done** (2026-06-18) — branch `task-040-galaxy-view`, head `5a41bcb`.
M3 e2e green (`m3.spec.ts`); production breadcrumbs ◂ Milky Way / ◂ Galaxy signed off
manually (smooth flight, no bugs). Follow-up perf/doc: `docs/research/TASK-040-breadcrumb-freeze.md`.
**Next:** TASK-041 (Phase 3 gate).

**ID:** TASK-040
**Target package:** `apps/web` (+ `e2e/` flow specs)
**Size:** L — integration-heavy: assign to the strongest agent/human pair (§8.3).
**Exclusive** in `apps/web`/`e2e` (no parallel work alongside this task).
**Phase:** 3 — integration
**Depends on:** TASK-032, TASK-033, TASK-034, TASK-035, TASK-036, TASK-037,
TASK-038, TASK-039 (all Phase 3 lanes)

## Goal

Assemble the M3 milestone (architecture §6 Phase 3) — the signature demo:
**continuous zoom from outside the Milky Way → spiral arms → star field → Sol →
Earth, with no loading screens.** Composition only: `apps/web` wires the frozen
Phase 3 APIs on top of the existing M2 app; **no package or tool source may be
modified, nor the packs.** The galaxy/streaming layer becomes a fourth scale tier
above M2's galaxy→system→(planet) chain.

## Frozen Interface

Consumes only frozen APIs of: `core-types`, `coords`, `sim-time`, `orbits`, `data`
(v3), `render-stars`, `render-galaxy`, `render-planets`, `app-state` (v2), `ui`
(v2), `nav` (v4), `scene-host` (v1.2), `workers`, `procgen`, `streaming`.

Fixed wiring decisions (do not improvise):

- **Worker pool:** one module-scoped `createWorkerPool({ size: defaultPoolSize(),
  spawn: () => new Worker(new URL('./workers/cosmos.worker.ts', import.meta.url),
  { type: 'module' }) })`. `apps/web/src/workers/cosmos.worker.ts` is a thin entry
  that calls `serveWorker({ 'procgen.galaxy': galaxyWorkerHandler, 'octree.decode':
  <the data octree-decode handler> })` — it imports the handlers from `@cosmos/procgen`
  and `@cosmos/data`'s worker-side decode (the §5.13 Vite `new Worker(new URL(...))`
  syntax lives ONLY here).
- **Packs (startup, parallel):** existing HYG + systems packs (M2), PLUS
  `loadOctreePack('/packs/octree/octree.json', { pool })`. `__cosmos.ready` only
  after all packs + the local group are built. NO loading screen between scale tiers
  after `ready` — that is the milestone (§6 M3).
- **Local group + galaxy anchor:** `const galaxies = generateLocalGroup({ seed: 1 })`;
  the Milky Way is galaxy index 0 at universe origin. Anchor-scan analog to M2 but at
  the universe⇄galaxy boundary: a ≤ 10 Hz `setInterval` (100 ms, not per-frame) sets
  `tree.setAnchor('galaxy', mwPositionInUniverseUnits)` FIRST then
  `controller.setGalaxyAnchor({ id:'proc:milkyway', positionMpc })` (TASK-037
  precondition order is normative), gated on `controller.contextId === 'universe'`.
  The M2 system anchor-scan continues to run in `galaxy` context.
- **Streaming:** `const streaming = createStreamingPolicy({ origin, pool, octree,
  procgenGalaxies: new Map([['proc:milkyway', { seed: galaxies[0].seed, starCount:
  1_000_000 }]]) })`. A `useFrameContext` at `PRIORITY_STREAMING` calls
  `streaming.update(viewportHeightPx, ctx.dtMs)`. `streaming.onChunk` drives mounts:
  - `kind:'octree'` ready → a `createStarPoints` mount (HYG octree tiles are real
    stars; reuse the render-stars point machinery) keyed by `chunkId`.
  - `kind:'procgen'` ready → a `createGalaxyPoints` mount; dust lanes + the far-LOD
    impostor for the Milky Way mount once and cross-fade via `VisibleChunk.opacity`.
  - `evict` → dispose + unmount the keyed object.
  Per frame, each mounted object's `setRenderOffset(origin.toRenderSpace(chunk
  origin))` and `setOpacity(visibleChunk.opacity)` (module-scoped scratch, zero
  allocations).
- **Nearest-surface feed (unified, §5.8):** the per-frame
  `controller.setDistanceToNearestSurface(...)` now takes
  `min(streaming.nearestBodyDistanceM-in-context-units, M2 system-body distances)`
  depending on context — in `universe`/`galaxy` use streaming's scalar; in
  `system`/`planet` keep M2's body-distance feed.
- **Quality tiers:** `<SceneHost initialQualityTier="high" onQualityController={qc
  => { qc.onChange(s => streaming.setQualityTier(s.tier)); /* post chain reads
  s.bloomEnabled/atmosphereEnabled */ }} />`. Streaming's point cap is driven by the
  tier; bloom/atmosphere flags gate the post chain.
- **Picking:** in `galaxy`/`universe` contexts, the existing star pick path runs
  against the currently-mounted octree/galaxy point batches (smaller `angleRad`
  wins across all mounted batches). System/planet picking unchanged from M2.
- **Test hook:** extend `window.__cosmos` with `{ streaming: { inFlight,
  loadedChunks, renderedPoints, drawCalls }, qualityTier }`, updated from
  `streaming.stats` on the existing ≤ 4 Hz interval (never per-frame) and from
  `qc.onChange`.

## Inputs / Outputs

- **Inputs:** committed packs (HYG, systems, octree), committed basis transcoder,
  the procedural Milky Way (seed-defined, no asset).
- **Outputs:** the running M3 app — one continuous flight from outside the Milky Way
  down to Earth's surface-ish approach with no loading screen at any scale boundary.

## Constraints & Forbidden Actions

- Do not modify any `packages/*` or `tools/*` source, nor the packs. API friction =
  `blocked` + report (the fix is a reviewed task against the owning package).
- No allocations in any `useFrameContext` callback (scratch module-scoped); the
  streaming `update` is the §5.8 brain, the app just relays offsets/opacities.
- New dependencies: NONE (everything ships with the consumed packages; the worker
  entry uses the Vite `new Worker(new URL(...))` syntax — an asset, not a dep).
- React owns structure, never per-frame data (§2.2): chunk mount/unmount on
  lifecycle events is React state (rare, event-driven); offsets/opacities flow
  imperatively.
- M2 + M1 behavior in `system`/`planet`/`galaxy` contexts is unchanged; debug modes
  (`?debug=markers`, `?debug=jitter`, `?debug=ctxswitch`) keep working.
- Bundle gate: `apps/web` JS stays under the TASK-014 budget; the worker bundle is a
  separate chunk (`new Worker(new URL(...))`), not the main bundle — verify it does
  not push the main bundle over.

## Common Mistakes (architecture §5.1, §5.8, §5.13, §9)

- Computing visibility on the worker (1-frame-stale camera causes misses) —
  visibility/streaming `update` runs on the main thread; only generation/decode is
  dispatched to the pool.
- Cloning instead of transferring buffers (assert `byteLength === 0` post-transfer
  in dev) — the pool + data v3 already enforce this; do not re-copy ready batches.
- Importing Three.js into the worker entry (banned) — the worker entry imports only
  `serveWorker` + the pure handlers; it produces raw `StarBatch` buffers.
- A loading screen / black frame at a scale boundary — the WHOLE milestone is "no
  loading screens"; cross-fade (impostor↔cloud↔tiles) via `setOpacity`, never blank.
- Letting React re-render the Canvas subtree on HUD/tier changes — tier + stats flow
  through the ≤ 4 Hz interval and `qc.onChange`, never per-frame.
- Evicting/unmounting the chunk the camera is inside (§5.8) — streaming guards it;
  the app must dispose only on the `evict` event it receives, never speculatively.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. New `e2e/tests/m3.spec.ts` (chromium, TASK-014 harness):
   - **Continuous zoom (the milestone):** from `__cosmos.ready` start outside the
     Milky Way (universe context), trigger a scripted continuous descent to Sol then
     Earth; assert the full flight completes within 60 s, ends with
     `contextId === 'system'` and the Sol system anchored, and **no full-screen
     loading/blank frame appears at any scale boundary** (sample frames; assert no
     frame is uniformly the background color after `ready`).
   - **Streaming caps (§5.8 instrumentation):** throughout the flight,
     `__cosmos.streaming.inFlight` never exceeds the pool/budget cap (6),
     `renderedPoints ≤ 2_000_000` at tier 'high', `drawCalls ≤ 300`.
   - **Context chain:** the flight passes `universe → galaxy → system` switches in
     order (the existing ctxswitch hook records them); each switch shows no visible
     snap (reuse the per-frame pixel-delta probe from TASK-030 — switch deltas ≤ the
     max ordinary flight delta).
   - **Quality tier:** forcing a throttled CPU/GPU (CDP) drops `__cosmos.qualityTier`
     from 'high' before frames drop (perf trace shows tier change precedes any long
     task).
   - **Perf smoke:** during the descent, p95 frame < 50 ms, zero frames > 250 ms
     (CI-relaxed; reference-machine ≥ 55 fps is TASK-041's gate).
2. `pnpm verify` exits 0; `smoke`/`flythrough`/`m1`/`m2`/`jitter`/`ctxswitch`/
   `context-loss` specs still green (M1/M2 behavior unchanged); bundle gate green
   (main bundle under budget; worker is a separate chunk).
3. Manual checklist in the PR (desktop dev machine): the signature continuous zoom
   reads smoothly with no loading screen at any boundary; spiral arms resolve into a
   star field which resolves into Sol; quality drops gracefully under load; memory
   does not climb during a 2-min free flight (TASK-041 does the 10-min soak).

## Deliverables

- `apps/web/src/workers/cosmos.worker.ts` (worker entry: `serveWorker` + handlers),
  `apps/web/src/scene/GalaxyScene.tsx` (streaming-driven octree/galaxy mounts +
  per-frame offsets/opacities + picking), `apps/web/src/glue/streaming.ts`
  (pool + policy + onChunk → mount registry + nearest-surface feed),
  `apps/web/src/glue/local-group.ts` (galaxy anchor scan), `apps/web/src/glue/
  quality.ts` (controller → streaming tier + post chain), `apps/web/src/App.tsx`
  (octree pack load + providers), `apps/web/src/scene/NavDriver.tsx` (galaxy
  anchor-scan addition)
- `apps/web/package.json` (workspace deps: workers, procgen, streaming,
  render-galaxy)
- `e2e/tests/m3.spec.ts` + new baselines

## Context Files

- `docs/architecture.md` §3 (per-frame data flow), §5.8, §5.9, §5.13, §6 (M3), §9, §10
- READMEs of every consumed package (streaming, workers, procgen, render-galaxy,
  data v3, nav v4, scene-host v1.2)
- `apps/web/src/` current M2 wiring (extend, don't rewrite) —
  `src/scene/SystemScene.tsx`, `src/scene/StarScene.tsx`, `src/scene/NavDriver.tsx`,
  `src/glue/*`
- `docs/agent-tasks/TASK-029-m2-integration.md` (the integration pattern + `__cosmos`
  hooks to extend), `TASK-037-universe-context.md` (galaxy anchor precondition order)
- `e2e/README.md` (baseline recording procedure), `e2e/tests/ctxswitch.spec.ts`
  (the pixel-delta probe to reuse)
