# Task: Settle galaxy-octree LOD ownership into a coverage antichain

**ID:** TASK-095  
**Target package:** `packages/streaming` (`src/lod-coverage-antichain.ts` new,
`src/policy.ts` wiring, package tests) plus additive, log-only diagnostics in
`apps/web/src/scene/Flythrough4Probe.tsx` and `e2e/tests/flythrough4.spec.ts`  
**Size:** M  
**Phase:** 4/5 (galaxy render tier)  
**Depends on:** TASK-093 (`a020d68`) and TASK-094 (`3a473f8`) — hard blocks; this task is
their measured Lever-3 follow-up.  
**Provenance:** written 2026-08-05 from live code at `3a473f8`, the two TASK-094 local
runs, `near-sol-overdraw-frustum-culling.md` Lever 3, the historical blank-sky
writeups, and `git log` for `policy.ts`, `GalaxyScene.tsx`, `Flythrough4Probe.tsx`, and
`flythrough4.spec.ts`. Spec-review pass 2026-08-05 (all eight checks against live
code) — fixed hot-path Morton allocation/BigInt regression, visible-vs-ownership
crossfade overclaim, Goal/STOP/Acceptance contradiction, navigation-signal drift,
impossible reverse-readiness fixture, stale procgen-consumer wording, picking
semantics, co-timed logging, and the integer 10% bound.

## Goal

Determine whether research Lever 3 can restore the frozen `flythrough4` §5.4
`toSol` gate:
`peakSceneDrawCalls ≤ 40`, `peakScenePoints ≤ 109971`, and
`peakScenePoints > 0`, after TASK-093's frustum cull and TASK-094's brightness cull
both fired but did not close it. TASK-095 addresses only research Lever 3: a ready
coarse fallback and its ready fine descendants currently coexist in `coverageList`
while a mixed-ready subtree streams. The result after this task is an
**ordering-independent coverage-ownership antichain**: whenever a coarse tile is
required to cover any unready target, that coarse representation temporarily owns
its whole subtree. The rendered `visible` set may retain ancestor/descendant overlap
during the frozen 300 ms crossfade and becomes containment-free only after that fade
settles; this task does not claim instantaneous containment-free rendering.

There are two valid terminal outcomes. **A — killed premise:** if Lever 3's
optimistic co-timed upper bound cannot close both clauses with ~10% local headroom,
ship no behavior change; record the research-only result and close TASK-095 despite
the pre-existing red §5.4 gate. **B — viable lever:** if the checkpoint passes,
implement the antichain and require the frozen §5.4 gate to pass. If the semantics
are correct but the gate stays red, do not ship the behavior under this task unless
a separately reviewed product-value decision explicitly authorizes it.

The bifurcation is mandatory because the only existing containment measurement is a
parked-at-Sol snapshot (30/213 tiles, 14.1%), while the failing gate is a transient
approach and is 24–48 draws plus ~309k–476k points over its limits.

## Step 0 — facts to re-verify against live code before writing any diff

The spec was written against commit `3a473f8` on 2026-08-05. Re-confirm every fact
below now. If any is false, STOP and update this spec (or mark blocked); do not
improvise around drift.

1. **Selection and coverage are separate phases.** In
   `packages/streaming/src/policy.ts`, `selectOctree()` (~491–532) chooses an SSE-only
   `targetList`; every visited node gets `desiredEpoch = frame`, but only stopped
   nodes enter the cut. `buildCoverage()` (~563–605) then chooses a ready
   representation per target. This task may change the coverage representation; it
   must not change `selectOctree`, `measure`, `targetList`, request dispatch, or fetch
   eligibility.

2. **The overlap is created by exact live behavior.** For every target,
   `buildCoverage()` (~571–601) calls `addCoverage(target)` when ready; otherwise it
   walks `parentKey()` until the nearest ready ancestor and calls
   `addCoverage(ancestor)`. `addCoverage()` deduplicates equal keys via
   `coverageEpoch`, but it does not reject ancestor/descendant pairs. Therefore
   `{ready child B, unready sibling C, ready parent P}` produces `{B, P}`.

