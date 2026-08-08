# Root-cause — the "500 pc wall": free-flight stops advancing on the dense Gaia pack

**Status:** fixed (TASK-091, 2026-08-07). Mechanism confirmed by live measurement.
**Related:** `gaia-far-fly-quality-collapse.md` (origin of the guard), `gaia-park-navigation-open.md` §1 (the pre-registered hypothesis this confirms), `hyg-void-nearest-robust-fix.md` (the √3 slack).

## Symptom (as a measurement)

Holding W+SHIFT (forward + speed boost) in galaxy context, the camera flies fast from
Sol and then **stops advancing** at ~500 pc — "like hitting a wall." Measured on the dense
`octree-gaia` pack (`.env.local`): free-flight speed drops to **exactly 0 pc/s at 513.6 pc
from Sol**, with 1268 chunks loaded and **zero uncaught errors** (not a crash/freeze — a
speed-law throttle).

## Mechanism (one sentence)

Past `HYG_SEARCH_MAX_FROM_SOL_PC = 500`, the galaxy speed law was fed by
`streaming.nearestBodyDistanceM = max(0, distUnits − extentCurrent)·ctxMeters`
(`policy.ts:839`), which is **0 whenever the camera is inside a loaded chunk's AABB**; the
dense Gaia octree tiles all space past 500 pc, so the scalar is 0 everywhere →
`distanceToNearestSurface` floors to `MIN_SURFACE_DISTANCE_PC` (1e-7 pc) →
`targetSpeed = clamp(speedScale·1e-7, …)·boost ≈ 0` (`controller.ts:1088/1164`) → a hard wall.

## Taxonomy — a latent regression, unmasked by the pack

- **Introduced:** `405c4ff` (TASK-070, 2026-08-03), the "fix park FPS/black" change. To stop
  the ~90 ms/frame HYG void-search walking empty rings far from Sol, the galaxy feed was
  short-circuited past 500 pc to `streaming.nearestBodyDistanceM`. That wired the
  "0-inside-a-chunk" value into the speed law.
- **Known-temporary:** the same writeup flagged the 500 as a magic proxy to be dropped
  (`gaia-far-fly-quality-collapse.md` Step 6 follow-up), and the WASD-stuck symptom was
  logged the same day as an unconfirmed hypothesis (`gaia-park-navigation-open.md` §1). The
  removal was specced as **TASK-091** — whose dependency (TASK-090 tripwire) shipped, but
  TASK-091 itself was never executed. The guard "just stayed."
- **Why only local:** CI/prod serve the 135-star sample with **no Gaia coverage past 500 pc**
  → `nearestBodyDistanceM = Infinity` → the code fell to the `distToField` branch (large) →
  no wall. Only the dense `.env.local` pack exercises the buggy branch. The `goTo` park path
  also bypasses the speed law, so TASK-070's own testing (search-fly-to) never cruised
  manually past 500 pc.

## Fix (TASK-091)

Replace the magic-500 + streaming feed with the real geometric precondition:
- `computeHygFieldBounds` — the **true** max point radius from the cloud centre (not the AABB
  half-diagonal, which is ~√3× larger and leaves a void-walk shell).
- `galaxyFarFieldSurfacePc` — outside the cloud (or during `goTo`), feed the O(1)
  distance-to-cloud (large → cruise, grid skipped); inside, return a `NaN` sentinel so the
  caller runs the fast HYG grid nearest-star. `streaming.nearestBodyDistanceM` is no longer
  used by the galaxy speed law (the universe branch keeps it).

## Verification

- Live (dense pack): parked 2844 pc from Sol, W+SHIFT → speed ~82 pc/s sustained,
  `distanceToNearestSurfacePc` 1848→2058 pc, errors 0 (pre-fix: 0 pc/s, ~0 surface).
- Unit teeth: `hyg-field.test.ts` (true radius ≠ diagonal), `nav-speed-law.test.ts`
  (cruise-outside / NaN-inside / goTo-preserved / transition). 9/9.
- `pnpm verify` 24/24. e2e `gaia-park-speed-law.spec.ts` green (regression/smoke; teeth are
  environment-dependent on CI — see TASK-091-NOTES.md).

## What would have caught this earlier

- A **magic distance proxy** for "has catalog coverage" is the smell; encode the geometric
  precondition (distance to the actual cloud) instead. Flagged at introduction, not acted on.
- **New reachability re-arms latent cliffs** (LEARN pattern): manual free-flight past 500 pc
  was never exercised until now; the `goTo` park path bypasses the speed law and hid it.
- A gate that runs **only the sample pack** cannot see a dense-pack-only branch — the teeth
  must live in pack-independent unit tests (they now do).
