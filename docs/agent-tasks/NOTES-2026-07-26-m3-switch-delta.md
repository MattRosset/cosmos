# NOTES — m3 `galaxy→system switch invisible` red on `fix/task-081-point-renderer-context-units`

Judgment calls logged as they happen (CLAUDE.md "Judgment calls"). Numbers live in
`docs/research/m3-switch-delta-yardstick.md`; this file records the *decisions*.

## 1. Instrumented the probe instead of reading code for suspects

The brief listed three concrete suspects. None of them is measurable from the reported
scalars (`enterSys`, `median`, `max`) — those are aggregates over ~780 frames. First action
was to add a per-frame trace to `M3DescentProbe` (`window.__m3Trace`: frame, delta, context,
phase, `gl.info.render` calls/points/triangles) and a temporary spec that dumps it, so
"which frame was 28.169" becomes a lookup instead of a theory.

Judgment: the trace is **temporary instrumentation**, run uncommitted on both branches
(the probe file is identical on `main`, so the same edit measures both). Decision on whether
any of it ships is deferred to the end.

## 2. Ruled out the monolith gate (suspect 1) from the wiring, not from a measurement

`StarScene`'s monolith gate is `if (streaming !== undefined)`, and `M3App.tsx:146-151`
mounts `StarScene` **without** the `streaming` prop. In `?debug=m3` the gate block never
executes in any context, so it cannot pop at the boundary. Recorded as ruled out by
construction; no experiment spent on it.

Same file, weaker version of suspect 2: `M3App`'s `mountedSystem` falls back to
`M3_SOL_SYSTEM_ID`, so `SystemScene` is mounted from frame 0 — not "mounted at the border".
What it *draws* across the border still has to be measured.

## 3. Reproduced locally before theorising — and it reproduces

Local SwiftShader run of the branch: `enterSys=4.753`, `flight(median=0.688 max=3.091)`.
That is the CI failure (`4.919 ≤ 4.625`) with different numbers, same sign and same
mechanism, so I can iterate locally instead of on CI.

## 4. Trusted a build tail instead of an exit status — one A/B was a false green

`pnpm --filter @cosmos/web build 2>&1 | Select-Object -Last 1` printed a chunk-size warning,
which I read as success. The build had failed on `tsc` (my instrumentation had a type error),
`dist/` kept the previous bundle, and `vite preview` served it — so a far-plane A/B compared
a binary with itself. Caught by grepping the built bundle for the instrumentation string.

Two rules taken from it, applied for the rest of the session: filter build output on
`error TS|✓ built`, **and** have the app report the knob back (`camera.far` went into the
per-frame trace, so every far-plane number in the writeup is backed by the value the running
app actually had).

## 5. Discarded my own layer-attribution experiment after it "worked"

`hide=stars` dropped `enterSys` 4.75 → 0.606 and I nearly wrote it up as "the star field is
responsible". It is a confounded experiment: `StarScene` also owns `camera.near/far`
(`StarScene.tsx:137-141`), so hiding it changes the clip planes as well. Discarded and
replaced with looking at the actual frames.

Related trap, same session: the probe's 160×90 sample cannot resolve a faint star (an 8×8 box
average turns a lone 255 px into ~4), so "the field vanished" from the sample was not
evidence. Every field-population claim in the writeup rests on a full-resolution blob census
instead.

## 6. Judgment call: fix the probe app's composition, not `SystemScene`'s units

The measured cause is `SystemScene` drawn 206,266× oversized in galaxy context. Two fixes
were available:

- **(A)** fix the unit contract in `SystemScene` + `render-planets` (mesh scale, orbit lines,
  atmosphere), or
- **(B)** mount `SystemScene` under the production rule (`contextId === 'system'`), which is
  what `StarApp.tsx:552-558` already does and what `M3App`'s `?? M3_SOL_SYSTEM_ID` fallback
  was overriding.

Chose **(B)** and filed **(A)** as TASK-084. Reasoning, stated because this is the call that
most deserves scrutiny: the m3 gate's own docstring says it drives "the SHIPPED pipeline", and
the frame it was failing on is one the shipped app cannot produce. (A) is a task-sized change
across three renderers, on the same lane as TASK-082/083, and would move recorded baselines in
the other probe apps. Both fixes converge on the same frames anyway — a correctly-scaled system
at the 5,000 AU arrival is sub-pixel, so "draw it correctly" and "don't draw it yet" look
identical to the gate.

**Why this is not weakening the gate:** no threshold, assertion or comparator was touched; the
margin after the fix is 0.001 vs 2.767 (not a knife-edge); both m3 screenshot baselines passed
**unmodified**; and the removed content is filed as a task rather than dropped.

## 7. Did NOT touch the `max` comparator, though it is the deeper fragility

`maxFlightDelta` is a single-sample yardstick: one anomalous frame silently raises the bar for
the thing under test, which is how a 4.9-vs-1.3 discontinuity stayed green for this gate's
whole life. The same shape survives the fix (galaxy leg: median 0.035, p90 0.206, max 3.029).
Left alone deliberately — changing the comparator inside the PR whose job is to turn it green
is the move that must not be made silently. Written up as an observation in the research doc,
with the recommendation that it get its own reasoning and its own commit.

## 8. Instrumentation: reverted, not shipped

The per-frame trace, the full-res census, the PNG capture, the CPU shader replica and the
`hide=`/`pc1=`/`nodepth=` flags were all reverted (`git checkout`), and the temporary spec
deleted. The shipped diff is `M3App.tsx` only. The writeup carries the RECHECK recipes so the
instrumentation can be rebuilt in a few minutes rather than living in the frame path.