3. **Budget collapse already demonstrates the safe direction.**
   `enforceBudgets()` (~615–687) replaces deeper covered nodes with a ready parent,
   never the reverse. It preserves a child when its parent is unavailable
   (`!parent || parent.status !== 'ready'`), then compacts `coverageList` using
   `coverageEpoch === frame`. TASK-095 follows this coarse-dominates-descendants
   precedent after `enforceBudgets`; it does not introduce “drop the fallback and
   hope.”

4. **Opacity and `visible` follow `coverageEpoch`.** After coverage and budgets,
   policy step 6 (~763–774) drives each chunk toward opacity 1 iff
   `coverageEpoch === frame`; step 7 (~776–796) emits every ready chunk with
   `opacity > 0`. A policy-side ownership antichain therefore makes
   `streaming.stats.drawCalls` and `gl.info.render` converge to the normalized set
   after the existing 300 ms crossfade; it does not remove transitional overlap
   instantly. A draw-only hide in `GalaxyScene` would leave policy stats and the
   coverage state lying about the representation; reject it.

5. **The Morton primitives already exist, but must not run in the update hot path.**
   `@cosmos/core-types`
   `decodeMortonKey`, `encodeMortonKey`, and `parentCell` define keys as
   `"<level>/<mortonDecimal>"`; `policy.ts` has a local `parentKey()` (~273–277).
   The new pure module belongs in `packages/streaming/src/`, not `apps/web/src/glue/`,
   because it is coverage-policy logic and the package already exports/test-drives
   pure helpers (`sse.ts`, `crossfade.ts`, `lru.ts`). `parentKey()` currently runs
   only on loading/budget paths. `m1-metal-boot-and-flyin-stall-rootcause.md` measured
   repeated Morton BigInt conversion as a major `streaming.update` stall, and BUG-10
   removed repeated inner-loop `parentKey` work. Cache each octree chunk's
   `parentId` once at creation; the antichain pass must walk cached IDs with no
   decode/encode, new strings, or allocations per update.

6. **Coverage semantics must remain availability, not fine-detail semantics.**
   `catalogCoverage()` (~124–138, ~604) is area-weighted and counts a target covered
   when it or a ready ancestor covers the region. It is consumed by the monolith
   gate (`StarScene.tsx` ~181–193) and by GalaxyScene's controller-absent procgen
   fallback; normal controlled galaxy procgen opacity is distance-driven
   (`GalaxyScene.tsx` ~584–595). Rendering a coarse fallback alone still means
   “catalog covers this region”; TASK-095 must not reduce `_catalogCoverage` merely
   because fine siblings are temporarily suppressed.

7. **Current measured starting point is the two-run TASK-094 STOP, not the parked
   research frame.** `docs/agent-tasks/TASK-094-NOTES.md` records:

   | metric | TASK-093 | TASK-094 run 1 | TASK-094 run 2 | frozen gate |
   |---|---:|---:|---:|---:|
   | `peakSceneDrawCalls` | 121 | 64 | 88 | ≤ 40 |
   | `peakScenePoints` | 494,037 | 419,298 | 585,808 | ≤ 109,971 |
   | `peakFrustumKept` | 90 | 88 | 135 | — |
   | `peakFrustumCulled` | 142 | 142 | 150 | — |
   | `peakBrightnessCulled` | — | 80 | 104 | — |
   | derived `kept − brightnessCulled` | — | 8 | 31 | — |

   These are independent frame maxima; never subtract their peaks and claim a
   co-timed frame result. Coverage was `1.00..1.00` in both runs.

8. **The gate and diagnostics surfaces are live.**
   `flythrough4-m3-baseline.json` has `_recorded: true`, draws 40, points 109971;
   `e2e/tests/flythrough4.spec.ts` (~226–254) gates `toSol` total-scene
   `gl.info.render` and the `> 0` anti-blank clause.
   `Flythrough4Probe.tsx` imports the TASK-093/094 stats, zeroes fields in
   `newSegmentAccum()`, takes per-frame maxima, and publishes
   `window.__flythrough4Result`. TASK-095 diagnostics mirror that shape and remain
   log-only.

