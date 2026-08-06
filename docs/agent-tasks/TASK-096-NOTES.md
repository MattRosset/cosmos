# TASK-096 NOTES — judgment calls

Logged as they arose (2026-08-06).

## JC-1 — added six README rows, not one

**Spec said:** deliverable 2, "Add TASK-096 to `docs/agent-tasks/README.md` with its actual
status and blocker."

**Did:** added rows for TASK-096 *through* TASK-101 in one edit.

**Why:** `tools/check-task-index` rule 3 rejects a blocker id that has no row of its own. A row
for TASK-097 blocked by TASK-096 needs TASK-096 present; the same chain runs through 098-101.
Adding only this task's row would have left the next task unable to add its own without
re-editing, and adding them piecemeal risks a red gate mid-chain.

**Triage:** spec bug (the spec's own acceptance gate would have passed while setting up a
failure for the next task). The spec was amended before execution to say six rows.

## JC-2 — TASK-087..095 rows deliberately NOT backfilled

Those nine tasks have files on disk and no rows in the index — pre-existing drift, unrelated to
this initiative. Backfilling them inside a documentation task about visibility modes would mix
two unrelated changes in one diff, and their statuses need per-task verification this task has
no basis to make. Left alone, explicitly, in the spec's deliverable 2.

**Triage:** doctrine gap — nothing in the task rules says who owns index drift when it is
discovered mid-task. Recorded here rather than fixed silently.

## JC-3 — added a fourth rejected alternative

Deliverable 6 listed three alternatives to document as rejected. Added a fourth — persisting the
mode across boots — because Frozen item 8 asserts "mode starts as Natural on every boot" without
saying why, and an unexplained default invites someone to "fix" it later.

**Triage:** spec bug, minor. A frozen item with no recorded rationale is an incomplete contract.

## JC-4 — decision 9 written as a consequence, not a constraint

Frozen item 9 (Survey pays full price) was added to this spec during review. In the ADR it is
written under Decision rather than Context, because it is a commitment about how downstream work
must REPORT results (per profile, never averaged), not merely an observation about exposure.

## Not a judgment call — verified, not assumed

All four Step 0 facts were re-confirmed against live code before writing:
`EXPOSURE_MIN/MAX/DEFAULT` = 0.1 / 200 / 25 (`app-state/src/settings.ts:15-17`),
`GALAXY_FIELD_EXPOSURE_BOOST = 6` (`GalaxyScene.tsx:107`), `fov: 60`
(`scene-host/src/SceneHost.tsx:202`), `TILE_VISIBILITY_FLOOR = 0.004`
(`tile-brightness-cull.ts:20`).
