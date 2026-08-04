# Research — robust replacement for the magic-500 HYG void-search guard

**Status:** OPEN — questions + kill conditions committed before investigation (Steps 1–2).
**Motivates:** replacing the temporary `HYG_SEARCH_MAX_FROM_SOL_PC = 500` proxy shipped in
TASK-070 (`NavDriver.tsx`) with a solution that encodes the real precondition.
**Prior art (read to understand the request, NOT the research answers):**
`docs/research/gaia-far-fly-quality-collapse.md`, `docs/research/gaia-park-navigation-open.md`,
`docs/learnings/LEARN-hyg-void-search-rearm-2026-08-03.md`, `NOTES-2026-08-03-task-070.md`.

## Context (established, not under investigation)

`NavDriver` feeds the free-flight speed law (`speed ∝ distanceToNearestSurface`) each frame in
galaxy context by calling `stars.nearestStarIndex` — an expanding-shell search over a 25 pc
spatial grid (`packages/data/src/grid.ts`), up to 200 rings. Parked in an HYG void (Gaia search
park ~2.8 kpc from Sol), no populated cell is ever hit, so the search walks empty rings
(~90 ms/frame → ~11 fps). The shipped hot-fix short-circuits when `distFromSolPc > 500 pc` and
substitutes `streaming.nearestBodyDistanceM`. The docs themselves flag 500 as a magic proxy for
"HYG has coverage here" and name two candidate robust directions:
  (i) fail-fast empty shells inside `grid.ts` (bound the search by the grid's real populated extent);
  (ii) always prefer streaming for the galaxy speed law when the policy is live (drop the 500).

## Step 1 — Falsifiable questions

- **Q1 (mechanism + fail-fast viability).** Is the ~90 ms cost the empty-ring walk to r≈200, and
  can `nearestStarIndex` be made cheap *everywhere* (void or not) by bounding the shell to the
  grid's actual populated extent — so no NavDriver distance guard is needed at all?
- **Q2 (does the grid already know its bounds?).** Does the `SpatialGrid` structure store, or can
  it cheaply derive at build time, its populated cell AABB / max radius — the data a fail-fast
  early-exit needs? Or is it a bare `Map` whose extent costs O(cells) to compute per call?
- **Q3 (is streaming-nearest an adequate speed-law input?).** Does `streaming.nearestBodyDistanceM`
  return a usable distance both near Sol and at a far Gaia park — specifically, does it collapse
  toward ~0 inside a loaded Gaia tile (the WASD-stuck symptom logged in
  `gaia-park-navigation-open.md`)? "Always prefer streaming" is only viable if it does not.
- **Q4 (is 500 pc even the right proxy meanwhile?).** What is HYG's actual populated radius from
  Sol? Is 500 pc over- or under-covering the catalog (false stall inside coverage, or void cost
  just past 500)?

## Step 2 — Kill / redirect conditions (committed BEFORE investigating)

- **Kills direction (i) [grid fail-fast]:** if the grid has no stored bounds AND deriving a usable
  bound per call is not O(1)/cheap, OR if bounding the shell still leaves the *populated* near-Sol
  case walking many rings, then "make nearestStarIndex fast everywhere" is not a clean robust fix
  and the NavDriver guard stays necessary in some form.
- **Kills direction (ii) [always stream]:** if `streaming.nearestBodyDistanceM` collapses to ~0
  inside tiles (Q3), then dropping the star-distance speed law breaks free flight — "always prefer
  streaming" is dead; the robust fix must keep a real nearest-star distance for the speed law.
- **Reframe trigger:** if Q1 shows the truly cheap fix is a bounded/early-exit `nearestStarIndex`
  that also returns a *correct* nearest star at a far park (not just fast), then the whole
  NavDriver 500-guard is the wrong layer and the research reframes to "fix the grid search, delete
  the guard" rather than "pick a better proxy distance."
- **Enable (weakest outcome):** if neither direction is clean, the deliverable is a justified
  interim — keep a guard but replace the magic constant with a build-time-derived HYG radius (Q4).

## Step 3+ — Findings (claims)

_(pending — committing Steps 1–2 first per procedure)_

## What I looked for and didn't find

_(pending)_

## Verdict

_(pending)_