9. **Testing scope, navigation, and zero-allocation doctrine.**
   `nearestBodyDistanceM` is currently computed only from
   `coverageEpoch === frame` chunks (~791–794) and feeds the galaxy/universe speed law
   in `NavDriver.tsx`; the visible loop's earlier `opacity <= 0` guard is also part of
   that current behavior. Changing it is not part of containment. Keep
   `coverageEpoch` and `coverageList` as the post-budget availability/nav state, add a
   separate reused `renderEpoch` for antichain ownership, and compute navigation from
   the **hypothetical pre-antichain coverage fade** before applying the real render
   fade.
   `packages/streaming` runs Vitest
   over package tests with V8 statement coverage ≥85%; existing integration fixtures
   are in `test/policy.test.ts`, `test/coverage.test.ts`, and
   `test/helpers/`. The steady-state policy update reuses scratch. Parent-key strings
   while a cut is loading are already sanctioned rare allocations; do not add
   per-frame `Set`, `Map`, `Array.from`, callbacks allocated inside loops, or a
   second model of production logic in the test.

## Context — read these first

- `docs/research/near-sol-overdraw-frustum-culling.md` — Lever 3 mechanism,
  30/213 (14.1%) parked containment, nine distinct ancestors, and fix direction #4.
- `docs/agent-tasks/TASK-094-NOTES.md` — the two measured STOP runs that seed this
  task and the warning that diagnostic peaks are not co-timed.
- `docs/agent-tasks/TASK-093-NOTES.md` — why parked Sol (~46 in-frustum) and the
  `toSol` approach (90 kept) are different camera regimes.
- `docs/agent-tasks/TASK-094-galaxy-tile-brightness-cull.md` — required spec shape,
  Frozen surfaces, ≥2-run rule, ~10% rule, and STOP-or-record discipline.
- `packages/streaming/src/policy.ts` — the only behavior insertion point:
  `buildCoverage` → `enforceBudgets` → antichain → crossfade → `visible`.
- `packages/streaming/test/coverage.test.ts` — controlled-ready-state fixture and
  current “ready coarse ancestor covers unready child” contract.
- `packages/streaming/test/policy.test.ts` — settled draw-cap and anti-hole
  precedents.
- `packages/core-types/src/octree.ts` — authoritative Morton writer/reader and
  `INTERNAL_TILE_POINTS = 4096`; use its helpers.
- `apps/web/src/scene/Flythrough4Probe.tsx` and
  `e2e/tests/flythrough4.spec.ts` — total-scene measurement and additive logging.
- `docs/research/m4a-drawcall-budget-transient.md` — why a transient hole is worse
  than a small overage and why frame-sampled peaks at a boundary vary.
- `docs/research/goto-galaxy-transit-black.md`,
  `docs/research/galaxy-starfield-flyin-black-flush-during-flight.md`, and
  `docs/research/gaia-far-fly-quality-collapse.md` — historical blank-sky traps.
- `docs/testing-conventions.md` — deterministic proxies, real-state queries, and
  logs sufficient for CI triage.

## Frozen — do not touch

Changing any item below requires a separate, explicitly reviewed thaw task. If this
task appears to need one, STOP and mark blocked.

```ts
// flythrough4 §5.4, total-scene gl.info.render on `toSol`:
peakSceneDrawCalls <= 40;
peakScenePoints <= 109971;
peakScenePoints > 0;

// TASK-094:
TILE_VISIBILITY_FLOOR = 0.004;

// StarScene:
MONOLITH_COVERAGE_GATE = 0.9;

// TASK-070 policy fix:
// enforceBudgets point sum remains octree-only; procgen is excluded.
```

Also frozen:

- `flythrough4-m3-baseline.json`, `_recorded`, the flight path, segment boundaries,
  warmup, and all existing e2e assertions.
- TASK-093 frustum predicate/order/diagnostics and TASK-094 brightness
  predicate/order/diagnostics.
- `selectOctree`, `measure`, SSE threshold/hysteresis, `targetList`, request priority,
  `maxInFlight`, cancellation, fetch/decode/mount behavior, LRU, and budget values.
- `catalogCoverage()`'s area-weighted “target or ready ancestor” meaning.
- `DEFAULT_CROSS_FADE_MS` and `advanceFade`.
- `nearestBodyDistanceM` semantics: antichain ownership must not change the
  post-budget distance candidates used by navigation.
- `packages/render-stars` and all star shaders.
- The goTo anti-blank behavior: mounted octree tiles remain visible during flight and
  deferred octree mounts continue flushing with their existing caps.
- Diagnostics may be additive and log-only. They may not become a new flaky CI
  threshold.

