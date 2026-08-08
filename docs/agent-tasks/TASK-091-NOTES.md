# TASK-091 — implementation notes (judgment calls, logged as-you-go)

Fix: replace the magic-500 HYG guard + `streaming.nearestBodyDistanceM` galaxy speed-law
feed with a true HYG field-boundary precondition. Diagnosis that motivated it:
`docs/research/gaia-park-navigation-open.md` §1 (WASD "wall"), confirmed by live
measurement — see the root-cause writeup `docs/research/gaia-500pc-speed-wall.md`.

## Judgment calls

1. **e2e #4 teeth demoted to REGRESSION/SMOKE (the spec's pre-registered STOP).** The spec
   mandates a pre-flight: run the new e2e against pre-fix HEAD and confirm the
   `distanceToNearestSurfacePc > 100` assertion FAILS; if it passes pre-fix, STOP and
   reconcile. It *does* pass pre-fix on CI. Reasoning (pre-resolved from measurement, not a
   guess): the streaming-0 feed only occurs when a Gaia octree chunk actually *covers*
   `[2835,0,0]`, which happens only on the dense `octree-gaia` pack (local `.env.local`).
   CI serves the 135-star sample with NO coverage there, so pre-fix falls through to
   `distToField` (AABB diagonal ~1715 → ~1120 > 100) and PASSES → toothless on CI. The
   environment-independent teeth therefore live in the unit tests
   (`hyg-field.test.ts`, `nav-speed-law.test.ts`), which test the two extracted pure
   functions directly. The e2e is kept as (a) live-integration confirmation and (b) a
   regression guard: `errorsTotal === 0` rides TASK-090's tripwire so a future re-detonation
   of the HYG void walk at this park fails it. **Live confirmation on the dense pack**
   (2026-08-07, RX 9070 XT, dev server): parked at 2844 pc, holding W+SHIFT →
   `distanceToNearestSurfacePc` 1848→2058 pc, speed ~82 pc/s sustained (pre-fix: 0 pc/s,
   surface ~0 — the wall). errorCounts.total = 0 throughout.

2. **`surfaceFeedHolder` initial value = 1**, matching the controller's own
   `distanceToNearestSurface = 1` default (controller.ts:418), so the hook getter reads a
   sane value before the first galaxy frame writes it (rather than 0, which reads as "at a
   surface").

3. **`surfaceFeedHolder` written in BOTH galaxy sub-paths** (far-field scalar AND the grid
   nearest-star), not only the far-field branch, so `distanceToNearestSurfacePc` faithfully
   mirrors the *last galaxy scalar fed* regardless of which branch ran. If the grid finds no
   star (`i < 0`) the holder keeps its last value (same "keep last" semantics the system feed
   uses).

4. **`navScratch.distToField` now carries `distToCloud`** (computed from the true
   `maxRadiusPc`) rather than the old AABB-diagonal `distToField`. The field is report-only
   (the TASK-090 tripwire context); the name is kept to avoid churn in the scratch shape and
   the diagnostics reader. Semantically it is still "distance to the HYG field".

5. **Test-fixture bug found & fixed during the unit run** (not a task decision, logged for
   provenance): the first `hyg-field.test.ts` sphere-shell helper placed "interior" filler
   at `(r,r,r)` (magnitude `r·√3`), which stuck OUT past the intended shell radius, so the
   production function correctly reported a larger max radius and the test failed. Fixed the
   fixture (filler magnitude `r`, via `1/√3`) — the production code was right.

## Gates

- `pnpm verify` — 24/24 green (lint + typecheck + unit + build).
- New unit tests: 9/9 green.
- New e2e `gaia-park-speed-law.spec.ts` — smoke/regression (teeth note above).
