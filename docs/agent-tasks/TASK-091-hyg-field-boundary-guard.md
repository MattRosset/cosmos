# Task: Replace the magic-500 HYG guard with the field-boundary precondition (Fix A)

**ID:** TASK-091
**Target package:** `apps/web` (NavDriver + glue) — no package-API change
**Size:** M
**Phase:** 4
**Depends on:** TASK-090 (the nav-frame tripwire — lands first; this task removes the magic-500
guard, and the tripwire is what makes any regression during/after this change loud instead of a
silent bisect. One acceptance check below rides `getErrorCounts()`, which only has teeth with the
tripwire present.)

## Goal

The galaxy free-flight speed law stops using the magic `distFromSolPc > 500` proxy and the
`streaming.nearestBodyDistanceM` scalar. Instead it encodes the **real geometric precondition**:
when the camera is outside the HYG point cloud, feed the speed law an O(1) distance-to-the-cloud
scalar (large → controllable cruise); when inside, keep the existing fast HYG grid nearest-star.
This fixes both the ~90 ms void-walk stall AND the WASD-stuck symptom at a far Gaia park (parking
~2.8 kpc from Sol), removes two magic constants, and drops the galaxy speed law's dependency on the
streaming tile-AABB distance (which collapses to 0 inside a tile). This is **Fix A** from
`docs/research/hyg-void-nearest-robust-fix.md` §Decision (Fix B — bounds-aware `nearestStarIndex`
— is a recorded follow-up, TASK-092, NOT this task).

## Step 0 — facts to re-verify before writing code (code moves after specs)

Confirm each against the live tree; if any is false, STOP and reconcile in the spec (global rule 1),
do not improvise around it.

1. `NavDriver.tsx` galaxy branch (~lines 195-239): computes `distToField = hypot(cam - hygBounds
   center) - hygBounds.radius` (~208) and `distFromSolPc = hypot(cx,cy,cz)` (~209); the guard is
   `flight.goToActive || distToField > HYG_GRID_REACH_PC || distFromSolPc > HYG_SEARCH_MAX_FROM_SOL_PC`
   (~210-214); when guarded it prefers `streaming?.nearestBodyDistanceM` else falls back to
   `distToField`; otherwise it runs `stars.nearestStarIndex` inside `profileSpan('nav.hyg.nearestStarIndex', …)`.