## Out of scope

- **Selection-time culling or a smaller fetch cut** (research direction 3):
  no frustum/brightness/readiness condition in `selectOctree`, no skipped requests,
  and no `targetList` rewrite.
- **Suppressing the ancestor fallback when only some descendants are ready.** That
  leaves the unready siblings with no catalog representation and repeats the
  blank-sky class of bugs.
- **Per-star clipping/discard, stencil masks, partial-tile rendering, or shader edits.**
- **Raising the brightness floor, changing exposure, margins, FOV math, or gate
  thresholds** to compensate if Lever 3 is too small.
- **Re-enabling the HYG monolith or procgen as an ad-hoc fallback.**
- **Changing tile format, internal-node decimation, pack contents, or regenerating the
  CDN pack.**
- **Reverting TASK-070's procgen-cap exclusion.**
- **General streaming performance cleanup** or replacing the existing crossfade.
- **Instantaneous visible-set containment removal.** The frozen crossfade may keep
  the outgoing representation visible for up to 300 ms; bypassing it is a thaw.

Findings during this task go to `docs/research/` (or wherever this repo keeps
investigation writeups — create it if there is none); scope creep goes to a new task
file, not into this diff.

## Chosen design (decided here; do not re-litigate)

The fix is **coverage-time, not draw-time and not selection-time**. It normalizes
ownership immediately; visible draws converge after crossfade.

For each frame, current code first creates a union of ready representatives: the
target itself when ready, otherwise its nearest ready ancestor. After
`enforceBudgets()`, normalize that union into an antichain:

> A covered octree chunk is dominated when any strict Morton ancestor also has
> `coverageEpoch === frame`. Dominated descendants keep availability coverage but do
> not receive `renderEpoch` ownership for this frame; the coarsest covered ancestor
> owns rendering.

Example:

```text
cut targets: B ready, C unready
nearest ready fallback for C: P
current coverage union: { B, P }
settled antichain:       { P }
```

`P` covers both sibling regions, so this cannot create a spatial hole. Fine-detail
ownership temporarily yields to the coarse representative until every target under
`P` is ready; then `P` is no longer added, children regain ownership, and the
existing crossfade performs the coarse→fine handoff. During either direction of that
handoff, both representations may remain in `visible` until the outgoing opacity
reaches zero.

Rejected alternatives:

- **Hide `P` when any descendant is ready:** directly blanks C's region.
- **Hide `P` only when every descendant is ready:** safe but a no-op for the measured
  mixed-sibling overlap; current `buildCoverage` already stops requesting `P` then.
- **GalaxyScene predicate over `streaming.visible`:** treats the symptom after policy
  stats, opacity targets, LRU pins, and nearest-body coverage have already been
  computed; unlike TASK-093/094, containment is owned and fully known by policy.
- **Modify `targetList`:** selection-time behavior explicitly frozen.

## Deliverables / Steps (mechanical)

**Log every judgment call — anything this task didn't decide and you had to — to
`docs/agent-tasks/TASK-095-NOTES.md` beside the diff, visibly, as you go (not
reconstructed after).**

### 1. Add the pure Morton ancestor helper

Create `packages/streaming/src/lod-coverage-antichain.ts` and export it through
`packages/streaming/src/index.ts`. Add `parentId: MortonKey | null` to `Chunk`,
computed once in `ensureOctreeChunk()` with core-types Morton helpers; procgen uses
`null`. Leave existing loading/budget `parentKey()` call sites unchanged; replacing
them is unrelated refactoring.

Required API:

```ts
import type { MortonKey } from '@cosmos/core-types';

export type MortonKeyPredicate = (key: MortonKey) => boolean;
export type MortonParentLookup = (key: MortonKey) => MortonKey | null;

/**
 * True iff `parentId` or one of its cached ancestors satisfies `isMarked`.
 * The original chunk key is never queried. null returns false.
 *
 * Performs no Morton parsing and allocates nothing; `parentOf` supplies the
 * creation-time cache.
 */
export function hasMarkedAncestor(
  parentId: MortonKey | null,
  parentOf: MortonParentLookup,
  isMarked: MortonKeyPredicate,
): boolean;
```

