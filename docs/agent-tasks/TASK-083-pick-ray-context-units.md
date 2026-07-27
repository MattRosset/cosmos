# Task: Convert the star pick ray's origin to parsecs (the pick path's half of TASK-081)

**ID:** TASK-083
**Target package:** `apps/web` (one call site) + `e2e`
**Size:** S
**Phase:** Maintenance track — scale-transition lane
**Depends on:** **TASK-081** (this reuses the `pcScales` helper it introduces).
**Dependency status:** TASK-081 and TASK-084 are **merged to `main`** (PR #34, a8a3fe5);
`pcScales` is live at `apps/web/src/glue/context-scale.ts:30`.

> **Status: DONE 2026-07-27** on `feat/task-083-pick-ray-context-units`. Spec-reviewed
> (F1/F2/F3 line citations corrected for TASK-086's insertions; frozen surface expanded to
> name the two OTHER `position.local` reads that must NOT be scaled), symptom measured live
> (readiness gate PASSED — see below), fix + e2e gate implemented and power-proven
> (fail-on-`main` → pass-on-fix). Notes: `NOTES-2026-07-27-task-083.md`.

## Goal

Clicking a star selects the star under the cursor in every scale context, not only in
`galaxy`. Today `pickAt` builds its ray origin from `controller.state.position.local`
(active-context units) and feeds it to a pick path whose contract is parsecs, so the origin
is off by 206,266x in `system` and 1e6 in `universe`.

Full writeup, with the source evidence and the fix shape:
`docs/research/star-pick-ray-origin-context-units.md`.

## Step 0 — facts to re-verify (re-verified 2026-07-27 @ main a8a3fe5). If any is false, STOP and report.

- **F1 — the origin is context units.** `apps/web/src/scene/StarScene.tsx:260-261`:
  `const p = controller.state.position.local;` → `pickNearestStar(hygBatch, exoBatch, combined, p, dir)`.
  `.local` is in the active context's units (`packages/coords/src/origin.ts` header).
  `RECHECK: sed -n '260,261p' apps/web/src/scene/StarScene.tsx`
- **F2 — the consumer treats it as parsecs.** `StarScene.tsx:360-362` (hyg) and `:369-371`
  (exo) compute `cameraLocalPc[i] - batch.originPc[i]`; `packages/render-stars/src/pick.ts:12`
  documents "TILE-LOCAL parsecs (caller subtracts batch.originPc)".
  `RECHECK: sed -n '356,384p' apps/web/src/scene/StarScene.tsx; sed -n '10,20p' packages/render-stars/src/pick.ts`
- **F3 — the direction is unit-free** and must NOT be touched: it comes from the orientation
  quaternion (`StarScene.tsx:254-258`, `rotateByQuat(controller.state.orientation, …)` then
  normalized). Only the origin is wrong.
- **F4 — the helper exists** (TASK-081, now on `main`): `apps/web/src/glue/context-scale.ts:30`
  exports `pcScales(ctx)` with a literal-`1` early return for galaxy.
  `RECHECK: sed -n '30,34p' apps/web/src/glue/context-scale.ts`
- **F5 — there are THREE reads of `controller.state.position.local` in this effect; only
  ONE is wrong.** `RECHECK: grep -n 'position.local' apps/web/src/scene/StarScene.tsx` →
  lines **235** (galaxy pick → `pickNearestGalaxy`, universe-only, TASK-086), **260** (star
  pick — the target), **278** (`projectToScreen`). See Frozen surface: 235 and 278 must NOT
  be scaled.

## Deliverables

1. **`apps/web/src/scene/StarScene.tsx`, the star-pick site only (`~:260`).** Scale that
   `p` by `pcScales(controller.contextId).unitsToPc` before calling `pickNearestStar`:

   ```ts
   const { unitsToPc } = pcScales(controller.contextId);
   const p: [number, number, number] = [
     controller.state.position.local[0] * unitsToPc,
     controller.state.position.local[1] * unitsToPc,
     controller.state.position.local[2] * unitsToPc,
   ];
   return pickNearestStar(hygBatch, exoBatch, combined, p, dir);
   ```

   Allocating a 3-tuple here is fine: `pick.ts:13` states the path is click-time only. Do
   not touch `dir`. Do **not** scale the other two `position.local` reads — see Frozen
   surface.
2. **A pick test in `system` context** (`e2e/tests/`). Galaxy context cannot distinguish the
   fix from the bug (`pcScales('galaxy')` is exactly 1), so a galaxy-only test is a false
   green. Requirements:
   - **Entry mechanism (use the established one, do not invent):** reach system context with
     the star field live via `?debug=m4a` + the `M3DescentProbe` galaxy→system descent, the
     exact route the merged `e2e/tests/system-context-scale.spec.ts` uses to sample in
     `contextId === 'system'`. Model the new spec on it (it already reads `__cosmos.contextId`
     and `__cosmos.projectToScreen` from inside the page).
   - **Target a star that is actually drawn.** The pick path is geometric and ignores the
     clip planes, so it resolves stars the far plane removed; a target chosen from the catalog
     alone can pass while invisible. Choose a target whose context-frame distance is inside
     the far plane (a bright near-Sol HYG star), so the assertion reflects the rendered scene.
   - **Power proof:** the spec must FAIL on `main` (wrong/`null` id — origin inflated 206,266×)
     and PASS with the fix. State both runs in the PR body (gate item 3).
   - **Star position → screen pixel (established pattern, no new hook needed):** get the
     target star's parsec position from the manifest exactly as `m1.spec.ts` does —
     `fetchPack(request, baseURL)` → `findStarByName(pack, …).posPc` (`m1.spec.ts:218-219,
     239-249`). Then, because `projectToScreen` expects the position in the ACTIVE context's
     units (F5, frozen line 278) and `posPc` is parsecs, convert first:
     `local[i] = posPc[i] * (CONTEXT_UNIT_METERS.galaxy / CONTEXT_UNIT_METERS.system)` reading
     the ratio from `__cosmos.contextUnitMeters` (same table the TASK-084 test uses — do not
     hardcode). `projectToScreen(local)` → `pickAt(px.x, px.y)` → assert the id. m1 skips the
     conversion only because in galaxy context that ratio is 1.
3. NOTES file with the judgment calls; README row.

## Frozen surface — do not touch

- **`StarScene.tsx:278` — `projectToScreen`'s `p`.** It computes `localPos[i] - p[i]` where
  BOTH operands are active-context units, so the subtraction is already self-consistent and
  the projection is correct in every context. It has no `originPc`-in-parsecs term, so the
  F1/F2 mismatch does **not** exist here. Scaling this `p` by `unitsToPc` would BREAK it —
  and the merged TASK-084 gate (`e2e/tests/system-context-scale.spec.ts`) calls
  `__cosmos.projectToScreen` in system context and would go red. This is the trap: a
  find-and-replace on `controller.state.position.local` hits all three sites.
- **`StarScene.tsx:235` — the local-group galaxy pick's `p`** (`pickNearestGalaxy`, universe
  context only, TASK-086). It has its own Mpc-based unit convention (`positionMpc`, see
  `packages/nav/src/local-group.ts:84`) and the in-line comment there claims unit-consistency.
  Out of scope for this task; do not scale it.
