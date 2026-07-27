# Research: Is the Gaia octree stream pickable? (TASK-069 premise gap)

**Status:** in progress
**Author:** research pass, 2026-07-27
**Trigger:** spec-review of TASK-069 (Gaia pick identity) found — by *static reading only* —
that the sole pick site (`StarScene.tsx`) runs over the HYG base batch + exo-host batch, and
that the streamed Gaia octree (`octreeCombined`, rendered in `GalaxyScene`) has no pick path.
The user correctly pushed back: a static read is a hypothesis, not a measurement. This doc
converts "Gaia is not pickable" into a **runtime-measured** claim and maps the solution space.

> Honesty note (rule 4): the static reading below was already done during spec-review last
> turn. What is NEW and decisive here is the **runtime measurement** (Q1) — clicking a Gaia
> star in the running app and observing the returned bodyId. Steps 1–2 (questions + kill
> conditions) are committed BEFORE that measurement is taken.

---

## Step 1 — Falsifiable questions

**Q1 (decisive, runtime).** When the user clicks on a rendered Gaia DR3 star (one that exists
*only* in the streamed `octreeCombined` tiles, not in the HYG base pack), does
`__cosmos.pickAt(x, y)` return a `gaia:*` bodyId, some *other* bodyId (a nearby HYG/exo star),
or `null`?

**Q2 (static, corroborating).** Is there any code path that raycasts / geometrically picks the
mounted octree chunks (the `'octree'` kind mounts in `GalaxyScene`)? Or is the only star pick
the one in `StarScene.pickNearestStar` over `hygBatch` + `exoBatch`?

**Q3 (solution space).** If Gaia is not pickable, what are the available solution shapes to
wire pick → real DR3 identity, and what does each cost / touch? (This only matters if Q1/Q2
confirm the gap.)

## Step 2 — Kill / redirect conditions (committed before measuring)

- **Kills the spec-review finding, VALIDATES TASK-069 as written:** if Q1 shows a click on a
  Gaia-only star returns `gaia:<denseIndex>`, then Gaia *is* pickable and the task's premise
  ("pickable, only the identity is wrong") holds — my static read missed a pick path, and
  TASK-069 can proceed roughly as specced (loader + identity swap).
- **Confirms the gap, BLOCKS/REFRAMES TASK-069:** if Q1 returns `null` or a *non-Gaia*
  bodyId (nearby HYG/exo star) for a click centered on a Gaia-only star, then Gaia stars are
  not individually pickable, Deliverable 3 has no target, and the task must be reframed
  (split D1+D2 from D3, add an octree-pick prerequisite).
- **Redirect:** if Q1 is impossible to stage (no Gaia-only star is isolable on screen in the
  sample pack), fall back to Q2's static proof + a narrower runtime probe (does any mounted
  octree object carry a `bodyId` / participate in `pickAt`?).

---

## Step 3–5 — Findings (claims + absences)

_(populated after this file is committed)_

## Step 6 — Verdict

_(pending)_
