# Task: Make the galaxy impostor's radius context-invariant (fix the 1e6 oversize outside galaxy)

**ID:** TASK-082
**Target package:** `packages/render-galaxy` + `apps/web/src/scene/GalaxyScene.tsx`
**Size:** S
**Phase:** Maintenance track — scale-transition lane
**Depends on:** nothing. **Blocks TASK-080** (an ascent must not land on a broken view).

## Goal

The Milky Way's far-LOD impostor is drawn at the same **physical** size regardless of which
scale context the camera is in. Today it is correct in `galaxy` and **1e6 times oversized in
`universe`**, which is exactly the context TASK-080 makes reachable.

This is a pre-existing defect, already rendered today by `flythrough3` / `m3` / `soak3`
(their path starts at universe `[0,0,0.6]` Mpc). It is the same bug class TASK-081 fixes for
the point renderers, split out because it lives in a different renderer and has a different
shape: the impostor bakes its size into geometry at construction instead of reading it per
frame.

## Step 0 — facts to re-verify (verified 2026-07-25)

**If any is false, STOP and report.**

- **F1 — the radius is baked once, in parsecs.**
  `packages/render-galaxy/src/impostor.ts:22` (`PlaneGeometry(1,1)`) and `:42`
  (`mesh.scale.set(radiusUnits, radiusUnits, 1)`), fed `impostorRadiusUnits` at
  `GalaxyScene.tsx:241-243`, which comes from `milkyWayRadiusPc` (`StarApp.tsx:593`,
  `milkyWay.radiusKpc * 1000` ⇒ ≈ 15,000 **pc**).
  `RECHECK: sed -n '18,45p' packages/render-galaxy/src/impostor.ts`
- **F2 — the offset it is combined with is in ACTIVE-CONTEXT units.**
  `GalaxyScene.tsx:541-545` (`origin.toRenderSpace(posScratch, offScratch)`) → `:268`
  (`impostor.setRenderOffset(offset)`).
  `RECHECK: sed -n '538,548p' apps/web/src/scene/GalaxyScene.tsx`
- **F3 — the ratio is exactly 1e6.** `CONTEXT_UNIT_METERS.universe / .galaxy` =
  3.0857e22 / 3.0857e16 (`packages/core-types/src/coords.ts:12-17`).
- **F4 — it really draws in universe context.** `procgenBlend` is initialised to `1` and
  only recomputed `if (ctx === 'galaxy')` (`GalaxyScene.tsx:492-504`), so the layer is on;
  and at far LOD `cloudFactor → 0` (`:256`), so the impostor carries full opacity (`:268-269`).
  `RECHECK: sed -n '490,510p' apps/web/src/scene/GalaxyScene.tsx`

## Frozen Interface

`CONTEXT_UNIT_METERS` and every switch threshold are unchanged. `GalaxyImpostor`'s existing
methods keep their signatures; this task **adds** one.

```ts
/** Set the impostor's radius in ACTIVE-CONTEXT units. Cheap: writes mesh.scale only. */
setRadiusUnits(radiusUnits: number): void;
```

## Deliverables

1. **`packages/render-galaxy/src/impostor.ts`** — add `setRadiusUnits`, which does the same
   `mesh.scale.set(r, r, 1)` the constructor does. Keep the constructor argument and its
   meaning; this only makes the value re-settable.
2. **`apps/web/src/scene/GalaxyScene.tsx`** — in the procgen mount's `applyFrame`, call
   `impostor.setRadiusUnits(impostorRadiusPc * pcToUnits)` each frame, where `pcToUnits`
   comes from the same helper TASK-081 introduces (`apps/web/src/glue/context-scale.ts`).
   Exactly `1` in galaxy context ⇒ **bit-identical there**.
   *If TASK-081 has not merged*, create that helper as part of this task with the identical
   contract (exact-`1` early return for galaxy) rather than inlining a ratio here.
3. **Unit test** (`packages/render-galaxy/test/`): the impostor's **world-space radius in
   metres** is invariant across contexts — assert `radiusUnits × CONTEXT_UNIT_METERS[ctx]`
   is equal for `galaxy` and `universe` inputs to within a relative 1e-12, and that the
   galaxy case is exactly the pre-change value.

## Out of scope

- `dust-lanes` and `hii` (they take centres/radii in pc from the same offset and carry the
  same bug — a follow-up task; note it, do not fix it).
- The point renderers (TASK-081) and the camera clip planes.
- Any change to what is *drawn* at universe scale beyond the size correction.

> Findings during this task go to `docs/research/`; scope creep goes to a new task file,
> not into this diff.

## Failure modes

- **Setting the scale once on context change instead of per frame.** Mounts are created
  dynamically per streaming tile; one created after the last context change would keep the
  constructor's value. Write it every frame — it is one `Vector3` write, allocation-free.
- **Computing the galaxy factor instead of returning exact `1`.** Same trap as TASK-081: a
  ratio-of-ratios can land on `0.9999999999999999` and silently move galaxy-context
  baselines.
- **Assuming this makes universe context look *right*.** It makes the impostor the right
  *size*. What else is (or is not) drawn up there is TASK-080's reporting job.

## Acceptance gate

1. `pnpm verify` exits 0, including the new invariance test.
2. `pnpm test:e2e` exits 0. `flythrough3` / `flythrough4` / `m3` / `soak3` traverse universe
   context and are the specs at risk; their deterministic assertions must hold unchanged.
   Any **universe-context** screenshot baseline is expected to move — re-record and attach
   before/after. **No galaxy-context baseline may move**; if one does, stop and report.
3. NOTES file committed with the judgment calls.

## Verification beyond the gate (report, do not assert)

Fly the recorded descent (`?debug=flythrough3`) and report what the Milky Way looks like
from universe context before and after — apparent size on screen, and whether it now reads
as a bounded object rather than filling the viewport. Attach both frames to the PR. This is
the observation TASK-080's Decision 2 depends on.

## Context Files

- `packages/render-galaxy/src/impostor.ts` — the baked scale
- `apps/web/src/scene/GalaxyScene.tsx:241-243, 256, 268-269, 490-510, 538-548` — the feed, the blend, the offset
- `docs/agent-tasks/TASK-081-point-renderer-context-units.md` — the same bug class in the point renderers; reuse its helper
- `docs/research/star-sprite-goes-dark-on-system-entry.md` — how this class of bug was found