Do not expose a second `isDescendant` implementation based on hand-written BigInt
shifts. Do not allocate an ancestor array. Walk cached parents and return on the
first marked ancestor. The production callbacks are stable declarations created
once inside `createStreamingPolicy`, not closures allocated in the frame loop.

### 2. Instrument the optimistic ceiling before enabling behavior (mandatory go/STOP)

First wire an **observe-only** antichain pass after `enforceBudgets()` and before
crossfade. It must scan `coverageList`, use stable functions declared once inside
`createStreamingPolicy` to read cached `parentId` and query
`chunks.get(key)?.coverageEpoch === frame`, and compute current-frame:

- `containmentCandidates` — covered octree descendants with a marked strict ancestor.
- `containmentCandidatePoints` — their summed `pointCount`.

Expose both as additive read-only fields on `StreamingStats`. At this stage, do not
clear any `coverageEpoch`; behavior is unchanged. Add temporary local probe logging
(do not commit a new gate) that, on the same frame after `gl.render`, records the
optimistic lower bound:

```text
projectedDraws = max(0, sceneDrawCalls - containmentCandidates)
projectedPoints = max(0, scenePoints - containmentCandidatePoints)
```

This deliberately overestimates the saving because some policy candidates may
already be hidden by TASK-093/094. Therefore it is a valid **best-case kill test**,
not proof of success.

Run `flythrough4` at least twice and record in `TASK-095-NOTES.md`, per run:
actual `toSol` peaks, co-timed projected peaks, coverage range, and in-flight range.
Compute projections per frame. For the maximum projected-draw frame, log that
frame's scene draws and candidate count. Independently, for the maximum
projected-points frame, log that frame's scene points and candidate points. Never
pair either projected peak with an independently accumulated candidate peak. State
that this best case assumes instantaneous suppression and therefore also ignores the
frozen 300 ms fade.

Decision rule:

1. If either run's **optimistic projected peak** is above 36 draws or above 98,973
   points (10% headroom below the frozen thresholds), **STOP before enabling the
   antichain**. The lever cannot close the gate even under an optimistic subtraction.
   Keep the additive candidate diagnostics and remove only temporary projected-value
   logging that is not part of the declared probe surface. Write a finding in
   `docs/research/` stating that Lever 3 was
   measured too small on the actual `toSol` regime. The next task must research the
   transient cut/non-octree composition; do not pick a fix here.
2. If both runs are at or under both headroom values, proceed to §3. This is
   permission to test the decided fix, not permission to declare the gate closed.
3. If results straddle the rule across runs, STOP for more research. Never
   cherry-pick the favorable run.

This two-run rule is reference-machine feasibility evidence, not a deterministic CI
acceptance gate. Its job is to kill an undersized lever before behavior work.

### 3. Enable the coverage antichain

In the same post-`enforceBudgets`, pre-crossfade pass:

1. Add `renderEpoch: number` to `Chunk`, initialized to 0. Leave
   `coverageEpoch`/`coverageList` untouched after `enforceBudgets`; they remain the
   availability, LRU-pin, and nearest-body source.
2. For each entry in `coverageList`, give procgen `renderEpoch = frame`. For each
   octree entry, evaluate
   `hasMarkedAncestor(c.parentId, parentOfCachedChunk, isCoveredThisFrame)`.
3. When true, leave `renderEpoch` stale, increment
   `containmentCandidates`, and add `c.pointCount` to
   `containmentCandidatePoints`.
4. When false, set `c.renderEpoch = frame`.
5. Change only crossfade's target test from `c.coverageEpoch === frame` to
   `c.renderEpoch === frame`. Keep LRU checks on `coverageEpoch === frame`.
6. Preserve `nearestBodyDistanceM` exactly: before mutating actual opacity, reset it
   and, for each ready chunk with `coverageEpoch === frame`, compute
   `navOpacity = advanceFade(c.opacity, 1, dtMs, crossFadeMs)`. If
   `navOpacity > 0`, apply the existing distance formula
   `max(0, distUnits - extentCurrent) * ctxMeters`. Then update actual `c.opacity`
   from `renderEpoch`. Remove nearest accumulation from the normalized visible loop
   so actual render opacity cannot change navigation. This uses the production
   `advanceFade` helper and exactly models what the pre-antichain code would have
   done; do not add persistent navigation-opacity state.
