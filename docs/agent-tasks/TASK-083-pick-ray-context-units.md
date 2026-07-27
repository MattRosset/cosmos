# Task: Convert the star pick ray's origin to parsecs (the pick path's half of TASK-081)

**ID:** TASK-083
**Target package:** `apps/web` (one call site) + `e2e`
**Size:** S
**Phase:** Maintenance track — scale-transition lane
**Depends on:** **TASK-081** (this reuses the `pcScales` helper it introduces).
**Dependency status:** TASK-081 and TASK-084 are **merged to `main`** (PR #34, a8a3fe5);
`pcScales` is live at `apps/web/src/glue/context-scale.ts:30`.

> **Status: spec-reviewed 2026-07-27** (against `main` @ a8a3fe5). Facts re-verified; the
> F1/F2/F3 line citations below were corrected (TASK-086 inserted the local-group galaxy
> pick + system planet raycast ahead of the star pick, shifting every line ~20 down). The
> frozen surface was expanded to name the two OTHER `position.local` reads that must NOT be
> scaled. The symptom is still **not measured live** — the "Before executing" measurement
> is still required.

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

## Before executing — READINESS GATE, not optional

The test premise is **unmeasured** and could invalidate the approach, so measure first and
record it in the research doc:

1. Enter the Sol system; confirm **background stars are actually drawn** in system context
   (not clipped away by the far plane — the pick is geometric but the *assertion* must target
   a rendered star; §Deliverables 2). If NO catalog star renders in system context, STOP:
   the "click a background star in system" premise is moot and the task needs re-scoping.
2. Click a visibly drawn background star and compare `__cosmos.pickAt(x, y)` with what is
   under the cursor — this is the stated user-visible cost and the on-`main` half of the
   power proof (gate item 3).

If both hold, the deliverables above are executor-ready; if (1) fails, do not hand off.
