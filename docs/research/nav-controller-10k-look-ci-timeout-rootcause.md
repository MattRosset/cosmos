# Root cause: nav controller "10k random look" test — CI-only 5 s timeout

**Date:** 2026-07-14
**Area:** `packages/nav`
**Symptom test:** `packages/nav/test/controller.test.ts` →
`"quaternion stays normalized after 10k random look inputs; pitch is clamped"`
**Status:** root-caused + fixed (explicit per-test timeout)

## 1. Symptom (as a measurement)

The test fails **in CI only**, and not as an assertion — as a wall-clock timeout:

```
Error: Test timed out in 5000ms.
```

Measured wall time on the failing run (main, post-merge of PR #21): **5357 ms**, i.e.
it crossed vitest's default `testTimeout` of 5000 ms by ~350 ms. Borderline. Passes
locally every time (whole nav suite ~1.08 s, 70/70).

Pre-established (not re-derived here): the RNG is seeded (`createPrng(20260611)`), so
the input sequence is identical local and CI — **not** an RNG flake, **not** float
divergence. nav was untouched between PR #20 (CI green) and PR #21 (CI red); PR #21
only touched render-stars/apps/e2e. So a runner/runtime variance flipped a borderline
timing, not a code change.

Quantity to explain: *where do the ~5 s go, and why only on the CI runner?*

## 2. Experiments

Instrumentation spec (throwaway) in `packages/nav/test`, jsdom env, 10k iterations,
breaking the loop body into its parts. Numbers are a fast dev box (RX-class desktop):

| Segment | Total (10k) | Per-iter | Share of loop |
|---|---|---|---|
| **Full loop** (`applyLookDrag` + `update(16)`) | 139.7 ms | 13.97 µs | 100 % |
| `applyLookDrag` only (3 jsdom PointerEvents) | 122.2 ms | 12.22 µs | **87.5 %** |
| `controller.update(16)` only | 1.8 ms | 0.18 µs | 1.3 % |
| `rng.range()` only | 0.17 ms | 0.02 µs | 0.1 % |

Under `--coverage` (the real CI command is `vitest run --coverage`):

| Segment | Total (10k) | Per-iter |
|---|---|---|
| Full loop | 169.4 ms | 16.94 µs |
| `applyLookDrag` (jsdom dispatch) | 138.5 ms | 13.85 µs (82 %) |
| `controller.update` | 6.6 ms | 0.66 µs |

**Discriminating result for Q1 (is `controller.update` an accidental O(n) / per-call
allocation smell?):** No. `update()` is a flat ~0.2–0.7 µs/iter with no growth across
the run; its whole contribution over 10k iters is 2–7 ms. Even at a 100× CI slowdown it
stays well under a second. The controller math is exonerated — there is no perf
regression to fix there.

The cost lives almost entirely in **jsdom `PointerEvent` dispatch**: 10k iterations ×
3 events (`pointerdown`/`pointermove`/`pointerup`) = **30 000 DOM dispatches**, each a
fresh event object walking the full capture/target/bubble path. That path is
allocation-heavy and GC-bound — exactly the kind of work that scales *non-linearly* on
a constrained box.

## 3. Mechanism (one sentence that covers every observation)

The test's wall time is ~85 % jsdom DOM-event dispatch (30k dispatches); on a fast dev
box that whole loop is ~0.14–0.17 s, but on the shared **2-vCPU** GitHub runner
(recently forced onto **Node 24**), under **v8-coverage instrumentation** and
**parallel test-file CPU contention**, that same allocation-/GC-heavy dispatch path runs
slow enough that the test grazed vitest's 5000 ms default (measured 5357 ms) — a
borderline **wall-clock timeout on a deterministic-invariant test**, with no change in
what the test actually asserts.

This covers the weird parts: *why only in CI* (dispatch cost is CPU/GC-bound and the CI
box is slow + loaded), *why borderline* (5357 vs 5000, not 50 000), *why nav wasn't
touched* (it's runner variance amplifying a pre-existing fat margin), and *why the
assertion never fails* (the invariant is deterministic and identical everywhere — only
the clock crossed a line).

## 4. Taxonomy

Single occurrence, and it is **test↔environment coupling**, not a product bug: the
thing under test (quaternion renorm to 1e-9, pitch clamp) is correct and
runner-independent; only the *coverage-count* wrapper (10k jsdom dispatches) is exposed
to runner speed. Same failure class as the repo's e2e flakiness writeup — a test
architecture detail, not a defect in `controller.ts`.

**Is the suite systemically exposed? (Q2)** No. Surveyed every large-loop test:

- `core-types/test/prng.test.ts` (10k/100k) — pure math, no DOM. Cheap.
- `procgen/test/galaxy.test.ts` (1e6 stars) — **already** carries an explicit 45000 ms
  per-test timeout + relaxed CI budget for this exact reason.
- `nav/test/context-switch.test.ts:233` (2000) and `controller.test.ts:231` (2000) —
  `update()`-only, no DOM dispatch. Cheap (~0.4 ms total).

The failing test is the **unique** case that pairs a large count (10k) with the heavy
jsdom dispatch path (30k events). It's an outlier, not a systemic exposure.

## 5. Fix

Give the deterministic-invariant test an explicit generous per-test timeout
(`it(..., 30_000)`), matching the existing repo convention
(`procgen/test/galaxy.test.ts` uses the 3rd-arg form; `streaming/vitest.config.ts` sets
`testTimeout: 30000`). Kept the 10k count — it is drift **coverage** (does float error
accumulate over many reorientations?), not part of the invariant, so weakening it would
lose real signal. Added a comment on the test making the mechanism triagable from the
test alone (CLAUDE.md rule 6).

**Why this and not the alternatives:**

- **Not** a controller change — `update()` is measurably not the cost (§2).
- **Not** reducing 10k → 2k — that cuts drift coverage to buy timing headroom the
  timeout already buys for free.
- **Not** a global `testTimeout` bump in `packages/nav/vitest.config.ts` — a blanket
  raise would also mask a genuinely *hung* nav test (real infinite loop / deadlock).
  The targeted per-test timeout keeps the 5 s default guarding every other nav test,
  and matches how procgen already handles its one heavy test.

This aligns with **CLAUDE.md rule 4**: CI gates deterministic proxies only; a
deterministic invariant (norm within 1e-9 + pitch clamp) must not be gate-able by runner
speed. The invariant is what matters; the 10k is coverage, not timing.

## 6. Verification of the fix

The timeout only *reproduces* under a slow/loaded runner, so per rule 6 the fix is
confirmed by reasoning about the failure mode, not by reproducing the CI clock:

- The measured work is deterministic and identical local↔CI; only the wall clock
  varied. Raising the per-test budget from 5000 ms to 30 000 ms moves the ceiling to
  ~180× the observed CI wall time (5357 ms) and ~200× the local wall time — no
  plausible runner variance crosses that while the work stays the same size.
- The assertion is unchanged, so correctness coverage is identical; only the timing
  guard moved.
- If the loop ever *did* blow past 30 s, that would be a real regression (e.g. an
  accidental O(n) in `update`), which is exactly what we still want to fail — the new
  ceiling is generous, not infinite.

`pnpm verify` green locally (lint + typecheck + unit + build).

## 7. What would have caught this earlier

- A lint/review check: **a large-count loop that dispatches DOM events per iteration
  must carry an explicit `testTimeout`** — the same rule procgen already follows for its
  1e6 test. This test predates that habit.
- More generally: deterministic-invariant tests should assert the invariant with the
  *minimum* iterations that exercise it and treat extra iterations as explicitly-budgeted
  coverage, never as an implicit bet against the default 5 s clock.
