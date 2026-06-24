# Task: dev-assert adoption + invariant checks in the silent swallows

**ID:** TASK-058
**Target package:** `apps/web`, `packages/app-state`, `packages/scene-host` (small, surgical)
**Size:** S–M
**Phase:** H — Hardening track; closes the "silent by design / no invariant" gaps
**Depends on:** TASK-055 (`reportError`, `assertInvariant`), TASK-057 (streaming counters, for the `__cosmos` wiring)

## Goal

Adopt the diagnostics helpers at the specific silent-swallow and missing-invariant sites the
audit named (§3.6, §3.7), turning "degrade and say nothing" into "degrade in prod, **scream
in dev**", and turning the two classes of latent bug (BUG-6 coverage-stuck, BUG-8
source-dropped) into asserted post-conditions. Also expose the diagnostics + streaming error
counters on the app's `__cosmos` debug global so the gate (TASK-059) and manual debugging can
read them.

This task changes behavior **only in DEV** for the swallow sites (prod keeps degrading) and
adds **assertions that are no-ops on the happy path** — it must not change any passing
behavior.

## Scope — exact sites (do not invent new ones)

1. **`packages/app-state/src/persist-util.ts` `createSafeStorage`** (§3.6): the three
   `catch {}` swallows (setItem/getItem/removeItem). Keep prod behavior (return null / no-op),
   but on catch call `reportError(err,'persistence',{op,key})` so a developer learns their
   writes are silently failing. Must remain a no-op in Node/SSR (the sink + DEV detection
   already handle "no document"; persistence failures are still reported via console).
2. **`packages/scene-host/src/frame-loop.ts` non-finite epoch guard** (§3.6, `:62`): today it
   `console.warn` ONCE then goes quiet. Replace the one-shot warn with a single
   `reportError(new Error('EpochProvider returned non-finite value'),'invariant',{...})`
   (still once — keep the `hasWarnedNonFiniteEpoch` latch so it is not per-frame), so it is
   counted + visible, not just a console line that scrolls away.
3. **`apps/web/src/glue/octree-combined.ts`** (§3.7, BUG-8 class): after `combineOctreeSources`
   / the push-down load, `assertInvariant` that every input source contributed (no source
   silently dropped). The exact invariant: for a cut that should include a given source's
   points, the combined result is non-empty for that source when the source had points in
   range. (Use the already-existing test's notion of "source orphaned" — assert the
   post-condition that the push-down guarantees.) DEV throws (surfaces in the boundary/e2e);
   prod reports + continues.
4. **`apps/web` `__cosmos` debug global**: extend it with
   `errorCounts: getErrorCounts()` (live getter) and `streamingErrors: () => streaming?.stats.errorCount ?? 0`
   and `failedChunks`. This is the read surface the gate asserts on.

## Frozen Interface

No public package APIs change. `app-state`/`scene-host` gain an internal `reportError` call;
their exported signatures are untouched (so this is NOT a frozen-interface thaw — it is an
internal behavior addition). The `__cosmos` global shape is app-internal (already mutated by
debug modes).

```ts
// apps/web/src/glue/__cosmos.ts (or wherever the global is assembled) — ADD fields:
interface CosmosDebugGlobal {
  // ...existing...
  readonly errorCounts: { readonly total: number } & Record<string, number>; // getErrorCounts()
  readonly failedChunks: number;
}
```

## Constraints & Forbidden Actions

- **Prod behavior at the swallow sites is unchanged** — storage still degrades silently to
  the USER; the only addition is a report (which in prod goes to the transport/Sentry, in dev
  to the overlay). Do not make storage failures crash the app.
- `app-state` and `scene-host` may now import `@cosmos/diagnostics` (leaf util — boundary
  legal). Confirm the eslint boundary config allows it; if `scene-host` importing diagnostics
  is disallowed, inject `reportError` via the existing options instead (prefer injection to a
  new hard dep where a package already takes an options bag).
- The frame-loop change must stay **once-only** — no per-frame `reportError` (hot path).
- `assertInvariant` in `octree-combined` must be a **no-op on the happy path** (the common
  case where all sources contribute) — do not add measurable per-load cost; check a cheap
  post-condition, not a full re-scan, where possible.
- Do not touch frozen package public APIs; do not change streaming internals (TASK-057 owns
  those) — only read `streaming.stats`.

## Common Mistakes

- Turning a prod storage failure into a user-facing crash (it must still degrade silently for
  the user; "scream" means dev overlay + telemetry, not a broken app).
- Re-introducing per-frame work (the epoch report must keep its latch).
- An invariant that fires on a legitimate edge (e.g. a source genuinely has no points in the
  cut — that is NOT a dropped source). Scope the condition to "had points, contributed none".
- Importing diagnostics into a package whose boundary forbids it instead of injecting.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/app-state test`: a `setItem` that throws (stub localStorage to
   throw) still returns without throwing AND calls the injected `reportError` with
   `kind:'persistence'`. Existing persist tests unchanged.
2. `pnpm --filter @cosmos/scene-host test`: feeding a non-finite epoch reports exactly once
   (`reportError` spy called once across many frames), retains the previous epoch (existing
   assertion preserved).
3. `apps/web` test (extend `octree-combined.test.ts`): a constructed case where the OLD
   combine would drop a source now trips `assertInvariant` in the DEV path (throws / reports
   `kind:'invariant'`); the correct push-down case does NOT trip it.
4. `apps/web` test: `__cosmos.errorCounts.total` reflects diagnostics counts;
   `__cosmos.failedChunks` reflects `streaming.stats.failedChunks`.
5. `pnpm verify` exits 0 (boundary lint must accept the new diagnostics imports/injection).

## Deliverables

- `packages/app-state/src/persist-util.ts` (report on catch; injectable `reportError` if a
  hard dep is disallowed)
- `packages/scene-host/src/frame-loop.ts` (epoch report, latched) — adjust its options/wiring
  if injecting rather than importing
- `apps/web/src/glue/octree-combined.ts` (post-condition `assertInvariant`)
- `apps/web/src/glue/__cosmos.ts` (or equivalent) — error count read surface
- Test additions in the three packages + `apps/web`
- A line in each touched package's README noting the new dev-mode reporting

## Context Files

- `docs/research/error-handling-audit.md` §3.6, §3.7
- `docs/research/TASK-052-integration-bugs.md` BUG-8 (the dropped-source class to assert)
- `packages/app-state/src/persist-util.ts`, `packages/scene-host/src/frame-loop.ts`,
  `apps/web/src/glue/octree-combined.ts`, `apps/web/src/glue/octree-combined.test.ts`
- `packages/diagnostics/src/index.ts` (`reportError`, `assertInvariant`, `getErrorCounts`)
- `eslint.config.js` (confirm diagnostics is importable by `app-state`/`scene-host`)
