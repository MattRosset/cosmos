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

## Step 3–4 — Findings (claims)

```
CLAIM:    In galaxy context with the real catalog fully covering the cut
          (catalogCoverage == 1, streaming.renderedPoints ≈ 1.11M, procgenOpacity 0),
          sweeping __cosmos.pickAt over the ENTIRE viewport returns only `hyg:*` and
          `exo:*` bodyIds — never `gaia:*` and never `hyg-v41:*`. Gaia DR3 stars that
          exist only in the streamed octree are NOT individually pickable.
EVIDENCE: runtime sweep, 8px grid over 882×910, 12654 non-null hits,
          prefixCounts = { hyg: 12611, exo: 43 }, samples { hyg:"hyg:6198", exo:"exo:hd-3167" }.
          Center pick (441,455) = "hyg:0". Measured 2026-07-27 on the default sample pack.
VERIFIED: 2026-07-27
RECHECK:  load app (galaxy context), run in console:
          `(()=>{const c=window.__cosmos,W=innerWidth,H=innerHeight,p={};for(let y=0;y<H;y+=8)for(let x=0;x<W;x+=8){const id=c.pickAt(x,y);if(id)p[String(id).split(':')[0]]=(p[String(id).split(':')[0]]||0)+1;}return p;})()`
          — expect keys ⊆ {hyg, exo}; a `gaia` key would falsify this claim.
```

```
CLAIM:    The only star-pick site in the app is StarScene.pickNearestStar, which
          iterates exactly two batches: hygBatch (= stars.batch, the HYG base pack,
          idPrefix 'hyg') and exoBatch (= combined.extraHostBatch, exo hosts, idPrefix
          'exoidx' → canonicalId → 'exo'). No octree-stream batch is passed to any pick.
EVIDENCE: apps/web/src/scene/StarScene.tsx:104-105 (batches), :273 (pickAt calls
          pickNearestStar(hygBatch, exoBatch, …)), :364-396 (pickNearestStar body,
          builds `${idPrefix}:${catalogIds[i]}` only for those two).
VERIFIED: 2026-07-27
RECHECK:  `grep -rln "Raycaster\|intersectObject\|pickStar\|pickNearest" apps/web/src/`
          → single file (StarScene.tsx).
```

```
CLAIM:    GalaxyScene mounts the streamed octree tiles for RENDER only; it contains no
          pick / raycast / bodyId path. The ~1.11M rendered points are display-only.
EVIDENCE: `grep -n "pickAt|pickStar|pickNearest|bodyId|idPrefix|canonicalId"
          apps/web/src/scene/GalaxyScene.tsx` → no matches; mounts at
          GalaxyScene.tsx:439 `addMount(e.chunkId, e.kind, e.batch)`.
VERIFIED: 2026-07-27
RECHECK:  re-run that grep on GalaxyScene.tsx → expect no matches.
```

```
CLAIM:    The gaia-sourceids.bin sidecar (the real DR3 id source) is never referenced
          in runtime code — Deliverable 1's premise ("designed, never loaded") holds.
EVIDENCE: `grep -rn "gaia-sourceids\|sourceids\|sourceId\|source_id"
          apps/web/src packages/data/src packages/render-stars/src` → none.
VERIFIED: 2026-07-27
RECHECK:  re-run that grep → expect no runtime-src hits (writer in tools/ is not runtime).
```

```
CLAIM:    concatBatches collapses idPrefix to batches[0].idPrefix on a mixed tile — a
          real, already-acknowledged bug (Deliverable 2's target) — but its output feeds
          only the render path, so the "hyg-v41 mis-id" it causes is NOT reachable via
          pick today (per the claims above, the octree stream is unpicked).
EVIDENCE: apps/web/src/glue/octree-combined.ts:201; the test itself documents it:
          apps/web/src/glue/octree-combined.test.ts:131
          ("concat collapses idPrefix; a known BUG-8 follow-up").
VERIFIED: 2026-07-27
RECHECK:  read octree-combined.ts:193-203 (idPrefix: batches[0]!.idPrefix).
```

```
CLAIM:    Current click-pick cost is ~1.2 ms (over base HYG batch + exo batch). A
          brute-force extension of pick to the streamed octree would scan the mounted
          batches too (order 1.1M points across ~10 chunks), i.e. a materially larger
          per-click cost — click-time only, but not free.
EVIDENCE: runtime timing loop, 200 calls to pickAt(441,455) = 1.206 ms/pick; the added
          work is ~1.1M point angular tests (streaming.renderedPoints).
VERIFIED: 2026-07-27
RECHECK:  timing loop in console (see Q3 measurement in transcript).
```