7. Do not change `_catalogCoverage`; it was computed from target-region
   availability and remains correct.
8. Do not directly change `visible`, `desiredEpoch`, status, residency, or
   request state. Existing crossfade and lifecycle code consume the normalized
   render-ownership state.

The pass must be ordering-independent: a descendant is denied render ownership
whenever any marked ancestor exists, regardless of which entry appears first. If an
ancestor is itself dominated by a higher marked ancestor, both lower entries lack
`renderEpoch` and the coarsest one owns rendering.

Keep the final `StreamingStats` names `containmentCandidates` and
`containmentCandidatePoints` in both branches. They describe the pre-normalization
ownership entries and remain meaningful in observe-only outcome A and implemented
outcome B. Under B, every candidate loses ownership in that frame; crossfade may
still render it temporarily.

### 4. Add deterministic package tests

Create `packages/streaming/test/lod-coverage-antichain.test.ts` for the production
helper. Log each chosen key/marked ancestor/result so a CI-only miss is triagable.
Required cases:

- direct cached parent marked ⇒ true;
- cached grandparent marked with immediate parent unmarked ⇒ true;
- sibling/cousin marked ⇒ false;
- original chunk key is never queried (strict means strict);
- `parentId = null` ⇒ false and neither callback is called;
- a deep cached chain works without Morton parsing;
- a missing cached parent terminates safely rather than looping.

Extend the controlled-ready-state fixture in
`packages/streaming/test/coverage.test.ts` with `resolve(key)` and `reject(key)`;
keep it local to that file and do not duplicate production math. Add:

1. **Mixed siblings, coarse fallback ready:** root/parent ready, child A ready, child
   B unready ⇒ after settling crossfade, visible octree IDs contain the ancestor and
   do not contain A; `catalogCoverage() === 1`; candidate count/points are nonzero.
2. **All children ready:** no fallback is required; after crossfade, children are
   visible and ancestor is absent.
3. **Failed/unready target:** use the local fixture's `reject(key)` repeatedly through
   the real retry/backoff path; a failed target is not covered by itself and a ready
   ancestor remains. Do not extract a shared fixture.
4. **No ready ancestor:** no representation is invented and
   `catalogCoverage() < 1`.
5. **Order independence:** construct equivalent fixtures whose child traversal order
   differs; visible ID sets after settle are equal.
6. **Reversibility without illegal status mutation:** mixed→all-ready resolves the
   remaining child and restores fine children. For coarse→mixed, use an SSE-changing
   two-level tree: settle a coarse ready cut, approach so newly selected children are
   pending, resolve only one child, then resolve the rest. Never mutate a ready chunk
   back to pending. Assert non-empty octree visibility at settled checkpoints.
7. **Stats truth:** `stats.drawCalls`/`renderedPoints` reflect the post-antichain
   visible set once fades settle.
8. **Crossfade truth:** ancestor/descendant overlap is allowed during the frozen fade,
   then reaches zero after settlement.
9. **Navigation frozen:** `nearestBodyDistanceM` equals the pre-antichain,
   post-budget result in the mixed-sibling case.
10. **Hot-path regression:** repeated updates of an unchanged settled cut issue no
   requests and the antichain invokes no Morton decode/encode; it walks cached IDs.

Tests query `policy.visible`, `catalogCoverage()`, and `stats`; they must not
reimplement the antichain to predict the answer.

### 5. Add additive diagnostics to the existing flythrough probe

Mirror TASK-093/094; no new `window.__cosmos` hook:

- `Flythrough4Probe.tsx`: add `peakContainmentCandidates` and
  `peakContainmentCandidatePoints` to `SegmentStats`, `SegmentAccum`,
  `newSegmentAccum()`, `finalizeSegment()`, and the same-frame `Math.max`
  accumulation from `streaming.stats`.
- `e2e/tests/flythrough4.spec.ts`: add both fields to the local `SegmentStats`
  interface and append
  `containmentCandidates=… containmentCandidatePts=…` to `logSegments()`.
- No assertion uses these fields. Do not subtract independent peaks in code or NOTES.

### 6. Verify, measure, and STOP-or-record

Run:

1. package/unit checks for the new helper and policy integration;
2. `pnpm verify`;
3. `pnpm test:e2e` on Chromium;
4. a second local `flythrough4` run from the same built diff.

