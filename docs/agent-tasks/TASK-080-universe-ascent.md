# Task: Unblock the galaxy→universe ascent (make `universe` reachable by a user)

**ID:** TASK-080
**Target package:** `packages/nav` + `apps/web` (+ one string in `packages/ui`)
**Size:** M
**Phase:** Maintenance track — universe-scale tour lane (item 1 of the preflight's ordered list)
**Depends on:** nothing blocking. TASK-037 (universe context) and TASK-067 (breadcrumb)
shipped. **The former hard dependency on TASK-082 was removed on 2026-07-26** — its premise
was measured false; see Decision 2.

> **Spec-reviewed 2026-07-26** (second pass, against `main` @ `bf6a57a`, i.e. after TASK-081
> merged). Six findings fixed in place: Decision 2's "stated as fact" finding was false and is
> replaced with measurements; the TASK-082 dependency is downgraded; a Goal ↔ verification
> contradiction on the return leg is resolved; three line citations that drifted (GalaxyScene
> post-081, `ScaleRuler.tsx`, `perception-literacy.spec.ts`) are corrected. Facts F1–F8 all
> re-verified TRUE and unchanged.

## Goal

A user of the deployed app can fly out of the Milky Way and end up in the `universe`
context — today they cannot, at all. Two things ship: the controller stops treating the
galaxy→universe exit as dead code, and the breadcrumb gains a leading `◂ Universe`
segment that flies there. The return leg is `◂ Galaxy` (`enterGalaxy`), and the HUD's
`UNIVERSE` ruler segment stops being a promise the app cannot keep.

**The round trip is `Universe → ◂ Galaxy`, NOT `Universe → ◂ Milky Way → ◂ Galaxy`.**
Review caught this as arithmetic, not preference: `arrivalDistanceM` is a **radius around
the target**, direction-agnostic (`controller.ts:495-500`, `:542-552`). `viewGalaxy` targets
`[0,0,55_000]` pc with a 6,000 pc arrival radius, so approached **from outside** it lands at
55,000 + 6,000 = 61,000 pc = 1.882e21 m — *outside* `enterGalaxyAtM` (1.543e21 m), in the
dead band. The switch never fires, and a second click is a no-op (`d0M <= arrivalDistanceM`
hits the early return at `:498-500`). `enterGalaxy` targets `[0,0,0.06]` pc with a 1e13 m
arrival, so it genuinely crosses the 50 kpc gate from either side. Do not "fix" `viewGalaxy`
in this task.

**Decisions this task ships under** (both CLOSED — an executor must not re-open them):

1. **The affordance is in scope; the gate lift alone is not the deliverable.** This is not
   a preference, it is forced by measurement: with the gate lifted the exit is still ~510 s
   of held Shift+W away (Step 0 fact F5). A controller change with no reachable path does
   not satisfy the Goal, so both halves ship together.

2. **It ships visible, and it is NOT blocked on TASK-082.** The intent is to close the
   honesty gap the HUD already opened (it advertises `UNIVERSE` and cannot deliver it), and
   arriving to "the Milky Way as a spiral from outside, and nothing else" is accepted: the
   galaxy-point field is a later task, not a precondition.

   **Correction (2026-07-26) — the earlier version of this decision was false.** It asserted,
   "stated as fact", that the impostor renders **1e6× oversized** in `universe` and that
   TASK-080 therefore must not merge first. That was derived from source, never measured, and
   measurement falsifies it: `radiusUnits` reaches **no pixel in any context**. The vertex
   shader references neither `modelMatrix` nor `modelViewMatrix`, the only paths by which
   `mesh.scale` (`impostor.ts:42`) can reach the GPU, so the quad is a fixed 1-unit plane —
   sub-pixel, never drawn. Offscreen render, lit-pixel counts: `radiusUnits` 1 vs 15000 at the
   same distance both give **49284**; at a realistic distance, 15000 and 1.5e10 both give **0**.
   Full writeup: `docs/research/galaxy-impostor-scale-is-inert.md`.

   So the view this task lands on is **not** "a galaxy filling the viewport". Measured at this
   task's own arrival vantage (0.18 Mpc, Deliverable 3), using the production
   `projectedPixelExtent` + the shipped `lod` formula and `discRadiusPc = 15,000 pc`:

   | canvas height | impostor's share of the galaxy's brightness at 0.18 Mpc | delivered |
   | --- | --- | --- |
   | 720 px | 16% | 84% |
   | 900 px | **0%** | **100%** |
   | 1080 px | **0%** | **100%** |
   | 1440 px | **0%** | **100%** |

   At the vantage a user actually lands on, the procgen cloud carries the whole galaxy on any
   ordinary window. The dependency is downgraded to a follow-up: **TASK-082 should merge soon
   after**, because a user who then flies further out loses brightness progressively (50% at
   0.3 Mpc, 84% at 0.6 Mpc). That is an accepted, reportable imperfection of this task, not a
   blocker for it.

   The pre-existing-bug point stands: `flythrough3`/`m3`/`soak3` already render universe frames
   (their path starts at universe `[0,0,0.6]` Mpc), so nothing here creates the defect.

## Step 0 — facts to re-verify before editing (all verified 2026-07-24 on `main` @ `e8bd2f7`)

Re-confirm each with the given command. **If any is false, STOP and report** — do not
adapt the plan around it (global rule 1).

- **F1 — the exit is gated on a flag production never sets.**
  `packages/nav/src/controller.ts:800` reads `if (ownGalaxyContext) {`; the flag is
  declared `false` at `:434` and set `true` only on a `universe → galaxy` switch at `:732`.
  The app boots in `galaxy` (`apps/web/src/scene/NavDriver.tsx:24-27`), so the branch is
  unreachable in production.
  `RECHECK: grep -n "ownGalaxyContext" packages/nav/src/controller.ts` → 5 hits, no init override.
- **F2 — the test the flag protects uses a controller with NO galaxy anchor.**
  `packages/nav/test/galaxy-switch.test.ts:358-386` ("TASK-027 behavior unchanged") builds
  a controller in `galaxy` context and never calls `setGalaxyAnchor`. It must keep passing
  **unmodified**.
  `RECHECK: sed -n '356,386p' packages/nav/test/galaxy-switch.test.ts`
- **F3 — production DOES set the galaxy anchor, and the glue already documents the intent
  this task implements.** `apps/web/src/glue/local-group.ts:53-63` sets
  `tree.setAnchor('galaxy', …)` then `flight.setGalaxyAnchor(…)` on a ≤10 Hz scan, and its
  docstring at `:44-51` says the order is safe in any context "which also lets the
  production app (which boots in `galaxy`) ascend to `universe`". The controller gate
  contradicts that stated intent.
  `RECHECK: sed -n '41,65p' apps/web/src/glue/local-group.ts`
- **F4 — thresholds.** `exitGalaxyAtM = 3.086e21` m (≈100 kpc ≈ 0.1 Mpc),
  `enterGalaxyAtM = 1.543e21` m (≈50 kpc), hysteresis ratio floor 1.5
  (`packages/nav/src/galaxy-switch.ts:22-28`).
  `RECHECK: cat packages/nav/src/galaxy-switch.ts`
- **F5 — free flight cannot reach the gate in practice.** Speed law is
  `clamp(speedScale * distanceToNearestSurface, min, max)` (`controller.ts:1085`) with
  `×10` on Shift (`:1087`); `apps/web/src/scene/NavDriver.tsx:51` caps
  `MAX_FREE_FLIGHT_SPEED = 10` (pc/s in galaxy context). From the "Milky Way" vantage
  (~49 kpc) to the 100 kpc gate is ~51,000 pc ⇒ **~510 s of held Shift+W**. This is why
  Deliverable 3 exists.
  `RECHECK: grep -n "MAX_FREE_FLIGHT_SPEED" apps/web/src/scene/NavDriver.tsx; sed -n '1083,1090p' packages/nav/src/controller.ts`
- **F6 — `goTo` targets are re-converted per frame, so a cross-context flight survives the
  switch.** `controller.ts:480-518` stores `opts.target` as a `UniversePosition`;
  `updateGoToFrame` (`:530-`) re-runs `origin.toRenderSpace(target, …)` each frame. Same
  mechanism `exitSystem()` relies on (`apps/web/src/glue/goto.ts:235-241`).
  `RECHECK: sed -n '530,545p' packages/nav/src/controller.ts`
- **F7 — the breadcrumb is the established affordance and is already role-locator-tested.**
  `apps/web/src/hud/Breadcrumb.tsx:36-57` builds `◂ Milky Way › ◂ Galaxy › …`;
  `e2e/tests/perception-literacy.spec.ts:82` and `breadcrumb-profile.spec.ts:47` click it
  via `getByRole('button', { name: /Milky Way/i })`.
  `RECHECK: sed -n '36,57p' apps/web/src/hud/Breadcrumb.tsx`
- **F8 — doc drift to fix in this diff.** `apps/web/src/glue/goto.ts:30-37` states the
  controller "only exits to universe when it ENTERED from universe … so a galaxy vantage
  is the reliable 'see the whole Milky Way'", and `:95-96` claims `viewGalaxy` flies "all
  the way out to a universe vantage" (it does not — it ends ~49 kpc, in `galaxy`).
  `RECHECK: sed -n '28,42p;93,100p' apps/web/src/glue/goto.ts`

## Frozen Interface

Do **not** change any of these:

**Contract worth stating because it caused a blocker in review:** `goTo`'s
`arrivalDistanceM` is a **radius around the target**, not a stopping distance along the
approach. A vantage reached from outside lands at `|target| + arrivalDistanceM` from the
origin, not `|target| − arrivalDistanceM`.

```ts
// packages/nav/src/galaxy-switch.ts — thresholds and the hysteresis floor
export const DEFAULT_GALAXY_SWITCH_POLICY: GalaxySwitchPolicy = {
  enterGalaxyAtM: 1.543e21,
  exitGalaxyAtM: 3.086e21,
};
export const GALAXY_HYSTERESIS_MIN_RATIO = 1.5;
export function shouldExitGalaxy(dM: number, anchorCleared: boolean, policy: GalaxySwitchPolicy): boolean;

// packages/nav/src/controller.ts — public surface unchanged; NO new option/flag on
// FlightControllerOptions, and setGalaxyAnchor/galaxyAnchor keep their semantics.
```

New surface this task DOES add (freeze it as written):

```ts
// apps/web/src/glue/goto.ts — GoToCoordinator gains exactly one method
/** Fly out past the galaxy exit gate to a universe vantage where the Milky Way
 *  reads as one object among (eventually) many. Crosses galaxy→universe mid-flight. */
viewUniverse(): void;

// packages/ui/src/strings.ts — one addition, same W1 tooltip family as TASK-067
breadcrumbUniverseTip: 'Jump to universe view (scale link)',
```

## Deliverables

### 1. `packages/nav/src/controller.ts` — lift the gate (the whole code change is one condition)

At `:800`, replace the `ownGalaxyContext`-only guard with a disjunction that keeps the
TASK-027 protection intact:

```ts
      // Galaxy exit: allowed when we entered from universe (ownGalaxyContext) OR when
      // the glue has armed a galaxy anchor (TASK-080). The rule being protected is
      // "a plain galaxy context with NO galaxy anchor never exits" (TASK-027) — the
      // anchor, not the entry direction, is what makes the exit meaningful. Keeping
      // ownGalaxyContext in the disjunction preserves the cleared-anchor exit, where
      // galAnch is null by construction.
      if (ownGalaxyContext || galAnch !== null) {
```

Update the stale comment block at `:797-799` to match. Leave `ownGalaxyContext`'s
declaration and its assignments at `:732-733` alone.

**Nothing else in `packages/nav` changes.** No new option, no new exported symbol.

### 2. `packages/nav/test/galaxy-switch.test.ts` — prove both directions

Add a new `describe` block (do **not** edit the existing ones — F2's test must pass
untouched as the control):

1. **`booted-in-galaxy WITH an anchor exits past the gate`** — mirror production exactly:
   `createScaleFrameTree()`, `tree.setAnchor('galaxy', [0,0,0])`, origin at
   `{context:'galaxy', local:[0,0,0.06]}`, `setGalaxyAnchor(MILKYWAY)`, then
   `placeAtMeters(controller, 3.5e21)` + `update(0)` ⇒ `contextId === 'universe'` and
   exactly one event `{from:'galaxy', to:'universe', anchorId:'proc:milkyway'}`.
2. **`the boot vantage does not exit`** — same setup, camera left at 0.06 pc, 20 ×
   `update(DT_MS)` ⇒ `contextId === 'galaxy'`, zero switch events. (Guards against a
   boot-time pop to universe.)
3. **`no exit inside the gap`** — same setup, `placeAtMeters(controller, 2e21)` (between
   enter 1.543e21 and exit 3.086e21) ⇒ stays `galaxy`.

Each test must log the placed distance and the resulting `contextId` on failure via the
assertion message or an explicit `expect(…, message)`, so a CI-only failure is triagable
from logs alone (CLAUDE.md testing rule 6).

### 3. `apps/web/src/glue/goto.ts` — the `viewUniverse()` flight

Add next to `viewGalaxy`, with these exact constants:

```ts
/**
 * "Universe" vantage: 0.2 Mpc out along +Z in the UNIVERSE context. arrivalDistanceM is a
 * RADIUS around the target, so approaching from inside the camera LANDS at 0.18 Mpc =
 * 1.8x the 0.1 Mpc exitGalaxyAtM gate and 3.6x the 0.05 Mpc enter gate — clear of the
 * hysteresis band, so it cannot flap back. The controller crosses galaxy→universe
 * mid-flight as the camera passes the gate (same pattern as exitSystem, TASK-080/F6).
 * The Milky Way sits at the universe origin, so facing [0,0,0] keeps it framed.
 */
const UNIVERSE_VIEW_VANTAGE_MPC = 0.2;
const UNIVERSE_VIEW_ARRIVAL_M = 0.02 * CONTEXT_UNIT_METERS.universe; // ends ≈ 0.18 Mpc out
const UNIVERSE_VIEW_DURATION_MS = 6_000;

function viewUniverse(): void {
  const controller = deps.controllerRef.current;
  if (controller === null) return;
  flyTo(controller, {
    target: { context: 'universe', local: [0, 0, UNIVERSE_VIEW_VANTAGE_MPC] },
    arrivalDistanceM: UNIVERSE_VIEW_ARRIVAL_M,
    durationMs: UNIVERSE_VIEW_DURATION_MS,
    lookAtTarget: { context: 'universe', local: [0, 0, 0] },
  });
}
```

Export it on the returned object and declare it in `GoToCoordinator` with the docstring
from Frozen Interface. **Route it through `flyTo`, never `controller.goTo` directly** —
`flyTo` is what feeds the mode badge and Jump HUD their distance snapshot
(`goto.ts:116-136`).

Also in this file (F8 doc drift): correct the `GALAXY_VIEW_VANTAGE_PC` comment at
`:30-37` — the reason it is a galaxy vantage is that it *frames the disc*, not that the
controller refuses to exit — and fix `viewGalaxy`'s interface docstring at `:95-96` to
say it flies to a **galaxy** vantage (~49 kpc) where the Milky Way reads as a spiral.

### 4. `apps/web/src/hud/Breadcrumb.tsx` + `apps/web/src/app/StarApp.tsx` + `packages/ui/src/strings.ts` — the affordance

- Add `onViewUniverse(): void` to `Breadcrumb`'s props and a **leading** segment before
  `milkyway`:
  `{ key: 'universe', label: 'Universe', onClick: onViewUniverse, title: STRINGS.breadcrumbUniverseTip }`.
- Extend the existing `scaleNav` disabled-gate at `Breadcrumb.tsx:70-72` to include
  `seg.key === 'universe'` — the same `galaxyNavReady` condition that already guards the
  Milky Way jump (the procgen worker must be up before a scale link fires).
- Wire it in `StarApp.tsx:626-633`: `onViewUniverse={() => goto?.viewUniverse()}`.
- Add `breadcrumbUniverseTip` to `packages/ui/src/strings.ts` next to
  `breadcrumbMilkyWayTip` (`:42-44`), same W1 phrasing family. This is the **only**
  permitted `packages/ui` edit.

No CSS changes: the new segment reuses `hud-breadcrumb-seg hud-breadcrumb-exit`.

### 5. `e2e/tests/universe-ascent.spec.ts` — the deterministic gate (new file)

Deterministic only: **no screenshots, no wall-clock frame assertions, no `@perf` tag.**
Model it on `e2e/tests/perception-literacy.spec.ts` (role locators + `__cosmos` polling).

```
1. goto the app, wait for window.__cosmos.ready
2. expect __cosmos.contextId === 'galaxy'                       // boot state
2b. await expect(getByRole('button', { name: /Universe/i })).toBeEnabled({ timeout: 30_000 })
    // REQUIRED: Deliverable 4 gates the segment on galaxyNavReady, so it BOOTS DISABLED.
    // Precedent: perception-literacy.spec.ts:82-83. Relying on Playwright's implicit
    // actionability timeout is the CI-SwiftShader flake this repo already paid for.
3. click that button
4. poll until __cosmos.contextId === 'universe'  — EXPLICIT timeout (see Failure modes)
5. expect __cosmos.cameraPosition.context === 'universe'
   expect hypot(cameraPosition.local) > 0.1      // Mpc: past the 0.1 Mpc exit gate
6. click getByRole('button', { name: /Galaxy/ })  // NOT "Milky Way" — see Goal: that
   vantage lands OUTSIDE the enter gate when approached from universe and never switches
7. poll until __cosmos.contextId === 'galaxy'    — same explicit timeout  (round trip)
8. expect __cosmos.errorCounts.total === 0       // no invariant/error reports fired
```

`/Universe/i` does not collide in strict mode: the only other "Universe" in the HUD is the
scale ruler's (`STRINGS.rulerUniverse`), rendered as a `<span>` inside a `role="group"` div
(`packages/ui/src/ScaleRuler.tsx:25-34` — **re-verified 2026-07-26**; the file is 37 lines and
an earlier citation of `:57-63` pointed past its end). A `getByRole('button', …)` cannot match
a span, so the locator resolves to the breadcrumb button alone.

Every polled step must `console.log` the observed `contextId` + `cameraPosition` when it
gives up, so a CI-only failure is diagnosable without a local repro (testing rule 6).

### 6. Docs

- **Verify/refresh** the TASK-080 row in `docs/agent-tasks/README.md` — it already exists;
  do not add a duplicate. Set its `Depends on` column to **`—`** and mark the row `done` on
  merge: the TASK-082 dependency was removed by the 2026-07-26 review (Decision 2), and the
  row still reads `TASK-082`. The `check:tasks` gate parses this table — run
  `node tools/check-task-index/src/check.mjs` after; **verified 2026-07-26: it reports exactly
  one pre-existing inconsistency (TASK-064 done / TASK-063 pending) and exits 1.** That is the
  expected baseline; do **not** fix it here, and do not let it mask a NEW inconsistency your
  row introduces — the count must stay at 1.
- Create `docs/agent-tasks/NOTES-<date>-task-080.md` and log every judgment call **as you
  make it** (CLAUDE.md "Judgment calls"). If the executor writes zero entries, say so
  explicitly in the PR body rather than leaving the file out.
- One line in `docs/research/universe-scale-tour-preflight.md` under Q6's table: mark
  **N1** as closed by TASK-080. Do not rewrite the research doc.

## Out of scope (do NOT do these here)

- **The galaxy-point field (N2).** `generateLocalGroup` returns 12 records and
  `StarApp.tsx:208` uses only `milkyWay`. Rendering/selecting the other 11 is the *next*
  task; arriving at an almost-empty universe is the accepted state of this one.
- **Tour composition**, `apps/web/src/glue/tours.ts`, `flythrough-descent.ts`, and every
  `flythrough*`/`m3` probe or spec — they already reach `universe` programmatically and
  must keep passing **unchanged** as the regression control.
- **Quality tiers / `initialQualityTier`** (TASK-072), the boot-perf gate and its
  threshold (see `docs/research/m1-metal-boot-and-flyin-stall-rootcause.md` — that gate's
  3.1 s is a SwiftShader artifact and is a separate, owner-level decision), the Morton
  BigInt swap, the Gaia pack URL, touch input.
- Any change to `packages/ui` beyond the single string, and any change to
  `packages/coords`, `packages/streaming`, or `packages/core-types`.
- **`packages/render-galaxy` and `apps/web/src/scene/GalaxyScene.tsx` — do not touch them
  here.** Now that Decision 2 no longer blocks on TASK-082, the impostor and the nebula
  sprites are a *sibling task in flight* (TASK-082), not this diff's problem. Editing them
  here would collide with it. This is listed because it is exactly what an executor who reads
  Decision 2 would naturally reach for.
- Retuning `MAX_FREE_FLIGHT_SPEED` to "make flying out feasible" — the affordance is the
  answer, not a speed change.

> Findings during this task go to `docs/research/`; scope creep goes to a new task file,
> not into this diff.

## Failure modes (these already happened in this repo — read before starting)

- **The far-galaxy frame stall.** Flying far out in `galaxy` context used to cost
  multi-hundred-ms frames: the HYG grid search scans ~200 empty rings from the void.
  `NavDriver.tsx:186-199` short-circuits on `goToActive || distToField > HYG_GRID_REACH_PC`.
  **Do not touch that short-circuit** — the new flight lives entirely in that regime.
  (`docs/research/TASK-040-breadcrumb-freeze.md`)
- **The dev continuity guard throws if the tree anchor was not set first.**
  `controller.ts:710-727` throws "context switch broke positional continuity" on a
  `universe→galaxy` enter when `tree.setAnchor('galaxy', …)` was skipped. The production
  scan does it in the right order (F3); if you see this error, the anchor order broke —
  report it, do not disable the guard (`NAV_DEV`).
- **Context flapping at a boundary (§5.8).** Landing inside the hysteresis band makes the
  context oscillate. The 0.2 Mpc vantage vs the 0.1 Mpc gate is the margin; if you change
  the vantage you have re-opened this and must re-justify it.
- **CI is SwiftShader and slow.** A CI-only e2e flake in this repo was fixed by adding an
  explicit timeout, not by loosening the assertion (`a2f307a`,
  "fix(nav): give 10k-look invariant test an explicit timeout"). Give every poll in
  Deliverable 5 an explicit generous timeout from the start.
- **Screenshots / frame time are never blocking gates** (CLAUDE.md testing rule 4). If
  the ascent looks wrong on screen, that is a finding for `docs/research/`, not a
  screenshot assertion.
- **The Jump HUD now sees a ~200,000 pc jump.** `flyTo` snapshots the distance in pc
  (`test-hook.ts:178-181`); the HUD renders it in light-years. Check the readout is a
  sane finite number, not `NaN`/`Infinity` — if it is not, that is a real defect: report
  it, and fix it only if it is a display-format bug in `jump-hud-model.ts` (a data or
  units bug there is a separate task).

## Acceptance gate (all must pass)

1. `pnpm verify` exits 0 (lint + typecheck + unit + build) — includes the three new nav
   unit tests **and** the untouched TASK-027 test at `galaxy-switch.test.ts:358`.
2. `pnpm test:e2e` exits 0 — the new `universe-ascent.spec.ts` passes **and** every
   existing spec still passes, in particular `flythrough3`, `flythrough4`, `m3`,
   `perception-literacy`, `perception-scale`, and the breadcrumb specs.
3. The single-spec smoke carve-out passes locally before pushing. **Exact command** —
   `test:smoke` exists only in `e2e/package.json`, so `pnpm test:smoke` from the repo root
   fails with "command not found" (verified 2026-07-26):

   ```
   pnpm --filter @cosmos/e2e test:smoke universe-ascent.spec.ts
   ```

   **The filename argument is not optional.** Without it `test:smoke` runs all 22 specs on one
   worker — the "never launch the full suite locally" trap (CPU storm + orphaned browsers).
   Build `@cosmos/web` first, since `test:smoke` does not build the way `test:e2e` does.
4. `git status` clean of build output; the NOTES file exists and is committed.

## Verification beyond the gate (report, do not assert)

Run the app and click `◂ Universe`. Report, in the PR body:

- the `contextId` / `cameraPosition` sequence observed (from `__cosmos`),
- whether the Milky Way stays framed for the whole pull-back or slides off,
- what the scale ruler reads on arrival (it should finally show `UNIVERSE`),
- whether the round trip `Universe → ◂ Galaxy` lands back in the star field. **Not** via
  `◂ Milky Way` — an earlier draft of this line said so and contradicted the Goal's bolded
  arithmetic and Deliverable 5 step 6. The Goal is right: `viewGalaxy` approached from
  universe lands at 61,000 pc, outside `enterGalaxyAtM`, and never switches.
- **Expected, and NOT yours to fix:** the dust-lane / HII nebula sprites are misplaced outside
  galaxy context — they receive a parsec offset with no context scale, knowingly deferred at
  `GalaxyScene.tsx:274-278` (TASK-081's out-of-scope note). If the nebulae sit wrong at the
  universe vantage, that is the already-filed follow-up, not a TASK-080 regression. Report it
  and move on.

These are observations, not gates. Anything that looks wrong goes to `docs/research/`.

## Context Files

- `packages/nav/src/controller.ts` (`:429-434` state, `:775-808` the switch block,
  `:684-727` the dev guard) — the single edit and its blast radius
- `packages/nav/test/galaxy-switch.test.ts` — the control test (F2) and the helper style
  (`makeController`, `placeAtMeters`) the new tests must reuse
- `apps/web/src/glue/local-group.ts` — the anchor scan (F3) and the docstring this task makes true
- `apps/web/src/glue/goto.ts` — `viewGalaxy`/`enterGalaxy` as the pattern to copy
- `apps/web/src/hud/Breadcrumb.tsx`, `apps/web/src/app/StarApp.tsx:626-633` — the affordance
- `e2e/tests/perception-literacy.spec.ts` — role-locator + `__cosmos` polling precedent
- `docs/research/universe-scale-tour-preflight.md` §Q1, §Q3 — why this task exists and
  what it unblocks
- `apps/web/src/scene/flythrough-descent.ts` — the programmatic descent that already
  works; the regression control, not a thing to edit
