# Research — risks of flushing octree tiles DURING flight (fix for the black galaxy→starfield fly-in)

Premise under audit (option 2): replace the all-or-nothing octree deferred-mount
(`GalaxyScene.tsx` `deferredOctree` + flush gated by `if (!flying)`,
`OCTREE_FLUSH_PER_FRAME = 2`) with a throttled flush that **also runs during flight**,
so a galaxy→starfield fly-in never renders a black/empty field on Mac/Metal.

Already root-caused + confirmed live (separate session, this same tree): the black
frame coincides with deferred tiles NOT mounted (points drawn frozen at 220,751 vs
894,849 at rest; center-patch lumaMax 15 vs 765). The extreme experiment (mount all,
no throttle) measured 60 fps / 0 long frames on this M1. This doc does NOT re-litigate
the root cause; it audits the RISKS of shipping option 2.

Status: research only, no code changed (experiment already reverted; `git diff` clean).

---

## Step 1 — Falsifiable questions

- **Q1.** Was the octree deferral added specifically because mounting tiles *during a
  goTo flight* caused a **measured** frame-budget violation on a target machine?
- **Q2.** Does mounting the octree cut during flight push render past `DEFAULT_BUDGETS`
  (≤ 2M points, ≤ 300 draw calls)?
- **Q3.** Is there a single fixed flush rate that both (a) fills the visible field
  before a typical fly-in ends and (b) stays under the per-frame upload cost that the
  deferral was protecting — or does option 2 need priority ordering, not just a rate?
- **Q4.** Do other flights (M3 descent to `system`, flythrough4 near-Sol budget)
  depend on the `goToActive`-gated deferral, such that changing it regresses them?
- **Q5.** Does any **CI-blocking** invariant or `@perf` spec assert on octree
  mount-timing / draw budget during flight?

## Step 2 — Kill / redirect conditions (written before opening any source file)

- **K1 (redirect).** If Q1 is YES — the deferral exists precisely because
  mount-during-flight blew a measured budget — then option 2 as "just move the flush"
  is unsafe; it must be redirected to "flush during flight *capped to that budget*",
  and the doc must carry the budget number.
- **K2 (redirect).** If Q2 is YES (flight-time mount exceeds 2M pts or 300 draws), the
  fix must include budget enforcement on the flushed set, not only flush timing.
- **K3 (reframe).** If Q3 shows no single rate satisfies both ends, the fix is not "a
  flush rate" — reframe to coverage/near-first priority ordering of the flush queue.
- **K4 (redirect).** If Q4 is YES for any other flight, the change must be scoped so
  those paths keep their current behavior.
- **K5 (block).** If Q5 finds a blocking gate on this path, the fix is not done until
  that gate stays green (or is deliberately re-baselined).

_(Claims, absences, and verdict below are filled in Step 3+ after reading/measuring.)_

---

## Step 3+ — Claims

```
CLAIM:    The octree deferral's stated purpose is to cap GPU-upload cost during flight,
          under the explicit premise that it "caps upload cost WITHOUT blanking what is
          already on screen." That premise holds only when the field is already mounted;
          the galaxy→starfield fly-in evicts the near field first, so the deferral DOES
          blank it — the exact case the premise excludes.
EVIDENCE: docs/research/goto-galaxy-transit-black.md:170-191 ("deferred *new*-mount
          throttle ... caps upload cost without blanking what is already on screen").
          GalaxyScene.tsx:386-393 (deferral) + measured fly-out eviction 1268→204 this
          session (loadedChunks bottoms at ~204 before the fly-in re-streams).
VERIFIED: 2026-07-23
RECHECK:  read goto-galaxy-transit-black.md §"Cause" + GalaxyScene.tsx:386-393; re-run
          the fly-out and read window.__cosmos.streaming.loadedChunks at the vantage.
```

