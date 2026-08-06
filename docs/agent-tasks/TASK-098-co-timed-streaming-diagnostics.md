# TASK-098: Add a co-timed galaxy working-set snapshot

**Initiative:** visibility-aware galaxy streaming (VIS-02)  
**Size:** M  
**Class:** additive read-only diagnostics  
**Depends on:** TASK-097 (hard block: the snapshot must call production photometry)

## Goal

Expose one synchronous `window.__cosmos.galaxyWorkingSet()` query that captures the live camera,
streaming target/residency, current draw set, culls, exposure profile, perceptible point count,
and errors in one call. This replaces comparisons between unrelated ≤4 Hz mirrors and gives
TASK-099's replay/baseline work a production-state oracle.

The query may allocate and scan resident drawn batches when explicitly called. It must add zero
per-point work and zero collection allocation to the normal frame loop.

## Step 0 — verify the spec's facts

Re-confirm these facts before editing. If one is false, STOP and update this spec.

1. `apps/web/src/glue/test-hook.ts` still mirrors `streaming.*` and exposure at ≤4 Hz, while live
   getters delegate directly to production holders.
2. `packages/streaming/src/policy.ts` still has local target selection each `update()`, exposes
   aggregate `stats`, and marks current desired chunks with a private epoch; it does not persist
   a target-key array for diagnostics.
3. `apps/web/src/glue/octree-pick-feed.ts` still publishes exactly the current draw/pick octree
   mounts as `{ chunkId, batch }`, with `batch.originPc` and tile-local `positionsPc`.
4. `frustumCullStats` and `brightnessCullStats` are still exported from
   `GalaxyScene.tsx`, while `GalaxyScene.tsx` imports `procgenOpacityHolder` from `test-hook.ts`.
   A reverse import from `test-hook.ts` would form a module cycle and is forbidden.

## Context — read first

- `docs/testing-conventions.md` — tests query real state and do not reconstruct camera,
  projection, or photometry.
- `docs/research/e2e-ci-flakiness-rootcause-and-query-hook.md` — live closure/holder precedent.
- `docs/research/bug-10-streaming-density-wall.md` — diagnostics must distinguish selection,
  queueing, residency, and rendering.
- `docs/agent-tasks/TASK-095-NOTES.md` — containment normalization was killed; diagnostics remain
  observe-only.
- `apps/web/src/glue/test-hook.ts` — the only public e2e query seam.
- `apps/web/src/glue/octree-pick-feed.ts` — actual post-cull octree draw set.
- `packages/streaming/src/policy.ts` — source of authoritative target/residency state.
- `packages/photometry/src/index.ts` — production perceptibility oracle from TASK-097.

## Frozen — do not touch

- Streaming selection, lifecycle, request ordering, budgets, cancellation, coverage, eviction,
  culling, rendering, picking, and exposure behavior.
- Existing `testHook.streaming` mirrors and e2e consumers remain compatible.
- TASK-095 antichain behavior stays disabled; this task only reports containment.
- No future concepts in this snapshot: no prefetch nodes, prefetch epochs, bands, band bytes, or
  band completeness.
- The snapshot reports actual current data; it does not estimate hypothetical v2 savings.
- Camera values come from the live production camera/controller closure, never reconstructed
  from a test.
- Perceptibility comes from `@cosmos/photometry`, never copied into test-hook or tests.

## Out of scope

- Changing mode/UI behavior (VIS-05) or pick semantics (VIS-06).
- Implementing candidate selectors, frustum margins, prefetch, or fallback (VIS-07+).
- Adding octree v2 metadata or pack readers.
- Per-frame telemetry, remote analytics, screenshots, or performance timing gates.
- Optimizing the explicit query before measurement proves it necessary.

Findings during this task go to `docs/research/`; scope creep goes to a new task file, not
into this diff.

## Deliverables / steps

**Log every judgment call — anything this task didn't decide and you had to — to
`docs/agent-tasks/TASK-098-NOTES.md` beside the diff, visibly, as you go (not reconstructed
after).**

