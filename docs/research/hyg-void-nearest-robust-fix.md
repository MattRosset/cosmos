# Research — robust replacement for the magic-500 HYG void-search guard

**Status:** CLOSED — REFRAME. Questions + kill conditions were committed before investigation
(Steps 1–2, commit precedes any research-question source read); findings below.
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

```
CLAIM:    The ~90 ms/frame void cost IS the expanding-shell walk over empty grid cells;
          it appears ONLY when the camera is outside the HYG populated region, not merely
          "far from Sol". Querying nearestStarIndex against a realistic 109 400-star,
          990 pc-radius grid took 0.002 ms at Sol, 0.001 ms at 600 pc (still in-field),
          and 93.29 ms at the 2835 pc park (deep void) — matching the docs' ~90 ms.
EVIDENCE: scratch test against the real packages/data/src/grid.ts (built grid.size=89 568,
          populated cell AABB [-40, 39]): {nearMs:0.002, edgeMs:0.001, parkMs:93.29}.
VERIFIED: 2026-08-04
RECHECK:  re-create a vitest in packages/data/test that builds buildGrid() over ~109k pts
          uniform in a 990 pc sphere and times nearestStarIndex from (0,0,0), (600,0,0),
          (2835,0,0). Void query ≫ in-field queries.

CLAIM:    The void query still returns the CORRECT nearest HYG star (it is slow, not wrong).
EVIDENCE: same test — nearestStarIndex(...,2835,0,0) returned idx 56900 (≥ 0), the true
          nearest by the shell's exact early-exit; cost is empty-ring lookups, not error.
VERIFIED: 2026-08-04
RECHECK:  assert the park query returns index ≥ 0 and equals a brute-force argmin over the pts.

CLAIM:    streaming.nearestBodyDistanceM is distance to the nearest COVERED chunk's cube
          surface, clamped to 0 — so it is exactly 0 whenever the camera is inside a loaded
          tile (the far Gaia park is inside its tile). It cannot be the galaxy speed-law
          input: 0 → speed floor → WASD immobilized (the open symptom in gaia-park-navigation-open.md §1).
EVIDENCE: packages/streaming/src/policy.ts:772-774 —
          `const distM = Math.max(0, c.distUnits - c.extentCurrent) * ctxMeters;`
          summed as a min over covered chunks; c.distUnits < c.extentCurrent inside the cube.
VERIFIED: 2026-08-04
RECHECK:  read policy.ts §7 update() nearest block; confirm max(0, dist-extent) with no
          per-point refinement.

CLAIM:    The runtime-packed HYG catalog is a Sol-centred sphere of radius ~990 pc: max
          990.1 pc, p99 885 pc, ZERO stars beyond 1000 pc; 11 629 real stars live in the
          500–990 pc shell. The 100000 pc no-parallax sentinels are dropped at pack time.
EVIDENCE: hygdata_v41.csv, cols 18/19/20 = x/y/z pc, col 10 = dist. Excluding dist≥99999
          & dist≤0: count 109 400, p50 194, p90 513, p99 885, max 990.1, >500=11 629,
          >1000=0. Pack filter: tools/pack-stars/src/convert.ts:74 `if (dist >= 99999) return null`.
VERIFIED: 2026-08-04
RECHECK:  `awk -F, '{d=$10;if(d>=99999||d<=0)next;r=sqrt($18^2+$19^2+$20^2);print r}' hygdata_v41.csv | sort -n | tail`.

CLAIM:    500 pc is the wrong constant on both sides. It cuts through real coverage (11 629
          stars in 500–990 pc, where the grid is still ~0.001 ms fast), so past 500 pc the
          current fix needlessly abandons a fast, correct HYG nearest for streaming's
          0-collapsing scalar. The true "HYG has no cells" boundary is ~990 pc.
EVIDENCE: edgeMs 0.001 at 600 pc (in-field, fast) + packed >500=11 629 (above) + the guard
          literal HYG_SEARCH_MAX_FROM_SOL_PC = 500 at NavDriver.tsx:47.
VERIFIED: 2026-08-04
RECHECK:  the two measurements above; grep the constant in NavDriver.tsx.

CLAIM:    NavDriver ALREADY computes the correct geometric precondition and an O(1) far-field
          scalar it currently ignores in favour of streaming: `hygBounds` (field centre +
          radius) and `distToField = hypot(cam - centre) - radius`. At the park distToField
          ≈ 1845 pc — a large, non-zero scalar → fast free flight, no WASD stuck.
EVIDENCE: apps/web/src/scene/NavDriver.tsx:113-131 (hygBounds), :205-208 (distToField);
          the far branch at :210-227 uses streaming.nearestBodyDistanceM, not distToField,
          whenever finite.
VERIFIED: 2026-08-04
RECHECK:  read NavDriver.tsx galaxy-context branch; confirm distToField computed then unused
          when streaming is finite.
```

## What I looked for and didn't find

- **No stored bounds on `SpatialGrid`.** It is a bare `Map<number, Uint32Array>`
  (grid.ts:13); the only min/max in the file is `queryRegion`'s local AABB math, nothing
  persisted. A fail-fast bound would have to be added — but it is one O(count) pass at build
  (buildGrid already does one), so it is cheap, not a blocker. (grep: `bounds|aabb|radius|extent` in grid.ts → only queryRegion internals.)
- **No per-point "nearest Gaia star" anywhere.** Streaming exposes only
  `nearestBodyDistanceM` (tile-cube distance). There is no function that returns the nearest
  actual Gaia point to the camera, so "slow down near the Gaia star you flew to" is not
  implementable today without new machinery. (grep: `nearest` in packages/streaming/src → only nearestBodyDistanceM.)
