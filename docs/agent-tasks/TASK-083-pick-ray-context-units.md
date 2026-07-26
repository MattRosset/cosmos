# Task: Convert the star pick ray's origin to parsecs (the pick path's half of TASK-081)

**ID:** TASK-083
**Target package:** `apps/web` (one call site) + `e2e`
**Size:** S
**Phase:** Maintenance track — scale-transition lane
**Depends on:** **TASK-081** (this reuses the `pcScales` helper it introduces).

> **Status: STUB, not spec-reviewed.** Filed from TASK-081's Out-of-scope instruction
> ("write it to `docs/research/` and open a task"). The claim is verified from source; the
> symptom is **not measured**. Run `/spec-review` (or the measurement below) before handing
> this to an executor.

## Goal

Clicking a star selects the star under the cursor in every scale context, not only in
`galaxy`. Today `pickAt` builds its ray origin from `controller.state.position.local`
(active-context units) and feeds it to a pick path whose contract is parsecs, so the origin
is off by 206,266x in `system` and 1e6 in `universe`.

Full writeup, with the source evidence and the fix shape:
`docs/research/star-pick-ray-origin-context-units.md`.

## Step 0 — facts to re-verify (verified 2026-07-25). If any is false, STOP and report.

- **F1 — the origin is context units.** `apps/web/src/scene/StarScene.tsx:239-240`:
  `const p = controller.state.position.local;` → `pickNearestStar(..., p, dir)`.
  `RECHECK: sed -n '239,241p' apps/web/src/scene/StarScene.tsx`
- **F2 — the consumer treats it as parsecs.** `StarScene.tsx:339-341` and `:348-350`
  compute `cameraLocalPc[i] - batch.originPc[i]`; `packages/render-stars/src/pick.ts:12`
  documents "TILE-LOCAL parsecs".
  `RECHECK: sed -n '337,353p' apps/web/src/scene/StarScene.tsx; sed -n '10,20p' packages/render-stars/src/pick.ts`
- **F3 — the direction is unit-free** and must NOT be touched: it comes from the orientation
  quaternion (`StarScene.tsx:233-237`). Only the origin is wrong.
- **F4 — the helper exists** (TASK-081): `apps/web/src/glue/context-scale.ts` exports
  `pcScales(ctx)` with a literal-`1` early return for galaxy.
  `RECHECK: cat apps/web/src/glue/context-scale.ts`

## Deliverables

1. **`apps/web/src/scene/StarScene.tsx`** — scale the ray origin by `unitsToPc` before
   calling `pickNearestStar`. Allocating a 3-tuple here is fine: `pick.ts:13` states the
   path is click-time only. Do not touch `dir`.
2. **A pick test in `system` context.** Galaxy context cannot distinguish the fix from the
   bug (`pcScales('galaxy')` is exactly 1), so a galaxy-only test is a false green. The test
   must enter a system and assert the picked id against a star that is **actually drawn** —
   the pick path ignores the clip planes and will happily resolve stars the far plane
   removed (see TASK-081's F7 measurement).
3. NOTES file with the judgment calls; README row.

## Out of scope

- The camera clip planes (shared with the depth-writing planet meshes — a separate decision).
- The render path (TASK-081) and the impostor (TASK-082).
- Any change to `packages/render-stars/src/pick.ts` — its contract is correct as written;
  the caller is what violates it.

## Acceptance gate

1. `pnpm verify` exits 0.
2. `pnpm test:e2e` exits 0 — in particular `m1` and the `perception-*` specs, which exercise
   picking in galaxy context and must be unchanged.
3. The new system-context pick test fails on `main` and passes with the fix (state both runs
   in the PR body — this is what proves the test has power).

## Before executing

Measure the symptom first, so the task has a stated user-visible cost: enter the Sol system,
click a visibly drawn background star, and compare `__cosmos.pickAt(x, y)` with what is under
the cursor. Record it in the research doc.