```
CLAIM:    Gaia IS rendered directly — the streamed combined source loads and draws the
          Gaia octree tile. Near Sol the app fetches `octree-gaia-sample/tiles/0_0.bin`
          (200), i.e. the 135-star Gaia sample is decoded + mounted alongside the HYG
          octree tiles. So "rendered" and "pickable" diverge: Gaia renders, but is unpicked.
          Caveat: the DEFAULT pack is the 135-star sample (packs.ts:26); the dense visible
          galaxy is procgen, not real Gaia. renderedPoints (≈1.11M) counts octree+procgen
          visible chunks together (policy.ts:752-761), so it is NOT a Gaia count.
EVIDENCE: CDP network log shows GET .../octree-gaia-sample/tiles/0_0.bin → 200 and
          .../octree/tiles/{0_0,1_0..1_7}.bin → 200. Code: StarApp.tsx:170
          (octreeCombined = combineOctreeSources([octree, gaiaOctree])), :239 (fed to
          streaming). Gaia sample manifest sums to 135 star pointCount.
VERIFIED: 2026-07-27
RECHECK:  DevTools/CDP Network filtered to "octree" after load near Sol → expect a
          `octree-gaia-sample/tiles/*.bin` 200. NOTE: the main-thread
          `performance.getEntriesByType('resource')` does NOT show these — octree tiles
          are fetched in the decode WORKER (cosmos.worker.ts), invisible to the main
          thread. Use CDP/DevTools network, not the Performance resource API.
```

> **Measurement-artifact correction (honesty, rule 4):** a first pass read tile fetches
> via `performance.getEntriesByType('resource')` on the main thread and saw ZERO Gaia
> tiles — nearly minting a false "Gaia is not rendered" claim. The octree decode runs in
> a Web Worker, whose `fetch`es do not appear in the main-thread resource timeline. The
> CDP network log (which does see worker traffic) shows the Gaia tile loading. The claim
> above is from the CDP measurement; the resource-API reading was discarded as an artifact.

## Step 5 — What I looked for and did NOT find (verified absences)

- **No octree-stream pick path.** No `Raycaster`, `intersectObject`, `pickStar`, or
  `pickNearest` anywhere except `StarScene.tsx`; `GalaxyScene.tsx` has none. The 1.11M
  streamed points are unpickable.
- **No `gaia:*` bodyId ever produced by a click.** A full-viewport runtime sweep at
  coverage==1 produced only `hyg:*`/`exo:*`. `pickNearestStar` constructs no `gaia:` id.
- **No sidecar load at runtime.** `gaia-sourceids.bin` / `sourceId` / `source_id` absent
  from all runtime src trees.
- **No second `pickProbeHolder` registrant.** Only StarScene registers the pick closure
  (test-hook.ts:204 holder; StarScene.tsx:312 sole writer). Scale/zoom does not swap in a
  different pick that could see the octree.

## Step 6 — Verdict: REFRAME

The premise of TASK-069 as written — *"Gaia stars are already pickable; only the returned
identity is wrong (`gaia:<denseIndex>`), swap it for the real source_id"* — is **false and
now measured false**. A click never yields a `gaia:*` id at all (CLAIM 1); the sole pick
site is blind to the streamed octree by construction (CLAIMS 2–3). So Deliverable 3 ("where
the picked star's bodyId is built, a Gaia star resolves denseIndex → source_id") has **no
target in current code** — there is no `gaia:` bodyId site to rewire.

The real question is therefore not "fix the identity" but **"make the streamed octree
pickable at all, then attach real identity."** That splits cleanly:

- **Enable now (premises verified true):** Deliverable 1 (sidecar loader — CLAIM 4 confirms
  it's unwired) and Deliverable 2 (concatBatches idPrefix range-map — CLAIM 5 confirms the
  bug is real) are both implementable and correct as render/data-correctness work,
  **independent of pick**. They should be their own task.
- **Prerequisite that TASK-069 silently assumed:** an octree-stream pick path (CLAIMS 1–3).
  This is a NEW capability, not "identity swap." Cost is bounded but non-trivial (CLAIM 6);
  the octree already provides the spatial structure to avoid a naive 1.1M brute-force scan,
  which is the main design decision for that task.
- **Reframe candidate:** if the goal is "Gaia realness the user can reach," search-by-id
  (TASK-070) may deliver it without solving spatial pick over 1.1M streamed points — worth
  weighing before committing to the pick prerequisite.

Which claims carry the verdict: CLAIM 1 (runtime sweep — no `gaia:*` pickable) kills the
premise; CLAIMS 2–3 explain why (structural pick blindness); CLAIMS 4–5 preserve D1+D2 as
still-valid standalone work.

