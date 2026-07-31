# Root cause — m4a draw-call budget flake (transient overshoot, machine-dependent sampling)

**Date:** 2026-07-31
**Spec:** `e2e/tests/m4a.spec.ts` — "M4a tier unification … budgets hold"
**Status:** fixed (invariant moved to a deterministic unit test; e2e keeps a runaway-only guard)

## Symptom (as a measurement)

On the `e2e` gate, the m4a "budgets hold" test asserted `maxDrawCalls ≤ 300` and failed:

- **CI (#38, PR e2e):** the test **timed out** at 60 s in `waitForFunction(__m3Result)`
  (the descent didn't finish on the 2-vCPU software-GL runner).
- **Local (discrete GPU):** the descent finishes, but `maxDrawCalls = 301` **every run**
  (3/3) — `[m4a] coverageMax=1.000 … draws=301 inFlight=6`.
- **CI (#33–#37):** the same test **passed** (`draws ≤ 300`).

Two manifestations, one budget boundary. `maxDrawCalls` is read from
`__cosmos.streaming.drawCalls` (the streaming policy's own `visible.length`), not
`gl.info.render.calls` — so it measures streaming chunk count, nothing else.

## Taxonomy — test measures a machine-dependent quantity (rule-5 violation)

The app code is identical between the passing PR head and the failing merge (a docs-only
PR), and between CI-pass and local-fail. Same code, different result ⇒ nondeterminism in
the **measurement**, not a product regression.

A **false lead, retracted:** an initial `git bisect` suggested TASK-086 (local-group
galaxies) flipped the count 4 → 301. That was **contaminated** — only `@cosmos/web` was
rebuilt between checkouts, not the workspace packages (`@cosmos/streaming` etc.), so the
old checkout linked new package `dist/`. Confirmed non-causal two ways: `M4aApp` never
mounts `LocalGroupScene`, and ablating the layer (`setLocalGroupVisible(false)`) left the
count at 301. The "4" was a broken-build artifact, not a real prior value.

## Mechanism

`enforceBudgets` (`packages/streaming/src/policy.ts`) keeps the visible cut within the
draw-call budget by collapsing deep covered nodes into their coarser parents "until within
budget". But the collapse is **best-effort**:

```ts
const parent = chunks.get(pk);
if (!parent || parent.status !== 'ready') continue; // not collapsible — keep child
```

When a parent is still streaming in, the child cannot collapse, so the policy keeps it —
one chunk over budget — deliberately (a coarse hole would look worse than one extra
chunk). During the violent scripted descent a parent is mid-load on the peak frame, so
`streaming.drawCalls` transiently reads **301**, then converges back to ≤ 300 once the
parent is `ready`.

Why the flake is machine-dependent — the test takes the **max over a per-rAF sample**:

- **Fast GPU (dev):** many frames/s ⇒ many samples ⇒ almost always catches the brief 301
  transient ⇒ deterministically **fails**.
- **Slow software GL (CI):** few frames/s ⇒ few samples ⇒ usually "blinks" past the
  transient ⇒ reads **≤ 300** ⇒ passes. On #38 it didn't finish the descent at all ⇒
  timeout (the same "scene is heavy at the edge" cause, a different face).

The transient magnitude also depends on run-to-run load timing, so even one machine is not
deterministic. The quantity gated (peak of a frame-rate-dependent sample) is exactly the
"incidental machine-specific value" CLAUDE.md testing rule 5 forbids gating.

## Fix

Split the concern by determinism:

1. **The invariant → a deterministic unit test** (`packages/streaming/test/policy.test.ts`,
   "steady-state invariant"): build a cut that exceeds a tight `maxDrawCalls` budget, settle
   it until every parent is `ready`, and assert `stats.drawCalls ≤ budget` **exactly**. No
   WebGL, no frame timing — this pins the guarantee the budget actually makes (once parents
   are ready the collapse is unobstructed). A baseline assertion (`> budget` under the
   default budget) guards a trivial pass.

2. **The e2e → a runaway-only guard**: keep `maxRenderedPoints ≤ 2M` and `maxInFlight ≤ 6`
   (deterministic caps with slack), and relax the draw-call assertion to `≤ 600` — a bound
   that only trips on a genuinely broken degradation, tolerating the by-design transient.
   The exact cap is now owned by the unit test.

This is **not** relaxing the budget to force green: the streaming policy still targets 300,
and the 300 cap is now tested *more* strictly (deterministically, every run) than the flaky
peak-sample ever did. What changed is that the e2e stops gating a machine-dependent number.

## Alternative considered — hard-cap the policy (rejected)

Make `enforceBudgets` guarantee ≤ budget per frame by dropping the un-collapsible node when
its parent isn't ready. This would make the simple `≤ 300` e2e assertion deterministically
true, but it overrides a deliberate design choice (show one extra chunk rather than a
transient hole), worsens the visuals during loads for a 0.3 % work difference, and edits a
perf-critical path (BUG-10). Letting a test dictate a worse product behavior is backwards.

## What would have caught this earlier

Gating the **peak of a per-frame sample** is inherently frame-rate-coupled; any such gate
sitting at its boundary will split fast vs. slow machines. The rule: gate a best-effort,
convergent quantity at its **settled invariant** (deterministic), and only bound its
transient loosely (runaway guard). Same family as `measure-the-frame-not-the-layer` and the
query-hook e2e lessons.
