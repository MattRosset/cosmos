# Task: Per-tile frustum cull at DRAW time for the galaxy octree star field

**ID:** TASK-093
**Target package:** `apps/web` (`src/scene/GalaxyScene.tsx` + a new `src/glue/` pure module) and `packages/streaming` (one additive field on `VisibleChunk`)
**Size:** M
**Phase:** 4/5 (galaxy render tier)
**Depends on:** — (branch `task/gaia-search-by-source-id`; unblocks the failing `flythrough4` §5.4 gate)

## Goal

Near Sol the galaxy scene draws ~704k octree points across ~214 draw calls, but **95.5%
of those points are outside the camera frustum** (44% behind the camera, 51% lateral) —
measured, see `docs/research/near-sol-overdraw-frustum-culling.md`. `frustumCulled = false`
is set deliberately and correctly on every mount (the vertex shader positions each tile via
the `uRenderOffset` uniform, so three.js's bounding sphere reads every tile as at the origin
— there is **no** correct cull today). This task adds a **per-tile frustum test in the
`GalaxyScene` render loop** that hides (does not draw) octree tiles whose bounding sphere is
entirely outside the camera view, using the **real camera-relative tile center** the loop
already computes plus the tile's half-extent. Tiles stay STREAMED and MOUNTED — only their
draw visibility (`object.visible`) is gated — so rotating or approaching shows a tile the
very next frame with no pop-in and zero network/memory change. When done, the `flythrough4`
near-Sol drop gate passes again (scene draw calls + points at/under the committed M3
baseline), and a far-Sol park still draws the tiles the camera faces (behind-camera culled,
in-view kept).