1. Add an exported read-only diagnostics type and method to `@cosmos/streaming`:
   `StreamingPolicy.diagnosticsSnapshot()`.
   - Keep the existing `desiredEpoch` write on every visited node.
   - Add scalar `targetEpoch` to a chunk and set it to the current frame exactly when that chunk
     is pushed to `targetList`.
   - Increment and expose an integer `updateSequence` once at the end of each completed
     `update()`.
   - Count `visitedOctreeNodes` inside production selection using scalar increments only.
   - Build detailed `desired` and `target` arrays only when queried by scanning chunk records:
     `target` is exactly records with `targetEpoch === frame`; `desired` is exactly records with
     `desiredEpoch === frame`.
   - Each record reports ID, kind, lifecycle state, `selectionPointCount`
     (`Chunk.pointCount`: octree manifest count or procgen star count),
     `decodedPointCount` (`batch.count` when ready, otherwise `null`),
     `gpuBytesEstimate` (zero unless ready), `cpuTypedArrayBytes`
     (ready batch byte total, otherwise `null`), and `coveredByReadyAncestor`.
   - Return target/desired selection-count aggregates separately from ready decoded-count,
     CPU-byte, and GPU-byte aggregates.
   - Do not persist or allocate a target/desired-key array each frame.
2. Move `frustumCullStats` and `brightnessCullStats` from `GalaxyScene.tsx` into a neutral
   `apps/web/src/glue/galaxy-render-diagnostics.ts` holder imported by both scene and test hook.
   After publishing the post-cull pick feed, increment `renderSequence` and copy the live
   streaming `updateSequence` into `policyUpdateSequence`. Preserve existing imports/exports
   through compatibility re-exports if tests import the old symbols.
3. Extend the existing `PickProbe` registered by `StarScene` with `snapshotCamera()`:
   - position/context from `controllerRef.current.state.position`;
   - quaternion from `controllerRef.current.state.orientation`;
   - vertical FOV degrees and aspect;
   - CSS rectangle from `gl.domElement.getBoundingClientRect()`;
   - drawing-buffer dimensions from the live WebGL renderer/canvas.
   The values are copied synchronously. Return `null` without a controller or unless context is
   galaxy. Do not use floating-origin `camera.position` as the logical galaxy position and do
   not add a second camera model.
4. Add a pure app-glue aggregation function that receives the live camera snapshot, current
   `octreePickHolder` batches, active profile, and effective exposure, then returns:
   - drawn tile count and exact drawn point count;
   - perceptible drawn point count via `starIsPerceptible`;
   - minimum/maximum finite apparent magnitude among perceptible points;
   - count of malformed/non-finite points skipped.
   Convert each tile-local position to camera-relative parsecs as
   `batch.originPc + positionsPc - cameraPosition`; this is data plumbing, not a reimplementation
   of projection or photometry.
5. Add `galaxyWorkingSet(): GalaxyWorkingSetSnapshot | null` to `CosmosTestHook`.
   - Return `null` unless the active context is galaxy and camera, policy, and octree draw-feed
     holders are all ready.
   - In one synchronous call, read camera, policy diagnostics, render holder, current settings,
     Natural profile (until VIS-05 lands), catalog coverage, procgen opacity, and live error
     counters.
   - Read the policy snapshot first and return `null` unless
     `renderHolder.policyUpdateSequence === policySnapshot.updateSequence`.
   - Add `galaxyWorkingSetSettled(maxFrames = 8): Promise<GalaxyWorkingSetSnapshot | null>`
     beside it: await one animation frame and retry `galaxyWorkingSet()` up to `maxFrames`
     times, resolving with the first non-null snapshot and `null` after the budget. This exists
     because a co-timing miss is a **timing** condition, not a defect — a one-shot caller that
     lands between the policy update and the render publish would otherwise turn a healthy app
     into a hard e2e failure. The synchronous single-shot query stays exported and unchanged;
     the retry wrapper never loosens the equality check, and each attempt still performs exactly
     one snapshot.
   - Include `updateSequence`, copied `policyUpdateSequence`, and `renderSequence` for logging.
     Never compare `renderSequence` numerically with `updateSequence`; they are unrelated clocks.
   - Include raw slider exposure, profile ID, effective octree exposure, cull counters, target
     entries, residency/byte aggregates, draw/perceptibility aggregates, coverage, failed chunks,
     and central error counts.
   - Every returned array/object is a copy; callers cannot mutate policy or batch state.
