# Task: error gate — scripted flythrough asserts zero unexpected errors + coverage > 0

**ID:** TASK-059
**Target package:** `apps/web` (probe) + `e2e` (spec)
**Size:** M
**Phase:** H — Hardening track **gate** (closes the track); exclusive in `apps/web`/`e2e`
**Depends on:** TASK-054, TASK-055, TASK-056, TASK-057, TASK-058 (all)

## Goal

Turn "no silent errors" into a **deterministic CI gate** so the whole class of bug the audit
described can never regress unnoticed (audit §3.7; [[ci-test-infra-philosophy]] — gate on a
deterministic proxy, not a flaky visual). The gate runs a scripted descent through the same
shipped pipeline the other gates use and asserts:

1. `window.__cosmos.errorCounts.total === 0` for all kinds EXCEPT a small, explicit
   allow-list (e.g. an intentionally-injected probe error if any) — i.e. **no unexpected
   error was reported anywhere** during a full Milky Way → Sol → Earth run.
2. `window.__cosmos.failedChunks === 0` — no catalog tile ended in the backed-off `failed`
   state (the BUG-6 storm would have shown here).
3. `streaming.catalogCoverage() > 0` after the descent settles near Sol — the catalog tier
   actually loaded (the exact post-condition BUG-6 violated silently for two phases).

When done, a reintroduced silent-swallow / illegal-fetch / dropped-source regression makes
this spec RED in CI.

## Inputs / Outputs

- **Inputs:** a deterministic scripted camera path (reuse the existing flythrough/ctxswitch
  probe machinery — `Flythrough4Probe`/`CtxSwitchProbe` patterns) descending universe →
  galaxy → Sol → Earth, clock paused so orbits don't perturb timing.
- **Outputs:** at the end of the run, the three assertions above read off `__cosmos` /
  `streaming.stats` / `catalogCoverage()`. The probe exposes a `?debug=errorgate` mode (like
  the other gate probes) and writes a small result object to `window.__cosmos` (or
  `window.__errorGateResult`) the spec reads.

## Construction notes (fixed — transcribe, don't redesign)

- Mirror the existing gate-probe pattern: a dedicated `?debug=errorgate` app branch in
  `App.tsx` (next to `DEBUG_FLYTHROUGH4`/`DEBUG_CTXSWITCH`) that mounts the production star +
  system scenes with a scripted `NavDriver`, paused clock, and the SAME pack loads. Do not
  build a bespoke pipeline — the gate must measure the SHIPPED path (the §6 gate doctrine).
- The probe drives the camera through the full descent, waits for streaming to settle
  (existing "settled" heuristic: inFlight === 0 for K frames, or reuse the coverage-settle
  check from `coverage.test`/M4a), then snapshots the three values.
- **Allow-list discipline:** the default expectation is `total === 0`. If a step legitimately
  produces an error (it should not), it must be added to an explicit, commented allow-list in
  the spec with a reason — never a blanket `>= 0`. The whole point is a hard zero.
- Reuse `frame-profiler`/probe scaffolding already added for TASK-053 where convenient; this
  gate is about error/coverage counters, not frame timing, so it does not need the perf
  baseline machinery.
- Keep it deterministic: paused clock, fixed seed, fixed viewport, fixed path. No screenshot,
  no perf threshold (those live in the phase gates). This gate asserts COUNTERS only — robust
  across CI GL backends (SwiftShader-safe), per [[local-e2e-vs-ci]].

## Constraints & Forbidden Actions

- Exclusive lane in `apps/web`/`e2e` (it is a gate; nothing else runs there concurrently).
- Do not weaken the assertion to make CI green — if the gate is red, that is a real silent
  failure to fix (it found exactly what we built it to find). Per the README "if impossible
  as written, set blocked + report" — do NOT relax `=== 0` to `< N`.
- No new runtime deps. Probe is app glue; spec is Playwright (existing harness).
- Do not assert on wall-clock timing or pixels (env-fragile) — only the deterministic
  counters/coverage.

## Common Mistakes

- Asserting before streaming settles → coverage still 0 / errors not yet surfaced → flaky.
  Wait for the documented settle condition first.
- Building a parallel non-shipped pipeline (defeats the gate; mirror production like the
  other probes).
- Allow-listing errors loosely to pass — each allow-listed entry needs a written reason.
- Forgetting the gate must run on CI's software GL (SwiftShader) — keep it counter-based, not
  visual, so it is deterministic there.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `e2e/tests/error-gate.spec.ts` (Playwright, chromium at minimum; webkit/firefox if cheap):
   - Boot `?debug=errorgate`, run the descent, wait for settle.
   - Assert `__cosmos.errorCounts.total === 0` (minus the explicit, empty-by-default
     allow-list).
   - Assert `__cosmos.failedChunks === 0`.
   - Assert `catalogCoverage() > 0` (catalog tier loaded near Sol).
   - **Self-test the gate (red-on-regression proof):** include a guarded sub-case (env flag
     `?debug=errorgate&inject=1`) that deliberately triggers one streaming failure and asserts
     the gate WOULD go red (errorCount becomes 1 / coverage drops) — proving the gate detects
     the BUG-6 class rather than always passing. (A unit-level assertion of the read surface
     is acceptable if a full e2e self-test is too heavy.)
2. `pnpm verify` exits 0 (the probe component type-checks + lints; no boundary violation).
3. The gate is added to the CI workflow's gate listing alongside the other phase gates
   (`.github/workflows/ci.yml`).

## Deliverables

- `apps/web/src/scene/ErrorGateProbe.tsx` (or reuse a shared probe harness) + `?debug=errorgate`
  branch in `apps/web/src/App.tsx`
- `e2e/tests/error-gate.spec.ts`
- `.github/workflows/ci.yml` (register the gate)
- A short note in `docs/research/error-handling-audit.md` (or a closure note in the README
  row) recording the gate's settled-coverage value + that the track is closed.

## Context Files

- `docs/research/error-handling-audit.md` §3.7, §4.6
- `apps/web/src/scene/Flythrough4Probe.tsx` + `apps/web/src/App.tsx` (existing `?debug=` gate
  probe pattern to mirror)
- `e2e/tests/m4a.spec.ts`, `e2e/tests/flythrough4.spec.ts` (probe-driving + settle patterns)
- `packages/streaming/src/policy.ts` (`stats.errorCount`, `failedChunks`, `catalogCoverage`)
- `docs/architecture.md` §6 (gate doctrine: measure the shipped pipeline), §13 (testing)
- Memory: [[ci-test-infra-philosophy]], [[local-e2e-vs-ci]]