Record both post-diff runs in `TASK-095-NOTES.md` with actual `toSol`
`peakSceneDrawCalls`, `peakScenePoints`, all 093/094 diagnostics, both containment
diagnostics, policy draw/point peaks, coverage/procgen ranges, and in-flight range.
Peaks are independent unless explicitly recorded co-timed; label them accordingly.

Reference-machine closure discipline:

- PASS requires **both runs** at `sceneDrawCalls ≤ 36` and
  `scenePoints ≤ 98,973`, plus `scenePoints > 0`. The 10% headroom is required because
  async fetch/decode produced 64 vs 88 draws and 419k vs 586k points in TASK-094.
- A run within ~10% of either frozen threshold (draws 37–44 or points
  ~99k–121k), any straddle across runs, or any frozen-gate failure is **NOT closed**.
- On STOP after behavior was tried: do not ship that behavior under TASK-095 unless a
  separate reviewed product-value decision authorizes containment hygiene without
  gate restoration. Remove/revert the behavior portion from the task diff, preserve
  the evidence, and do not raise `TILE_VISIBILITY_FLOOR`, alter
  baseline/thresholds, change selection, drop unready regions, touch shaders,
  re-enable monolith/procgen, or stack another heuristic. The next work is a separate
  research task on the `toSol` transient cut and total-scene composition, seeded by
  the co-timed diagnostics.

## Failure modes to watch (mined from research and history)

1. **Dropped the fallback and blanked an unready sibling.** The tempting literal
   reading of “skip an ancestor fallback whose descendants are ready” is unsafe for
   `{B ready, C unready}`: B does not spatially cover C. Historical class-wide hides
   already produced an all-black goTo (`1073dbf`) and deferred-only mounting produced
   a black fly-in (`bab8fff`). Guard: ancestor dominates descendants; integration
   mixed-sibling and failed-target cases; frozen `> 0` e2e clause.

2. **Made a lower tier/coarser choice produce less sky.** TASK-070
   (`405c4ff`, `gaia-far-fly-quality-collapse.md`) counted procgen against the point
   cap, collapsed real Gaia to the root, and produced a black far park. Guard:
   procgen-cap exclusion frozen; antichain only removes a descendant when a ready
   ancestor remains; non-empty visibility and reversibility tests.

3. **Changed selection while claiming a render/coverage fix.** Frustum and brightness
   are intentionally reversible draw-time tests; research direction 3 (skip
   fetch/mount) was deferred because camera motion can reveal tiles before streaming
   catches up. Guard: no changes to `selectOctree`, `targetList`, dispatch, or
   cancellation; package diff review.

4. **Broke coverage handoff while fixing detail overlap.** `_catalogCoverage = 1`
   with a coarse ancestor is intentional: it tells StarScene the real catalog covers
   the region. Recomputing it from the post-antichain fine set can flicker the
   monolith/procgen back on and add an entire redundant layer. Guard:
   `catalogCoverage() === 1` mixed-sibling integration case and frozen 0.9 gate.

5. **Gated a frame-sampled transient at its incidental exact value.**
   `m4a-drawcall-budget-transient.md` showed fast and slow machines sample transient
   peaks differently. Guard: exact antichain semantics live in deterministic package
   tests; containment counts remain log-only; the existing total-scene work gate is
   frozen, and the two-run/headroom rule prevents a lucky local close.

6. **Mistook policy savings for visible savings.** TASK-093/094 hide tiles after
   policy, so a policy containment candidate may already be frustum- or
   brightness-hidden. Guard: §2's subtraction is explicitly an optimistic kill test;
   only post-diff `gl.info.render` proves actual closure.

7. **Turned coarse-before-fine into permanent coarse LOD.** A stale
   `renderEpoch` or wrong ancestor check can leave children suppressed
   after the last sibling becomes ready. Guard: mixed→all-ready and reverse
   integration tests, existing crossfade, no status/residency mutation.

8. **Reintroduced Morton work on every frame.** The M1/Metal root cause measured
   repeated BigInt Morton conversion inside `streaming.update`; BUG-10 likewise
   removed repeated parent-key work. Guard: creation-time `parentId` cache,
   callback-driven helper, and settled-update test.