6. Put aggregation in `apps/web/src/glue/galaxy-working-set.ts` with tests beside the app glue,
   and add unit tests for the streaming snapshot using small production-shaped fixtures. Tests
   call production functions; they do not duplicate byte accounting or photometry. Extend
   `apps/web/vitest.config.ts` coverage include to cover both `octree-combined.ts` and
   `galaxy-working-set.ts`, retaining the existing 90% statements threshold.
7. Add one deterministic e2e test that first waits on the existing low-frequency mirror until
   `streaming.loadedChunks > 0`, `streaming.pendingCount === 0`, and
   `streaming.inFlight === 0`; then wait two animation frames and call
   `galaxyWorkingSetSettled()` once (its internal budget is the only retry — do not add a
   Playwright poll loop around the expensive query, and do not raise `maxFrames` to mask a real
   co-timing bug). Log the whole chosen pose/profile plus measured counts on failure, including
   the attempt count consumed, and assert:
   - non-null snapshot and finite camera/profile values;
   - `target.length === policy.cutSize`;
   - every target ID also occurs in `desired`, and `desired.length >= target.length`;
   - aggregate selection/decoded counts and bytes are non-negative and IDs are unique per array;
   - `perceptibleDrawnPoints <= drawnPoints`;
   - malformed count is zero for committed packs;
   - failed chunks and new error counts are zero.
   Do not assert machine-specific wall-clock duration or incidental full-pack counts.
8. Update `docs/testing-conventions.md` §3 with one sentence: expensive, one-shot live snapshot
   queries are permitted when they ask production code and are not called from a frame callback.

## Failure modes to watch

1. **Per-frame allocation disguised as diagnostics.** Persisting target arrays or scanning stars
   in `update()`/`useFrame` adds the very work being measured. Detection: code review plus a unit
   spy proving `diagnosticsSnapshot()` performs the scan only when called.
2. **A module cycle through `GalaxyScene`.** `GalaxyScene` already imports the test-hook holder.
   Detection: neutral diagnostics module and clean build; test-hook never imports a scene module.
3. **Mixed-time mirrors.** Reading `testHook.cameraPosition` or `testHook.streaming` would combine
   stale ≤4 Hz values. Detection: implementation reads live holders inside one query and accepts
   only a render holder stamped with the same copied policy update sequence.
4. **Counting resident rather than drawn tiles.** Hidden/frustum/brightness-culled mounts are not
   the render/pick set. Detection: aggregate only `octreePickHolder.current`, whose producer is
   the post-cull scene path.
5. **Re-derived visibility math.** A local formula will drift from shader/CPU contract.
   Detection: aggregation imports `starIsPerceptible`; no `pow(10, ...)` appears in test-hook or
   its tests.

## Acceptance gate

- `pnpm --filter @cosmos/streaming test` exits 0.
- `pnpm --filter @cosmos/web test` exits 0.
- `pnpm typecheck` and `pnpm lint` exit 0.
- Build web, then run the new spec directly:
  `pnpm --filter @cosmos/web build && pnpm --filter @cosmos/e2e test:gate --project=chromium tests/galaxy-working-set.spec.ts`.
- Run `pnpm test:e2e` once for regression evidence. Any new failure blocks; only the documented
  pre-existing `flythrough4` near-Sol cap failure may remain known-red.
- Existing e2e specs compile and run unchanged.
- Source inspection confirms no new array/object creation or batch scan in
  `StreamingPolicy.update()` or any `useFrame` callback; only scalar diagnostic writes are added.
- The e2e failure log contains camera pose/quaternion/FOV, profile/exposure, update/render
  sequences, target/ready/drawn/perceptible counts, bytes, and errors.

## Verification beyond the gate

On the full Gaia pack, call `galaxyWorkingSet()` once at a settled Sol view and once after a
90° turn. Record query duration as reference-machine information and verify the scene remains
responsive. Duration is not a CI gate; if the explicit query is too slow, log a follow-up task
rather than moving work into the frame loop.
