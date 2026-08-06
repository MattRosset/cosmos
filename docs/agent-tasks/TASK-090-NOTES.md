# TASK-090 — implementation notes (judgment calls)

Log of decisions the spec did not fully pin down. Triage after merge into: spec/task
bug · executor bug · doctrine gap.

## Step 0 re-verification (all facts held — no reconciliation needed)

1. `reportError` — sink.ts:68-98: counts always increment, dedupe by `kind|name|message`
   within 1000 ms, fans to console + overlay + transports, never throws. ✓
2. `AppErrorKind` includes `'invariant'`; `ALL_KINDS` frozen list (sink.ts:11-19). Reused
   `'invariant'`, added no kind. ✓
3. `getErrorCounts()` is the gate proxy. ✓
4. `assertInvariant` throws in DEV (assert.ts:23) — NOT used; call `reportError` directly. ✓
5. NavDriver computes `distToField`/`distFromSolPc` each frame; feed wrapped in opt-in
   `profileSpan('nav.surfaceFeed')` (no-op unless `?debug=breadcrumb-profile|flythrough4`,
   frame-profiler.ts:11-16,81-89) — so an explicit `performance.now()` bracket is needed. ✓
6. No allocations in frame-loop callbacks (§5.8). Scratch + copy-on-breach. ✓
7. `installDevOverlay` exists (index.ts:9). ✓

## Judgment calls

- **JC-1 — Where the scratch fields are set.** The spec says "mutate the distance fields
  INSIDE each branch before its return." The galaxy branch has TWO return paths
  (short-circuit + nearestStarIndex), both AFTER `distToField`/`distFromSolPc` are already
  computed. Rather than duplicate the two writes into both sub-paths, I set them ONCE right
  after those two `const`s (before the `if` that splits the sub-paths) — one linear point
  that dominates both galaxy returns. `context` is set once at the top of the feed body
  (constant for the frame). system/universe set both distances to `-1` at their branch
  entry, dominating each branch's own return(s). Net effect is identical to per-return
  writes, with no duplication and no allocation. Interpretation of intent, not a deviation.

- **JC-2 — Wiring test via the extracted helper (spec's stated fallback), not NavDriver
  in isolation.** `useFrameContext` → `useFrame` needs the R3F Canvas/frame loop, which
  vitest cannot drive here (no WebGL — the repo's documented e2e/vitest split). So per
  Acceptance #3's explicit fallback, I extracted the wiring seam into
  `apps/web/src/glue/nav-budget.ts` (`sampleNavBudget(monitor, ctx, spanMs)` +
  `NavBudgetCtx`) and unit-tested THAT against the REAL sink (`createBudgetMonitor` at the
  prod config 4 ms / 30 frames, no injected report), asserting `getErrorCounts().invariant`
  increments by exactly 1 and the reported `context` carries `span:'nav.surfaceFeed'` +
  numeric `distFromSolPc`. This tests the actual production code path (NavDriver calls the
  same helper), not a re-implementation (testing-conventions rule 1).
  - Consequence: the injected `now` prop was still added to `NavDriver` (per spec — a test
    that CAN drive the frame loop, e.g. a future e2e/park gate, uses it), but the deterministic
    vitest proof rides the helper. `NavBudgetCtx` moved to the helper file (single source);
    NavDriver imports it.

- **JC-4 — `NavBudgetCtx` is a `type` alias, not an `interface` (SPEC BUG).** The spec's
  Wiring section says to declare `interface NavBudgetCtx {…}` AND that it "structurally
  satisfies the readonly `AppError['context']` parameter … with no cast." Those two are in
  tension: a TS `interface` has NO implicit index signature (it can be augmented via
  declaration merging), so it is NOT assignable to `Readonly<Record<string, …>>` —
  `pnpm verify` failed with `TS2345: Index signature for type 'string' is missing`. A `type`
  alias to the identical object literal DOES get the implicit index signature and is
  assignable with no cast. Per global rule 1 I did not improvise a cast (`as any` would be a
  rule-5 red flag); I changed `interface` → `type`, which achieves the spec's stated no-cast
  goal. **Triage: spec/task bug** (the spec named the one declaration form that cannot meet
  its own no-cast requirement).

- **JC-3 — Reset wired as a SECOND `onContextSwitch` subscription.** The existing
  `useEffect(() => flight.onContextSwitch(onContextSwitch), …)` forwards switches to the app;
  I added a separate `useEffect(() => flight.onContextSwitch(() => navBudget.reset()), …)`
  rather than wrapping the app's handler, to keep the reset independent of the forwarded
  handler's identity/lifecycle. `onContextSwitch` returns an unsubscribe (controller.ts:645),
  so the effect cleans up correctly.