```
CLAIM:    Q1 → NO measured budget tied to goToActive protects the deferral. The guard
          was "meant for the near-Sol flythrough4 descent", but the flythrough4 gate
          replays its path directly and NEVER sets goToActive, so the deferral is inert
          under that gate.
EVIDENCE: docs/research/goto-galaxy-transit-black.md:185-193; `grep -niE
          "goTo|goToActive" apps/web/src/scene/Flythrough4Probe.tsx` → 0 matches.
VERIFIED: 2026-07-23
RECHECK:  grep -niE "goTo|goToActive" apps/web/src/scene/Flythrough4Probe.tsx  (expect none)
```

```
CLAIM:    Q2 → Flushing during flight CANNOT exceed DEFAULT_BUDGETS. The 300-draw /
          2M-point caps are enforced on the cut (coverageList) inside the streaming
          policy, upstream of GalaxyScene. The render loop only draws tiles that are BOTH
          in streaming.visible AND mounted (unmounted ones are skipped), so mount timing
          changes how much of the already-capped cut is realized — never the cap itself.
EVIDENCE: packages/streaming/src/policy.ts:596-622 (enforceBudgets caps coverageList to
          budgets.maxDrawCalls / point cap). GalaxyScene.tsx:512-517
          (`const m = mounts.current.get(v.chunkId); if (m === undefined) continue;`).
          Measured in-flight (deferral OFF): draws stayed ≤300, points ≤~970k (< 2M).
VERIFIED: 2026-07-23
RECHECK:  sed -n '596,625p' packages/streaming/src/policy.ts ; re-run the deferral-OFF
          fly-in wrapping gl.drawArrays and confirm draws ≤300, points < 2,000,000.
```

```
CLAIM:    Q3 → Per-frame mount count during flight is bounded by decode throughput, not
          unbounded. Requests dispatch only while _inFlight < maxInFlight (6), so ≤~6
          tiles become ready per frame; measured mount rate with the deferral OFF was
          ~7–8 tiles/frame (loadedChunks 586→1268 over ~1.5 s of flight) at 60 fps with
          ZERO frames > 50 ms on this M1. Weaker hardware decodes slower ⇒ fewer
          ready/frame ⇒ a gentler flush, not a worse one.
EVIDENCE: packages/streaming/src/policy.ts:700 (`_inFlight < budgets.maxInFlight`).
          budgets.ts:22 (maxInFlight 6). This session's deferral-OFF run: fps_mean 59.9,
          p99 19.2 ms, max 20.1 ms, long50 0.
VERIFIED: 2026-07-23
RECHECK:  grep -n maxInFlight packages/streaming/src/budgets.ts ; re-run deferral-OFF
          fly-in frame-timing probe and confirm long-frame count (>50 ms) is 0 on M1.
```

```
CLAIM:    Q4 → The ONLY other goToActive flight that touches this path is the M3 descent
          (M3DescentProbe uses flight.goTo). Its BLOCKING asserts are mount-timing-
          independent: inFlight≤6, renderedPoints≤tier cap, drawCalls≤300 (all streaming-
          policy peaks) plus blankFrames==0 (context-switch static holds) — none assert
          on how many octree tiles are mounted mid-flight. flythrough3/flythrough4/m4a
          draw-budget asserts are likewise on streaming peaks; flythrough4's scene-draw
          baseline (:239) is inert because flythrough4 never sets goToActive.
EVIDENCE: e2e/tests/m3.spec.ts:141,174-178 (blocking, streaming peaks + blankFrames);
          e2e/tests/flythrough4.spec.ts:196,239; e2e/tests/m4a.spec.ts:136-137;
          M3DescentProbe.tsx:213,258 (goTo). flythrough4 goToActive grep = 0.
VERIFIED: 2026-07-23
RECHECK:  grep -nE "drawCalls|renderedPoints|blankFrames" e2e/tests/{m3,flythrough4,m4a}.spec.ts
```

```
CLAIM:    Q5 → No CI-BLOCKING gate asserts on frame time / mount timing during flight.
          The frame-time gates (m3 "@perf" p95<50, breadcrumb-perf @perf MAX_FRAME_MS 150)
          are reference-machine-only, run under --grep-invert @perf in the CI gate. The
          fly-in this session peaked at 20 ms, far under 150 ms regardless.
EVIDENCE: e2e/tests/m3.spec.ts:208 (tag @perf); e2e/tests/breadcrumb-perf.spec.ts:11,70
          (MAX_FRAME_MS 150, tag @perf); e2e/package.json test:gate = "--grep-invert @perf".
VERIFIED: 2026-07-23
RECHECK:  grep -n "grep-invert" e2e/package.json ; grep -n "@perf" e2e/tests/m3.spec.ts
```