9. **Changed flight speed while changing render ownership.** Reusing/clearing
   `coverageEpoch` for the antichain would make `nearestBodyDistanceM` switch from a
   fine tile to its coarse ancestor after the fine tile fades. Guard: leave
   `coverageEpoch`/`coverageList` untouched, compute navigation from the hypothetical
   pre-antichain `advanceFade(..., 1, ...)`, and drive actual opacity from the
   separate `renderEpoch`; equality regression test.

## Acceptance gate

There are two acceptance branches.

**A — feasibility STOP before behavior:**

1. `TASK-095-NOTES.md` contains two co-timed optimistic projections and the decision
   rule result.
2. A `docs/research/` finding records that Lever 3 cannot close the actual `toSol`
   regime.
3. No antichain behavior change ships. Any retained additive diagnostics pass
   `pnpm verify`; the known-red §5.4 result is recorded, not misreported as a new
   regression.

**B — implementation proceeds: deterministic blocking checks:**

1. New helper tests and policy integration tests pass in `packages/streaming`.
   They exercise the production helper and real policy state; no mirrored algorithm.
2. `pnpm verify` exits 0 (lint, typecheck, unit tests, build).
3. Existing `pnpm test:e2e` checks remain green, including:
   - `toSol peakSceneDrawCalls ≤ 40`;
   - `toSol peakScenePoints ≤ 109971`;
   - `toSol peakScenePoints > 0`;
   - §5.8 caps, coverage/procgen clauses, and zero page errors.
4. `TASK-095-NOTES.md` contains Step-0 verification, the §2 go/STOP evidence, and at
   least two post-diff runs if §3 was enabled.

The two local runs and ~10% margin are reference-machine closure discipline, not a
CI assertion. A straddle returns to research; it is not an executor choice.
Screenshots, luma, frame time, and exact containment peak values are never blocking.

## Verification beyond the gate

- Re-run the parked-at-Sol containment method from
  `near-sol-overdraw-frustum-culling.md`: the post-crossfade visible coverage set
  should have zero strict ancestor/descendant pairs. Record the count, camera state,
  and settled/in-flight state in NOTES; the scratch research script is not a gate.
- Observe one inbound `toSol` run: coarse regions may temporarily carry less detail
  while siblings load, but the field must not disappear or snap to black.
- Spot-check the TASK-070 far-Gaia regime: procgen still owns the distant view and a
  tier change does not collapse it to an empty catalog. Record observations only.
- Picking follows the rendered ownership representation: after a fine descendant
  fades out, it is not separately pickable until fine ownership returns. This
  temporary reduction in pick resolution is accepted; blank/unpickable whole
  regions are not.

## Spec-writer judgment calls (quarantined; decided, not executor choices)

1. **Policy vs draw-time:** policy owns containment because it creates the overlapping
   coverage set and drives opacity/stats. TASK-093/094's draw-time precedent applies
   to camera/shader predicates unavailable to policy, not to this state.
2. **Which representation wins:** the ready coarse fallback wins its entire subtree
   while any target needs it. This is the only whole-tile choice that removes overlap
   without a hole; temporary lower detail is the explicit trade.
3. **“Ready enough”:** not “any child ready” and not an area fraction. A descendant is
   suppressed only because an already-covered strict ancestor remains. Fine children
   regain ownership automatically when no target selects that ancestor.
4. **Insertion point:** after `enforceBudgets`, before crossfade. Before budgets would
   make budget accounting operate on an already altered set and duplicate its
   collapse responsibility; after crossfade/visible would leave state and stats
   inconsistent.
5. **Feasibility:** 14.1% parked containment does not establish that Lever 3 can close
   a transient gate with a 4× point gap. The optimistic two-run kill test is mandatory;
   failing it ends behavior work rather than authorizing a new heuristic.
6. **Diagnostics:** policy counters plus Flythrough4 peaks are additive and log-only.
   No new `window.__cosmos` mirror and no threshold on asynchronous containment peaks.
7. **Navigation:** render ownership must not alter `nearestBodyDistanceM`; preserve
   the old result by leaving `coverageEpoch` intact and evaluating the hypothetical
   pre-antichain coverage fade before actual `renderEpoch` opacity.
8. **Picking:** picking follows the crossfaded visible representation. Temporary
   coarse pick resolution is accepted as the same trade as temporary coarse visual
   detail.