2. **`hygBounds.radius` is the AABB half-diagonal** `Math.hypot(hx,hy,hz)` (NavDriver.tsx:129) — for
   a ~990 pc-radius cloud that is ~990·√3 ≈ **1715 pc**, i.e. ~725 pc LARGER than the true point
   extent. This is the load-bearing trap (see Failure modes #1): a guard on this radius leaves a
   990–1715 pc shell where the grid still walks empty rings. This task must switch to the **true
   max point radius from the cloud centre**, not the diagonal.
3. `HYG_SEARCH_MAX_FROM_SOL_PC = 500` (NavDriver.tsx:47) and `HYG_GRID_REACH_PC = 200*25 = 5000`
   (~38) are each used ONLY in that guard (grep to confirm no other reference). Both are removed by
   this task (the new single `distToCloud > margin` condition subsumes them).
4. `FlightController.setDistanceToNearestSurface(units)` (controller.ts:1163) feeds
   `targetSpeed = clamp(speedScale * distanceToNearestSurface, minSpeed, maxSpeed)` (controller.ts:1088)
   and clamps its input to `Math.max(units, 1e-30)` (1164). So a near-zero scalar ⇒ minSpeed ⇒
   effectively immobilized (this is the WASD-stuck mechanism the fix removes).
5. `streaming.nearestBodyDistanceM` is `max(0, distUnits - extentCurrent) * ctxMeters`
   (policy.ts:772-774) → **0 when the camera is inside a covered tile** (the far Gaia park sits
   inside its tile). This task must NOT feed it to the galaxy speed law. `streaming` stays used by
   the **universe** branch (NavDriver.tsx ~187) — leave that untouched.
6. `apps/web` has a vitest unit runner with existing glue tests (`apps/web/src/glue/*.test.ts` —
   e.g. `context-scale.test.ts`) — the home + precedent for the extracted pure functions below.
7. Parking a camera far is done via `FlightController.goTo({ target: UniversePosition, … })`
   (method at controller.ts:69, `GoToOptions` at :47; used at `M4aApp.tsx:161/176`) and the
   app-level `goto.goToPosition(pc)` that
   search fly-to uses (`StarApp.tsx:336`). The test hook (`apps/web/src/glue/test-hook.ts`) exposes
   `goToActive`, `cameraPosition`, `flightTarget` but NO command to park at arbitrary coords and no
   `distanceToNearestSurface` getter — this task adds those two thin hook members for the gate
   (see Deliverables).
8. `MIN_SURFACE_DISTANCE_PC = 1e-7` (NavDriver.tsx:30) — reuse for the clamp; do not change it.

## Frozen Interface (consume, do not modify)

```ts
// @cosmos/nav — the speed-law input
setDistanceToNearestSurface(units: number): void;   // units = pc in galaxy context
goTo(opts: GoToOptions): void;                        // used only by the e2e gate to park
// @cosmos/streaming — leave the universe-branch usage intact; do NOT wire it into galaxy speed law
readonly nearestBodyDistanceM: number;
```

No package public API changes. This is an `apps/web` internal-logic + test-hook change only.

## Deliverables / Steps

### 1. Extract `computeHygFieldBounds` (pure, glue) — fixes the √3 slack
`apps/web/src/glue/hyg-field.ts` (new):
```ts
export interface HygFieldBounds {
  /** cloud centre, absolute galaxy-frame pc */
  readonly cx: number; readonly cy: number; readonly cz: number;
  /** TRUE max distance from centre to any HYG point (pc) — NOT the AABB diagonal. */
  readonly maxRadiusPc: number;
}
export function computeHygFieldBounds(
  positionsPc: Float32Array, originPc: readonly [number, number, number], count: number,
): HygFieldBounds;
```
- Pass 1: AABB min/max → centre `(min+max)/2 + origin` (same centre the current code computes).
- Pass 2: `maxRadiusPc = max over points of hypot(point_abs - centre)`. Two O(count) passes in a
  once-run `useMemo` are fine (measured cost is negligible; the current code already does one pass).
- `count === 0` → centre = origin, `maxRadiusPc = 0`.
- Replace the inline `hygBounds` `useMemo` body in `NavDriver.tsx` with a call to this function.
  The returned shape changes (`radius` → `maxRadiusPc`); update the one call site.

### 2. Extract `galaxyFarFieldSurfacePc` (pure, glue, alloc-free) — the guard decision
`apps/web/src/glue/nav-speed-law.ts` (new):
```ts
/** Galaxy-context far-field speed-law scalar, or NaN meaning "camera is inside the HYG cloud —
 *  caller must use the HYG grid nearest-star instead". Zero allocation; arithmetic only. */
export function galaxyFarFieldSurfacePc(
  cx: number, cy: number, cz: number,
  bounds: HygFieldBounds, goToActive: boolean, marginPc: number, minPc: number,
): number;
```
Semantics (implement exactly):
- `distToCloud = hypot(cx - bounds.cx, cy - bounds.cy, cz - bounds.cz) - bounds.maxRadiusPc`.
- If `goToActive || distToCloud > marginPc` → return `Math.max(distToCloud, minPc)` (O(1) scalar;
  the caller SKIPS the grid — no walk).
- Else → return `NaN` (camera is inside/near the cloud; caller runs the grid nearest-star).

### 3. Wire into `NavDriver.tsx` (galaxy branch only)
- Add task-local `const HYG_FIELD_MARGIN_PC = 50;` (two 25 pc cells — a small hysteresis band so
  the branch does not flap frame-to-frame exactly at the cloud surface; both branches give ~equal
  scalars there). Remove `HYG_SEARCH_MAX_FROM_SOL_PC` and `HYG_GRID_REACH_PC`.
- Replace the guard block (Step 0 #1) with:
  ```ts
  const far = galaxyFarFieldSurfacePc(cx, cy, cz, hygBounds, flight.goToActive, HYG_FIELD_MARGIN_PC, MIN_SURFACE_DISTANCE_PC);
  if (!Number.isNaN(far)) { flight.setDistanceToNearestSurface(far); return; }
  ```
  then fall through to the EXISTING `profileSpan('nav.hyg.nearestStarIndex', …)` grid path,
  unchanged. No object literal is created in the callback (pass primitives; `hygBounds` is stable).
- Delete the `streaming?.nearestBodyDistanceM` usage in the galaxy branch. Do NOT touch the
  universe branch's use of it.

### 4. Test-hook additions (for the e2e gate) — `apps/web/src/glue/test-hook.ts`
Both go through NEW module-scoped holders in `test-hook.ts` (the pattern the file already uses for
`controllerHolder` / `jumpDistancePcHolder` / `procgenOpacityHolder`) — do NOT add getters to
`@cosmos/nav` or reach into `StarApp` internals from the hook (both violate Frozen / the file's
structure):
- **`distanceToNearestSurfacePc` read member.** The `FlightController` exposes only the *setter*
  `setDistanceToNearestSurface` — the value is a private closure var (controller.ts:1164), so there
  is NO controller getter to mirror and adding one is a frozen `@cosmos/nav` API change (forbidden).
  Instead: NavDriver writes the last galaxy scalar it feeds to a new `surfaceFeedHolder: { current:
  number }` in `test-hook.ts` (a zero-alloc primitive write each frame, exactly like
  `procgenOpacityHolder`); the hook getter returns `surfaceFeedHolder.current`.
- **`goToPosition(pc: readonly [number, number, number]): void` command.** The `goto` coordinator
  lives inside `StarApp`'s `useMemo` (StarApp.tsx:311) and today is reachable only via
  `handleGoToPosition` (:336) — the hook has no path to it. Add a `gotoHolder: { current:
  Pick<GoToCoordinator, 'goToPosition'> | null }` in `test-hook.ts`, set it in `StarApp` where
  `goto` is created (near :311/:324), and have the hook command delegate to
  `gotoHolder.current?.goToPosition(pc)` (a safe no-op before wiring).

## Constraints & Forbidden Actions

- **Do NOT keep the AABB-diagonal radius** as the field boundary (Failure modes #1). The boundary is
  the true max point radius from centre. No `radius` field survives on `HygFieldBounds`.
- **Do NOT feed `streaming.nearestBodyDistanceM` into the galaxy speed law** (Step 0 #5) — it is the
  0-collapse that caused WASD-stuck. Galaxy scalar = grid (inside) or `distToCloud` (outside) only.
- **Preserve the `goToActive` skip** (TASK-040 breadcrumb freeze): during animated flight the grid
  is not walked. `galaxyFarFieldSurfacePc` returns non-NaN when `goToActive` — do not regress this.
- **Preserve near-Sol WASD:** inside the cloud `distToCloud` is negative → it MUST NOT be fed as the
  scalar (would clamp to `minPc` → immobilize near Sol). The `NaN` sentinel forces the grid path
  inside; keep that path exactly as-is.
- **Do NOT implement Fix B here** — no change to `packages/data` `grid.ts` / `nearestStarIndex`, no
  bounds-aware primitive. That is TASK-092. This task only changes where/what NavDriver feeds.
- No allocations inside the frame-loop callback (architecture.md §5.8). `galaxyFarFieldSurfacePc` is
  arithmetic-only; the grid path is unchanged.
- No `Math.random()`. Do not modify `packages/core-types`.

## Failure modes (mined from `docs/research/`, `docs/learnings/`, and `git log -- apps/web/src/scene/NavDriver.tsx packages/data/src/grid.ts`)

1. **[THE trap] Using the AABB-diagonal radius as the boundary re-arms a smaller void walk.**
   `hygBounds.radius` today is ~√3× the true cloud radius (Step 0 #2). If the guard fires only when
   `hypot(cam-centre) > diagonalRadius`, the 990–1715 pc shell is treated as "inside" → the grid
   walks empty rings there (a bounded but real ~few-ms version of the 90 ms cliff). `maxRadiusPc`
   (true point extent) closes the shell. This is the single most important decision in the task.
   (Measured extents: `hyg-void-nearest-robust-fix.md` — packed HYG max 990 pc; void walk 93 ms at
   2835 pc, 0.001–0.002 ms in-field.)
2. **WASD-stuck returns if the scalar collapses.** `streaming.nearestBodyDistanceM = 0` inside a
   tile (Step 0 #5); `distToCloud < 0` inside the cloud. Feeding either where it is ~0 immobilizes
   flight (controller clamps to minSpeed, Step 0 #4). The whole point of Fix A is a LARGE outside
   scalar + the grid inside — verify both branches never feed ~0 in their own regime.
   (`docs/research/gaia-park-navigation-open.md` §1 is this exact symptom.)
3. **Breaking near-Sol free flight.** If `galaxyFarFieldSurfacePc` returns `distToCloud` (negative)
   instead of `NaN` when inside, near-Sol WASD immobilizes. The `NaN`→grid contract is load-bearing.
4. **Regressing TASK-040 breadcrumb freeze.** Removing the `goToActive` short-circuit re-introduces
   the animated-flight grid-walk freeze. Keep `goToActive` as a non-NaN (skip-grid) case.
   (`docs/research/TASK-040-breadcrumb-freeze.md`.)
5. **Off-centre cloud.** The HYG centre is not exactly Sol/origin. `maxRadiusPc` and `distToCloud`
   must both use the computed centre, not the origin — otherwise the boundary is skewed.
6. **The e2e park via `goTo` must actually arrive** before sampling. Wait on
   `__cosmos.goToActive === false` (as `breadcrumb-perf.spec.ts:84` does), then a short settle, then
   sample — sampling mid-flight reads a transient position.
7. **New-reachability gate gap** (LEARN Pattern 2): pre-TASK-070 nothing parked far, so nothing
   tested this vantage. The e2e park gate below is the spec that finally *visits* it; do not skip it.

## Acceptance Tests (DONE only when these pass in CI)

All deterministic — no wall-clock, no screenshots (reference-machine only per `CLAUDE.md` §CI gates).

1. **`apps/web/src/glue/hyg-field.test.ts`** (new):
   - A synthetic 990 pc-radius sphere of points (centre at origin) → `maxRadiusPc` ≈ 990 (± one
     cell), and explicitly **NOT** ≈ 1715 (asserts it is the point radius, not the AABB diagonal —
     the fix's teeth).
   - An off-centre cloud (e.g. centred at (300, 0, 0)) → `cx≈300`, `maxRadiusPc` = the true max
     distance from that centre.
   - `count === 0` → centre = origin, `maxRadiusPc === 0`.
2. **`apps/web/src/glue/nav-speed-law.test.ts`** (new) against `galaxyFarFieldSurfacePc`, using a
   bounds fixture with `maxRadiusPc = 990`, `marginPc = 50`, `minPc = 1e-7`:
   - Camera at (2835, 0, 0), `goToActive=false` → returns a number ≈ `2835 - 990 = 1845` (large,
     `> 100`), i.e. **not NaN** → proves the grid is skipped (no walk) AND the scalar is a cruising
     distance (WASD-unstuck).
   - Camera at (300, 0, 0) inside the cloud, `goToActive=false` → returns **NaN** (grid path).
   - Camera inside, `goToActive=true` → returns a non-NaN clamped scalar (grid skipped during
     flight — TASK-040 preserved).
   - Camera just outside the margin band vs just inside it → the NaN/non-NaN transition flips at
     `maxRadiusPc + marginPc`.
3. **`pnpm verify` green** (lint + typecheck + unit + build), including the no-alloc discipline.
   **NOTE — the environment-independent teeth live in the unit tests (#1, #2).** They test the
   actual production functions directly and go red without Fix A regardless of pack/coverage. The
   e2e below is *live integration confirmation*; its red-green teeth are environment-dependent, so
   it carries a mandatory pre-flight verification.
4. **`e2e/tests/gaia-park-speed-law.spec.ts`** (new, deterministic — reads counts + a scalar, NOT
   frame times): boot; `await __cosmos.goToPosition([2835, 0, 0])`; wait `__cosmos.goToActive ===
   false` (mirror `breadcrumb-perf.spec.ts:84`); settle a few frames; then assert BOTH:
   - `__cosmos.distanceToNearestSurfacePc > 100` — the speed law received a cruising distance at the
     park (Fix A). **Whether this goes RED on pre-fix HEAD is environment-dependent:** pre-fix, the
     `distFromSolPc > 500` guard prefers `streaming.nearestBodyDistanceM`, which is only ~0 if a
     Gaia octree chunk actually *covers* `[2835,0,0]`; on the default e2e pack (no dense
     `octree-gaia`) it may instead fall through to `distToField`(diagonal ~1715) ≈ 1120 > 100 and
     PASS pre-fix — a toothless green-on-both. **MANDATORY pre-flight:** before implementing, run
     this new spec against pre-fix HEAD and confirm the `distanceToNearestSurfacePc` assertion
     FAILS. If it passes pre-fix, the park coords / default pack do not reproduce the streaming-0
     path → STOP and reconcile (pick a park position + pack state where pre-fix genuinely feeds ~0,
     or rely on the unit tests for teeth and demote this to a smoke check — record the choice in
     NOTES.md). Do not ship a gate that is green on both trees.
   - `__cosmos.errorCounts.total === 0` (read the hook member, NOT a `getErrorCounts()` global — the
     browser has no such global; the hook exposes `errorCounts` at test-hook.ts:97/247). This is
     **regression protection, not red-green teeth**: pre-fix the 500-guard already skips the grid at
     the park so `errorCounts.total` is already 0 — the assertion cannot go red on pre-fix. Its
     value is that, once TASK-090's tripwire exists, a *future* regression that re-detonates the
     walk here fails this spec. Log both values so a CI failure is triagable from the run alone.
5. **Existing perf specs unregressed:** `breadcrumb-perf` / `breadcrumb-profile` (the Milky Way
   vantage, ~49 kpc, exercises the far branch) still pass. These are `@perf`/reference-machine and
   non-blocking, but confirm the guard change did not alter their deterministic assertions.

Every failing check must be triagable from logs alone: the e2e logs `distanceToNearestSurfacePc`
and `errorCounts.total` at the park; the unit tests name the camera position and returned scalar.

## Verification beyond the gate (reference-machine, non-blocking)

- On the dense `octree-gaia` pack (behind `.env.local`), Ctrl-K → `3946392046023296` → park at
  `[-2047, 192, -1952]` pc, and confirm interactively: the star is reachable, free flight cruises
  away from it (not stuck), FPS stays high, and the dev overlay shows no `nav.surfaceFeed` breach.
  (This is the live human confirmation of the same behaviour the unit + e2e gates prove
  deterministically.)

## Context Files

- `apps/web/src/scene/NavDriver.tsx` — the galaxy surface feed + `hygBounds` `useMemo` (the change site).
- `docs/research/hyg-void-nearest-robust-fix.md` — measured extents + §Decision (Fix A rationale, the √3 slack).
- `docs/research/gaia-park-navigation-open.md` — §1 WASD-stuck (streaming-0), the symptom this also fixes.
- `docs/research/TASK-040-breadcrumb-freeze.md` — why `goToActive` must stay a skip case.
- `packages/nav/src/controller.ts` — `setDistanceToNearestSurface` / `targetSpeed` (why ~0 immobilizes).
- `packages/streaming/src/policy.ts:772-774` — why `nearestBodyDistanceM` is unfit (0 inside tiles).
- `apps/web/src/glue/test-hook.ts` — the hook to extend (`goToPosition`, `distanceToNearestSurfacePc`).
- `apps/web/src/glue/context-scale.test.ts` — glue unit-test precedent to mirror.
- `docs/agent-tasks/TASK-090-nav-frame-budget-tripwire.md` — the tripwire this rides for check #4.

---

**Log every judgment call** — anything this task didn't decide and you had to — to `NOTES.md`
beside the diff, visibly, as you go (not reconstructed after).

**Standing rule:** Findings during this task go to `docs/research/` (or wherever this repo keeps
investigation writeups — create it if there is none); scope creep goes to a new task file, not into
this diff.