This is **draw-time frustum culling only.** The orthogonal brightness/distance cull, the
selection-time (don't-fetch) cull, and reverting TASK-070's procgen-cap exclusion are all
explicitly out of scope (see below).

## Step 0 — facts to re-verify against live code before writing any diff

Code moves after specs are written. Re-confirm each of these by opening the file **now**; if
any is false, STOP and update this spec (global rule 1) rather than coding around it. Every
line number below was verified on 2026-08-05.

1. **The render loop and the deliberate no-cull.** `GalaxyScene.tsx` `useFrameContext(…,
   PRIORITY_RENDER)` at line ~486 iterates `streaming.visible`, looks each up in
   `mounts.current`, sets `m.seen = tick`, computes the camera-relative tile offset into
   `offScratch` (`origin.toRenderSpace(posScratch, offScratch)` then `*= unitsToPc` → the
   center in **parsecs**), and calls `m.applyFrame(...)` (line ~611/613) or, in the trailing
   pass (line ~619), `m.hide()` for mounts whose `seen !== tick`. `makeOctreeMount`
   (line ~189) sets `points.object.frustumCulled = false`. Confirm this structure — the cull
   inserts between `offScratch` scaling and `m.seen = tick`.

2. **The camera-relative tile CENTER is already computed and is the tile center.** A mount's
   `originPc` is the tile center: `packages/data/src/octree-decode.ts:13` sets
   `originPc: tile.centerUnits` (the octree node cube center, `core-types/src/octree.ts:116`).
   The render loop feeds `m.originPc` through `origin.toRenderSpace` → `offScratch`, then
   `offScratch[i] *= unitsToPc`. So **`offScratch` (post-scale) IS the camera-relative tile
   center in parsecs** — exactly the vector the cull needs. Do NOT recompute it.

3. **The tile HALF-EXTENT is NOT currently on the mount or on `VisibleChunk`.** The policy
   `Chunk` has `halfExtentUnits` (`policy.ts:158`, sourced from `node.manifest.halfExtentUnits`
   at `ensureOctreeChunk` line ~299), but the per-frame `view` object handed out through
   `streaming.visible` (`VisibleChunk`, `policy.ts:74`) carries only `{chunkId, kind, lod,
   opacity}`. This task adds `halfExtentPc` to that object (see Deliverables §1). In galaxy
   context 1 unit = 1 parsec, and the octree is always galaxy-context (`octree.context`), so
   `halfExtentUnits === halfExtentPc` for octree tiles — no conversion.

4. **The frustum-test convention already used in this repo.** `StarScene.tsx` `projectToScreen`
   (line ~336) and the star pick (line ~254/278) transform a context-frame camera-relative
   vector into camera space with `rotateByQuat(conjugate(orientation), rel)` (forward is
   `-Z`: `cz >= 0 ⇒ behind`), using `tanY = Math.tan(persp.fov * Math.PI / 360)` and
   `tanX = tanY * persp.aspect` off the live `PerspectiveCamera`. `orientation` is
   `controller.state.orientation` (a quaternion). **Follow this convention** — do NOT build a
   `THREE.Frustum` from the projection matrix (the floating-origin uniform makes three's world
   positions wrong — that is the whole reason `frustumCulled = false` exists). Note StarScene's
   local `rotateByQuat` (line ~47) **allocates** ("click-time only"); the per-frame cull must
   be allocation-free (Deliverables §2).

5. **Camera orientation is current-frame at PRIORITY_RENDER.** `NavDriver` runs at
   `PRIORITY_NAV - 1` (−201) and `origin` updates at `PRIORITY_COORDS` (−100), both before
   `PRIORITY_RENDER` (0) (`packages/scene-host/src/frame-loop.ts`). So `controller.state.orientation`
   and `offScratch` are the same-frame camera state the shader's `viewMatrix` uses — the cull
   sees exactly what the shader will draw.

6. **The gate and its committed baseline.** `e2e/tests/flythrough4.spec.ts` asserts the
   `toSol` segment's `peakSceneDrawCalls` ≤ `40` and `peakScenePoints` ≤ `109971` from
   `apps/web/src/scene/flythrough4-m3-baseline.json` (`_recorded: true`). These are
   `gl.info.render` totals (three.js JS counters, GL-backend-independent). Confirm the
   baseline still reads 40 / 109,971 and `_recorded: true`.

## Context files

- `docs/research/near-sol-overdraw-frustum-culling.md` — the measured evidence for this task
  (levers, shares, kill conditions). Read first.
- `apps/web/src/scene/GalaxyScene.tsx` — the render loop that gains the cull; §5.8 allocation
  discipline (module-scoped scratch, no per-frame `new`).
- `apps/web/src/scene/StarScene.tsx` (`projectToScreen` ~336, `rotateByQuat` ~47) — the
  world→camera / behind-camera / fov convention to mirror.
- `packages/streaming/src/policy.ts` (`VisibleChunk` ~74, `Chunk` ~149, `ensureOctreeChunk`
  ~290, `measure` ~268) — where `halfExtentPc` is populated on the reused `view` object.
- `apps/web/src/glue/procgen-draw-budget.ts` — the precedent for a DOM/THREE-free pure glue
  module under `src/glue/**` that the node-env vitest scope unit-tests directly (mirror its
  shape for the new cull function).
- `docs/research/goto-galaxy-transit-black.md` and
  `docs/research/galaxy-starfield-flyin-black-flush-during-flight.md` — prior "hid the octree
  and blanked the field" traps; the cull must not reintroduce them (Failure modes).

## Frozen Interface

The agent may NOT change these; a change here is a separate reviewed task.

```ts
// packages/streaming — the policy's public surface, EXCEPT the one additive field in
// Deliverables §1. Do not change existing VisibleChunk fields, StreamingStats, budgets,
// selectOctree/measure/enforceBudgets behaviour, or the §5.8 caps.
export interface VisibleChunk {
  readonly chunkId: string;
  readonly kind: ChunkKind;
  readonly lod: number;
  readonly opacity: number;
  // + readonly halfExtentPc: number;   ← the ONLY addition (Deliverables §1)
}

// The flythrough4 gate + baseline are FROZEN (TASK-053 forbidden actions): do not edit the
// thresholds (40 / 109,971), the baseline JSON, or e2e/tests/flythrough4.spec.ts to pass.
// If the gate cannot be met by culling, that is global rule 1 — STOP and report.

// TASK-070's enforceBudgets procgen-cap exclusion (policy.ts ~line 613, the `kind === 'octree'`
// filter on the point sum) is FROZEN here — do NOT revert it (separate later task).
```

## Inputs / Outputs

- **Input, per visible octree tile, per frame:** the camera-relative tile center in parsecs
  (`offScratch` after `*= unitsToPc`), the tile radius `radiusPc = v.halfExtentPc * √3` (the
  bounding sphere of the axis-aligned cube), the camera orientation quaternion
  (`controllerRef.current.state.orientation`), and `tanY = tan(camera.fov·π/360)`,
  `tanX = tanY·camera.aspect` from the live `PerspectiveCamera`.
- **Output:** a boolean "draw this tile?" For a culled tile: `m.hide()` and `continue`
  **without** setting `m.seen = tick` (so the trailing hide pass and the octree-pick publish
  both treat it as off-cut). For a kept tile: the existing `m.seen = tick` + `applyFrame(...)`
  path, unchanged.

## Deliverables / Steps (mechanical)

**Log every judgment call — anything this task didn't decide and you had to — to
`docs/agent-tasks/TASK-093-NOTES.md` beside the diff, visibly, as you go (not reconstructed
after).**

1. **Add `halfExtentPc` to `VisibleChunk` and populate it (zero-alloc).** In
   `packages/streaming/src/policy.ts`: add `readonly halfExtentPc: number` to the
   `VisibleChunk` interface (`~74`) and to the `Chunk.view` shape (`~178`). Set it once at
   creation: in `ensureOctreeChunk` (`~316`) set `halfExtentPc: node.manifest.halfExtentUnits`;
   in `ensureProcgenChunk` (`~350`) set `halfExtentPc: 0` (procgen is never culled). It is
   static per tile — do NOT write it per frame. Export nothing new. (No conversion: galaxy
   context units are parsecs; the octree is galaxy-context.)

2. **Add an allocation-free pure cull predicate in a new `src/glue` module.** Create
   `apps/web/src/glue/tile-frustum-cull.ts` (DOM/THREE-free, so it lands in the node-env
   vitest `src/glue/**` scope like `procgen-draw-budget.ts`). Export:

   ```ts
   /**
    * True ⇒ the tile's bounding sphere is ENTIRELY outside the view frustum (safe to skip
    * drawing). Conservative: never returns true for a sphere that touches the frustum, so a
    * tile straddling an edge is kept. Allocation-free (scalar math, no arrays).
    *
    * @param cx,cy,cz  camera-relative tile CENTER in the context frame (parsecs).
    * @param radiusPc  tile bounding-sphere radius (= halfExtentPc * Math.sqrt(3)).
    * @param q         camera orientation quaternion [x,y,z,w] (controller.state.orientation).
    * @param tanX,tanY tan of the HALF horizontal/vertical fov (tanY = tan(fov·π/360),
    *                  tanX = tanY·aspect).
    */
   export function tileOutsideFrustum(
     cx: number, cy: number, cz: number,
     radiusPc: number,
     q: readonly [number, number, number, number],
     tanX: number, tanY: number,
   ): boolean;
   ```

   Implementation (mirror `projectToScreen`, extended to a sphere):
   - Rotate `(cx,cy,cz)` by the **conjugate** `[-q[0], -q[1], -q[2], q[3]]` into camera space
     `(ex, ey, ez)` — inline the same scalar quaternion-rotate StarScene's `rotateByQuat`
     uses, writing into **locals** (no array). Forward is `-Z`, so view depth `d = -ez`.
   - **Behind plane (the trivial ~44% near-Sol / ~98% far cut):** `if (d < -radiusPc) return
     true;` (sphere entirely behind the camera).
   - **Side planes (the ~51% lateral cut — required to reach the gate; behind alone is not
     enough):** with the sec-factors that keep the test conservative,
     ```
     const sx = Math.sqrt(1 + tanX * tanX);
     const sy = Math.sqrt(1 + tanY * tanY);
     if ( ex - radiusPc * sx >  d * tanX) return true;  // beyond right
     if (-ex - radiusPc * sx >  d * tanX) return true;  // beyond left
     if ( ey - radiusPc * sy >  d * tanY) return true;  // beyond top
     if (-ey - radiusPc * sy >  d * tanY) return true;  // beyond bottom
     return false;
     ```
     The `√(1+tan²)` factors are LOAD-BEARING — they are the plane-normal lengths; dropping
     them culls slightly too aggressively at the edges and can blank a tile that is actually
     visible (a global-rule-3 correctness regression, not a perf win).

3. **Wire the predicate into the render loop, octree-only, allocation-free.** In
   `GalaxyScene.tsx`'s `PRIORITY_RENDER` loop: read the camera once per frame via
   `const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera` (add the selector at
   the top of the component alongside the existing `size`/`dpr` selectors) and compute
   `tanY`/`tanX` **once per frame** (not per tile) into loop-local consts. Inside the
   `visible` loop, for `m.kind === 'octree'` only, **after** `offScratch` is scaled to parsecs
   and **before** `m.seen = tick`, call `tileOutsideFrustum(offScratch[0], offScratch[1],
   offScratch[2], v.halfExtentPc * SQRT3, q, tanX, tanY)` (`SQRT3` = the module const defined
   at the end of this step). If true → `m.hide();
   continue;` (do not set `seen`). Use `controllerRef.current.state.orientation` for `q`;
   if `controllerRef.current` is null, skip the cull (draw as today — never cull without a
   camera). Procgen mounts skip the predicate entirely (their existing near-Sol `hide()` /
   `applyFrame` path is unchanged). Precompute `Math.sqrt(3)` as a module const
   (`const SQRT3 = Math.sqrt(3)`) — do not call `Math.sqrt` per tile for the radius.

4. **Verify no per-frame allocation.** The predicate takes primitives and the quaternion by
   reference and returns a boolean — no array/object created per tile. The per-frame `tanX`/
   `tanY` are number locals. Confirm nothing in the added path constructs a `THREE.Vector3`,
   array, or object inside the loop (architecture §5.8 / policy.ts scratch discipline).

5. **Unit test the predicate** (`apps/web/src/glue/tile-frustum-cull.test.ts`, node-env
   scope). Feed hand-constructed geometry against the identity orientation `[0,0,0,1]` (camera
   looks down `-Z`) and a rotated orientation, asserting the boolean — NOT re-deriving the
   projection (CLAUDE.md testing rule 1): a tile centered straight ahead (`0,0,-100`) is kept;
   directly behind (`0,0,+100`) is culled; far off to the side (`1000,0,-100`) is culled; a
   tile whose CENTER is just past the edge but whose RADIUS reaches back into the frustum is
   KEPT (proves the sphere/`√(1+tan²)` conservatism — the anti-regression case); a 90°-yaw
   orientation moves the "ahead" tile to the side and culls it. Log the chosen inputs so a
   CI-only failure is triagable from the log alone (CLAUDE.md §CI gate rule 6).

## Common Mistakes (architecture §5.8 + this area's history)

- Building a `THREE.Frustum`/`frustumCulled = true` — wrong under the `uRenderOffset` uniform
  (every tile reads as at-origin). This is the exact bug the whole design avoids.
- Culling **procgen** — the Milky Way cloud/impostor is one centered galaxy; it must draw
  whenever the layer is on. Gate the predicate on `m.kind === 'octree'`.
- Setting `m.seen = tick` before the cull test — a culled tile with `seen === tick` would
  survive the trailing hide pass AND get published to the octree pick surface. Cull BEFORE
  `seen`.
- Allocating in the loop (a `Vector3`, a returned array from a quat-rotate, a per-tile
  `Math.sqrt`). All scratch is scalar/module-scoped.

## Failure modes (mined from `docs/research/` + `git log -- GalaxyScene.tsx`)

- **"Hid the octree and blanked the field" (twice shipped, twice reverted).**
  `docs/research/goto-galaxy-transit-black.md`: an earlier `if (flying && kind==='octree')
  continue` blanked the real Gaia field for the whole of every goto (max luma 3/255). And the
  flush-during-flight fix (`galaxy-starfield-flyin-black-flush-during-flight.md`). The cull
  must hide **only tiles whose sphere is outside the frustum**, never a whole class of tile and
  never based on flight state. **Far-Sol acceptance below exists to catch exactly this.**
- **The gate is on `gl.info.render` totals, not policy stats.** The cull sets `object.visible
  = false`, which drops the draw from `gl.info.render` but does NOT change `streaming.stats`
  or `streaming.visible`. That is intended — do not try to also shrink the policy cut (that's
  selection-time culling, deferred). The `flythrough4` §5.8 stream caps (`peakRenderedPoints`
  ≤ 2M etc.) read policy stats and stay unchanged; the near-Sol clause reads `gl.info.render`
  and is the one that moves.
- **Draw-call clause may bind before the point clause.** The gate needs BOTH
  `peakSceneDrawCalls ≤ 40` and `peakScenePoints ≤ 109971`. The point drop is large (~704k →
  ~in-frustum), but the surviving in-frustum **tile count** sets the draw calls. On the parked
  15-s pathological cut the research saw 46 in-frustum tiles (> 40); on the transient `toSol`
  flythrough the cut is smaller. **STOP-case (global rule 1):** after implementing, MEASURE
  the `toSol` `peakSceneDrawCalls`/`peakScenePoints` via `?debug=flythrough4` (see
  Verification). If points pass but draws still exceed 40, do NOT weaken the gate, add margin
  reductions that cull visible tiles, or edit the baseline — record the measured draw count in
  the NOTES file and report it: the remaining lever is LOD-containment / cut-settling
  (research Lever 3, a separate task), not this cull.
- **Camera fov drift.** Use the **live** `PerspectiveCamera.fov/aspect` (what the shader
  projects with), NOT streaming's fixed `STREAM_VERTICAL_FOV_RAD` (60°) — the two can differ,
  and the streaming constant exists only because `policy.update` has no camera.
- **Universe context.** `streamingActive` includes `universe`; there `unitsToPc ≠ 1`.
  Because `offScratch` is scaled to parsecs and `halfExtentPc` is parsecs, the test stays
  consistent — do not special-case it, but do keep the test in parsec space (post-scale
  `offScratch`), never mixing render-units center with parsec radius.
- **1-frame-stale camera on a fast spin.** Even if orientation were a frame behind (it is not
  — Step 0 §5), a tile entering view draws the very next frame because it stays MOUNTED. So no
  network/stream latency and no pop-in. This is the core reason draw-time (not selection-time)
  culling is safe; do not add a stream-latency margin.

## Acceptance Tests (deterministic proxies only — CLAUDE.md §CI gate)

Done only when all pass in CI:

1. **`flythrough4` near-Sol drop restored.** `e2e/tests/flythrough4.spec.ts` passes
   unmodified: `toSol` `peakSceneDrawCalls ≤ 40` and `peakScenePoints ≤ 109971` (the
   currently-failing clause), with the §5.8 caps (in-flight ≤ 6, points ≤ 2M, draws ≤ 300)
   still green.
2. **No visible-tile regression — the gate is met by CULLING, not by an empty field.**
   Clause 1 already asserts the DROP deterministically (draws ≤ 40, points ≤ 109,971, vs the
   current failing values). This clause adds the other side: `toSol` `peakScenePoints > 0`
   (the in-view tiles the camera faces still draw). Assert it via the existing
   `flythrough4`/`__cosmos` hooks; if a new read is needed, add it through
   `window.__cosmos` (`apps/web/src/glue/test-hook.ts`), never re-deriving projection in the
   test (CLAUDE.md testing rule 1).
3. **Predicate unit test** (Deliverables §5) passes in the `pnpm verify` unit scope.
4. **`pnpm verify` green** (lint + typecheck + unit + build).
5. **Tripwire + error gates stay green.** `getErrorCounts().invariant` unchanged (TASK-090
   nav-budget tripwire) and the ~7 e2e specs asserting `errorCounts.total === 0` still pass
   — the cull only toggles `object.visible`, adds no `assertInvariant`, and must throw nothing.

Frame time / screenshots are reference-machine only, never a blocking check (CI runs
SwiftShader).

## Verification beyond the gate

- Run the near-Sol + far-Sol measurement to confirm the *mechanism* (not just the gate
  number): open `?debug=flythrough4` on the built preview, read `window.__flythrough4Result`,
  and log `segments.toSol.peakSceneDrawCalls`/`peakScenePoints`. Reproduce the research doc's
  parked-at-Sol and far-Sol (`goTo [6000,0,0]`) measurements via the Method notes in
  `docs/research/near-sol-overdraw-frustum-culling.md` §Method notes if a deeper before/after
  is wanted (the scripts are not committed — reproduce from the notes).
- Confirm far-Sol is NOT blanked: parked far from Sol facing toward Sol, the Sol-local tiles
  in front draw; facing away, they cull. This is the anti-regression the history above
  demands.

## Out of scope (do NOT do these here)

- **Brightness/distance cull** (research Lever 2, ~96% sub-visible) — a SEPARATE follow-up; it
  needs a per-tile min-absMag precomputed in the pack. Do not add any magnitude gate here.
- **Selection-time culling** (not fetching/mounting off-screen tiles) — deferred; draw-time
  only. Do not change `selectOctree`/`measure`/the cut.
- **Reverting TASK-070's `enforceBudgets` procgen-cap exclusion** (`policy.ts` ~line 613) —
  FROZEN; a later task gated on the brightness cull.
- **LOD-containment / cut-settling** (research Lever 3, ~14%) — separate task.

**Findings during this task go to `docs/research/` (a new writeup or an addendum to
`near-sol-overdraw-frustum-culling.md`); scope creep goes to a new task file, not into this
diff.**
