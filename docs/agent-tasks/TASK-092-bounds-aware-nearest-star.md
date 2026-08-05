# Task (FOLLOW-UP — deferred): Bounds-aware `nearestStarIndex` (Fix B)

**ID:** TASK-092
**Target package:** `packages/data` (grid.ts / source.ts)
**Size:** M
**Status:** DEFERRED — do not start until a graduation condition below is met.
**Depends on / supersedes:** TASK-091 (Fix A) is the shipping fix; this would let TASK-091's
NavDriver far-field guard be deleted.

## Why this exists (and why it is deferred)

`packages/data/src/grid.ts` `nearestStarIndex` has a latent cost cliff: an expanding-shell search
that, from a query point outside the HYG point cloud, walks empty rings — ~93 ms at a 2.8 kpc park
(measured, `docs/research/hyg-void-nearest-robust-fix.md`). TASK-091 (Fix A) neutralises this at the
**only current caller** (the NavDriver galaxy speed law) by not calling the primitive from outside
the cloud, and TASK-090's tripwire makes any re-detonation **loud, not silent**. So the primitive's
latent cliff is contained and alarmed — Fix B (bounding the primitive itself) is **not needed now**
and would be premature surgery on a hot, zero-allocation, correctness-critical function for a hazard
with one guarded caller. Decision + rationale: `hyg-void-nearest-robust-fix.md` §Decision (2026-08-04).

## Graduation conditions (pick this up when ANY holds)

1. A **second caller** of `nearestStarIndex` appears that can query from outside the cloud (Fix A's
   guard protects only NavDriver; a new caller re-arms the cliff — the tripwire would catch it, but
   then bounding the primitive becomes the right fix).
2. We want **defense-in-depth** on purpose (bounded primitive *and* the alarm), not just the alarm.
3. We take up **TASK-040 breadcrumb-freeze at the root** — Fix B also removes that class of
   grid-walk freeze, which is its strongest standing reason.

## Sketch (to be turned into a full spec at graduation, not before)

Make `nearestStarIndex` cheap AND correct when the query is outside the populated cells:
- Store the populated cell AABB (min/max cell coords) at build time in `buildGrid` — one extra
  O(count) pass; the structure is a bare `Map` today with no bounds (verified absence,
  `hyg-void-nearest-robust-fix.md` §What I looked for and didn't find).
- When the query point is outside that AABB, do NOT expand shells from the query cell (the naive
  "expand until the AABB is enclosed" still costs ~75% of the walk — ~20 ms from the park; that is
  the one open design point). Seed from the nearest populated region instead so the walk is a few
  rings and still returns the TRUE nearest star.
- Add a brute-force-parity unit test (mirror `packages/data/test/grid.test.ts` "matches brute-force
  for random probes") covering far-outside queries, and a timing check that the far query is not
  materially slower than an in-field query.
- Then delete TASK-091's NavDriver far-field guard (the primitive is safe for any caller) — or keep
  it as defense-in-depth, a call to make at graduation.

## Context Files

- `packages/data/src/grid.ts` — the primitive + expanding-shell search.
- `docs/research/hyg-void-nearest-robust-fix.md` — measurements, Fix A vs B, §Decision.
- `docs/agent-tasks/TASK-091-hyg-field-boundary-guard.md` — the Fix A guard this would let us delete.
- `docs/research/TASK-040-breadcrumb-freeze.md` — the other cliff Fix B roots.