## What I looked for and didn't find

- **No measured upload-cost budget that mount-during-flight would violate.** Searched
  docs (`grep -rniE "deferredOctree|OCTREE_FLUSH|upload (cost|throttl|spike|budget)"
  docs/`) — the only rationale found is the prose "caps upload cost" in
  goto-galaxy-transit-black.md, with NO number and NO gate. The 2/frame throttle sits on
  top of the already-binding maxInFlight=6 decode bound, so its marginal protection is
  small and unmeasured.
- **No blocking gate on scene-mounted octree tile count during a goToActive flight.**
  Grepped e2e for drawCalls/renderedPoints/blankFrames asserts; every blocking one reads
  a streaming-policy peak (enforceBudgets-capped) or a goToActive-inert path (flythrough4).
- **No second consumer of `deferredOctree`/`OCTREE_FLUSH_PER_FRAME`.** `grep -rn` shows
  the queue is pushed only at GalaxyScene.tsx:389 and drained only at :445 — no other
  scene or probe depends on the deferral's timing.

## Verdict — ENABLE (with one scoping constraint)

The premise of option 2 survives. The deferral protects an **unmeasured** upload-cost
concern whose real binding constraint (maxInFlight=6) already bounds the per-frame mount
rate; the render budget (300 draws / 2M pts) is enforced upstream and is untouchable by
mount timing (CLAIM Q2); and no blocking gate asserts on flight-time mount behavior
(CLAIMs Q4, Q5). The one other affected flight (M3) has only mount-timing-independent
blocking asserts. K1–K5 all evaluate to "does not fire."

Step-0 facts a spec should lift: **Q2** (budget is upstream — the flush cannot overflow
it), **Q3** (decode-bounded rate — no unbounded per-frame upload), **Q4/Q5** (no gate
regresses). Scoping constraint carried from K-analysis, not a kill: keep a **small
per-frame cap on the in-flight flush** (belt-and-suspenders on the unmeasured upload cost
and to protect hardware weaker than this M1), rather than mounting the entire ready set
in a single frame. i.e. move the existing `OCTREE_FLUSH_PER_FRAME` drain to also run while
`flying`, NOT delete the throttle.

## Post-implementation addendum (2026-07-23, TASK-079 executed)

```
CLAIM:    The intermittent ~65 ms fly-in frame on M1/Metal is PRE-EXISTING, not caused by
          flushing during flight, and is independent of the flush cap (8 vs 4 identical).
EVIDENCE: git stash of apps/web/src/scene/GalaxyScene.tsx → rebuilt unmodified code →
          fly-in still spikes ~65-68 ms on ~2 of 3 cycles (one clean at 22.8 ms). After-fix
          runs at cap 8 and cap 4 both: lumaMax 765, one ~65-70 ms frame. Baseline == after.
VERIFIED: 2026-07-23
RECHECK:  git stash push apps/web/src/scene/GalaxyScene.tsx; rebuild; measure fly-in frame
          intervals (rAF deltas) over an out→in cycle ×3; expect a ~65 ms frame on some.
```

This corrects an implicit assumption in K3/Q3: a per-frame flush cap does NOT smooth the
fly-in, because the spike is not the flush's per-frame mount count — it is a
deferral-independent scale-jump cost. The cap still matters for the *visibility* pacing
(queue must keep up with decode), not for the hitch. The hitch is out of scope for TASK-079;
a root-cause candidate for later (procgen→catalog hand-off upload/allocation burst).

## Beliefs (second-class — not Step-0 facts; no mechanical RECHECK)

- On hardware weaker than this M1 (measured target), the flush stays gentle because mount
  rate tracks decode rate, which drops on slower devices. Reasoned from maxInFlight=6, not
  measured on other hardware — a spec must not cite this as fact; if a weak-device budget
  matters, measure it there.