- **`packages/render-stars/src/pick.ts`** — its contract is correct as written; the caller is
  what violates it.

## Out of scope

- The camera clip planes (shared with the depth-writing planet meshes — a separate decision).
- The render path (TASK-081) and the impostor (TASK-082).
- The galaxy pick unit convention (TASK-086) and the `projectToScreen` path — see Frozen surface.

## Acceptance gate

1. `pnpm verify` exits 0.
2. `pnpm test:e2e` exits 0 — in particular `m1` and the `perception-*` specs, which exercise
   picking in galaxy context and must be unchanged.
3. The new system-context pick test fails on `main` and passes with the fix (state both runs
   in the PR body — this is what proves the test has power).

## Before executing — READINESS GATE ✅ PASSED (measured 2026-07-27)

The premise was unmeasured; it has now been measured live and the task is executor-ready.
Full record: `docs/research/star-pick-ray-origin-context-units.md` (§"MEASURED LIVE"). Summary:

1. **Stars ARE drawn in system context** — 8,125 / 109,399 HYG catalog stars project
   on-screen via `?debug=m4a` at settled `contextId === 'system'`. The "no star renders,
   premise moot" STOP branch did not fire.
2. **The bug is real and user-visible** — at every one of the 12 nearest on-screen stars,
   `pickAt(projected px)` returns a DIFFERENT id than the star projected there (0/12 match;
   e.g. `hyg:118080` projects to (241,439), `pickAt` returns `hyg:7734`). `pcToUnits(system)`
   measured `206266.30`, matching the predicted inflation.

The e2e test therefore reproduces on `main` (projection ≠ pick) and must converge with the
fix (projection == pick). Executor: the measurement probe in the research doc is a working
template for the on-screen-star selection — reuse its manifest fetch + `pcToUnits` conversion.
