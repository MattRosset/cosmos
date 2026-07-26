# The star pick ray's origin is in context units while the batch it subtracts is in parsecs

**Found:** 2026-07-25, during TASK-081 review (the spec names it under Out of scope and asks
for exactly this writeup plus a task).
**Status:** verified from source, **not yet measured live**. Deliberately not fixed in
TASK-081's diff.

## The claim

```
CLAIM:    `pickAt` builds its ray origin from `controller.state.position.local`, which is in
          ACTIVE-CONTEXT units, and hands it to a pick path whose contract is PARSECS. In
          galaxy context the two coincide, so the bug is invisible; in `system` context the
          origin is wrong by a factor of 206,266, and in `universe` by 1e6.
EVIDENCE: SOURCE, verified 2026-07-25.
          - apps/web/src/scene/StarScene.tsx:239-240 — `const p = controller.state.position.local;`
            then `pickNearestStar(hygBatch, exoBatch, combined, p, dir)`. `.local` is in the
            active context's units (packages/coords/src/origin.ts header).
          - apps/web/src/scene/StarScene.tsx:339-341 — the parameter is named
            `cameraLocalPc` and is used as `cameraLocalPc[i] - hygBatch.originPc[i]`, i.e.
            a parsec quantity is subtracted from it. Same at :348-350 for the exo batch.
          - packages/render-stars/src/pick.ts:12 — `pickStar`'s docstring: "Ray origin and
            direction are TILE-LOCAL parsecs (caller subtracts batch.originPc)."
VERIFIED: 2026-07-25
RECHECK:  sed -n '239,241p;337,353p' apps/web/src/scene/StarScene.tsx
          sed -n '10,20p' packages/render-stars/src/pick.ts
```

## Why it is the same bug as TASK-081, and why it was split out

TASK-081 fixed this exact contract violation on the **render** path: `setRenderOffset`
documented parsecs while all four call sites passed active-context units. The **pick** path
carries the identical mistake through a different call chain, and TASK-081's spec explicitly
kept it out of that diff (its Out of scope section) so the render fix stays a one-uniform,
bit-identical-in-galaxy change.

## What it costs, and what it does not

`pickStar` selects by **angular** distance from the ray, so what a wrong origin corrupts is
the parallax between the camera and the batch origin — not the ray direction, which is built
from the orientation quaternion and is unit-free (`StarScene.tsx:233-237`).

Consequence: outside galaxy context the pick behaves as though the camera were at a wildly
displaced position relative to the star field. In `system` context the origin is inflated by
206,266x, so clicking a star should select the wrong one — or nothing.

**Not measured.** No live A/B has been run. Before anyone cites a user-visible symptom, the
recheck is: enter the Sol system, click a visibly drawn background star, and compare
`__cosmos.pickAt(x, y)` against the star actually under the cursor. Note that the pick path
is **geometric** and ignores the camera clip planes, so it resolves stars that are not drawn
at all — a pick test in system context must be read against what is on screen, not against
the catalog.

## The fix shape (for the task, not applied here)

Convert the ray origin to parsecs at the single site where it enters the pick, reusing the
helper TASK-081 introduced:

```ts
// apps/web/src/scene/StarScene.tsx:239
const { unitsToPc } = pcScales(controller.contextId);
const p: [number, number, number] = [
  controller.state.position.local[0] * unitsToPc,
  controller.state.position.local[1] * unitsToPc,
  controller.state.position.local[2] * unitsToPc,
];
```

`pcScales('galaxy')` returns literal `1`, so galaxy-context picking stays bit-identical and
every existing pick test (`m1`, `perception-*`) is unaffected. Allocation is acceptable here
— `pickAt` is click-time only, which `pick.ts:13` already states.

The gate should be a test that picks in **system** context, since galaxy context cannot
distinguish the fix from the bug.