- **No derivation of 500 from the data.** It is a bare literal in NavDriver.tsx:47; nothing
  computes it from the HYG extent.

## Verdict — REFRAME

The premise "pick a better far-from-Sol distance / prefer streaming past a radius" is the
wrong frame. Two of its pillars are dead:

- **Direction (ii) "always prefer streaming for the galaxy speed law" is KILLED** by the
  `nearestBodyDistanceM = max(0, dist-extent)` claim: it collapses to 0 inside a tile, which
  is exactly where a Gaia park sits — it immobilizes WASD. The current hot-fix already
  inherits this (it *is* the open `gaia-park-navigation-open.md` §1 bug).
- **The magic 500 is wrong on both sides** (cuts real 500–990 pc coverage where HYG is still
  ~0.001 ms fast; true boundary ~990 pc).

The real precondition is **geometric, not a Sol radius, and NavDriver already has it**: the
camera is *outside the HYG populated sphere* (`distToField > 0`), and `distToField` is itself
the correct O(1) far-field scalar (large → fast flight, never 0). So the robust fix is a
reframe from "better proxy distance" to "encode the field-boundary precondition already
computed here."

Two spec-able shapes, both eliminate the magic constant and both fix WASD-stuck:

- **Fix A (minimal, NavDriver-only) — recommended Step 0.** Replace the
  `distFromSolPc > 500` guard with `distToField > margin` (camera outside the HYG sphere),
  and feed the speed law from `distToField` instead of `streaming.nearestBodyDistanceM`. Uses
  only data already computed (hygBounds), O(1), no streaming dependency for galaxy speed,
  no grid walk, no WASD-stuck. Keeps the fast in-field grid path unchanged.
  **Correction (via TASK-091 spec-review):** the ≈1845 pc figure above and this "distToField"
  must use the TRUE max point radius (~990 pc), NOT the current `hygBounds.radius`, which is the
  AABB half-*diagonal* `hypot(hx,hy,hz)` ≈ 990·√3 ≈ 1715 pc. Keying the guard on the diagonal
  leaves a 990–1715 pc shell that is empty of HYG stars yet treated as "inside" → the grid walks
  it (a smaller re-arm of the 93 ms cliff). TASK-091 therefore computes `maxRadiusPc` (true point
  extent from centre) rather than reusing the diagonal `radius`.
- **Fix B (thorough, grid-level).** Make `nearestStarIndex` bounds-aware (store the populated
  cell AABB at build; when the query is outside it, seed/short-circuit so the walk is cheap
  and still returns the true nearest star), then delete the NavDriver far-field guard
  entirely. Also fixes TASK-040 breadcrumb freeze at the root and benefits any other caller.
  More surface, needs its own correctness test (the naive "expand until the AABB is enclosed"
  only cuts ~75% of the cost — still ~20 ms from the park — so Fix B must use an
  outside-AABB seed, not just a ring cap; that is the one open design point).

**Tradeoff to state in the spec:** both fixes make free flight *fast* at a Gaia park (nearest
HYG star / field boundary is ~1.8 kpc away), not *slow near the visible Gaia star*. Slowing
down for nearby Gaia points needs a per-point Gaia nearest that does not exist today (verified
absence) — a separate feature, out of scope for de-magicking the guard.

### Step 0 claims a spec should lift

- Void cost = empty-ring walk, only outside the HYG sphere (93 ms measured).
- `nearestBodyDistanceM` collapses to 0 inside tiles ⇒ unfit as galaxy speed-law input.
- Packed HYG = ~990 pc sphere; 500 pc cuts coverage; ~990 pc is the real boundary.
- `distToField`/`hygBounds` already exist in NavDriver and give the O(1) far-field scalar.

## Decision (2026-08-04) — Fix A, with B recorded as a follow-up

**Chosen: Fix A** (NavDriver `distToField`-boundary guard). Sequenced as TASK-091, *after* the
always-on nav-frame tripwire (TASK-090).

**Why A over B, given the tripwire lands first.** The user's decisive criterion was "never let
this recur *silently*" (it cost ~2 sessions because a 90 ms main-thread stall only looked like a
GPU/throttle issue). The sharpest argument for B was that A is a per-caller guard whose latent
cliff could re-detonate *silently* from a future second caller of `nearestStarIndex`. Once the
tripwire (TASK-090) exists, that residual cliff can no longer be silent — a re-detonation on the
`nav.surfaceFeed` path fires the alarm with context, turning a blind bisect into one log line. So
the general defense against silent recurrence is the **alarm**, not bounding this one primitive;
with that in place the fix reverts to a right-sizing call, and A wins: one file, low risk,
reversible, uses data already computed (`hygBounds`), fixes the observed bug **and** the WASD-stuck
symptom (`gaia-park-navigation-open.md` §1), and encodes the real *geometric* precondition
(outside the HYG sphere) rather than a lifecycle guard — satisfying LEARN D1. The tripwire also
protects A's own implementation: if A's guard fails to prevent the walk, `nav.surfaceFeed` spikes
and the alarm fires.

**B is not discarded — it is deferred** (to a recorded follow-up task). Graduate to B when the
landmine stops being hypothetical: a *second* void-caller of `nearestStarIndex` appears, or we
decide we want defense-in-depth (bounded primitive *and* alarm). Deferring B is cheap precisely
because the tripwire makes any interim regression loud, not silent. B additionally roots TASK-040
breadcrumb-freeze, which is the strongest standing reason to pick it up later.

**What A gives up:** a bounded primitive for hypothetical future callers (YAGNI today), and the
"slow down near the visible Gaia star" nicety — which neither A nor B delivers (needs a per-point
Gaia nearest that does not exist; verified absence above).
