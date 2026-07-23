# Research: universe-scale layer + scale-descent guided tour — preflight

**Date:** 2026-07-23
**Decision this serves:** whether to spec (a) a procedural universe of galaxy-points
where only the Milky Way is selectable, and (b) a redesigned guided tour that is a
continuous zoom Universe → Milky Way → star field → Solar System → Earth. The question
is *what, if anything, must close before that spec is written*.

**Status while investigating:** Steps 1–2 below (questions + kill conditions) are written
and committed **before** any source file was opened, per the research skill. Findings are
appended after.

---

## Step 1 — Falsifiable questions

- **Q1 (scaffold vs net-new).** At the Universe/Cosmos scale today, does the renderer draw
  any point/geometry field, or is it empty/placeholder above galaxy scale?
- **Q2 (performance floor).** Does a continuous descent through all scales stay within
  frame budget on the hardware floor (integrated Iris Xe / Apple M1 class), and where in
  the descent does cost spike?
- **Q3 (transition mechanics).** Is today's scale change a continuous camera zoom or a
  fade/cut? Can a no-cut descent be driven by what exists?
- **Q4 (coordinate precision).** Is position local-per-mode or global, and does crossing
  many orders of magnitude in one continuous motion risk f32/f64 blowup?
- **Q5 (real vs procgen).** Which scales are real catalog data vs procedural?
- **Q6 (open tasks).** Which tasks in the `check:tasks`-gated index are actually open, and
  which of those block the tour path or an HN launch?

## Step 2 — Kill / redirect conditions (written first)

- **Q1 kills the "one missing asset" framing** if the universe scale already renders a
  point field with selection plumbing — then the work is an extension task, not a new
  layer, and the spec shrinks. It **redirects** if the universe scale turns out to be
  unreachable by the camera at all (no mode above galaxy), which would make the tour's top
  end net-new *navigation*, not just net-new geometry.
- **Q2 kills the whole tour spec (for now)** if a throttled descent blows the frame budget
  at a point on the tour path itself and the cause is structural (no tier scaling, fill
  cliff) — the tour would be specced on top of a floor that cannot carry it. It is
  **not** a blocker if the spike is off-path or fixable inside the tour task.
- **Q3 forces new camera-path work into the spec** if transitions are fades/cuts with no
  continuous-parameter path. If a continuous zoom already drives mode changes, "reuse
  scale-jump" is verified and the spec is smaller.
- **Q4 blocks** if positions are float32 in a single global frame — a continuous descent
  would visibly break, and precision work must land before the tour. It is **not** a
  blocker if each mode reframes locally (rebasing), because the descent then never holds a
  large coordinate in a small type.
- **Q5 kills nothing** but changes copy/labelling requirements; if any scale currently
  *implies* real data where it is procedural, that is an honesty defect to fix in the tour
  spec.
- **Q6** produces the ordered list. A task blocks only if the tour path or first-load
  experience demonstrably depends on it; everything else defers.

**Verdict is allowed to be "nothing blocks — spec it now."**

---

## Findings

_(appended below after investigation)_
