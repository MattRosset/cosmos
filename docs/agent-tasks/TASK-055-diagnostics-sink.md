# Task: `diagnostics` v1 — central error sink + dev overlay + assert helper

**ID:** TASK-055
**Target package:** `packages/diagnostics` (new)
**Size:** M
**Phase:** H — Hardening track; new package (the sink everything funnels into)
**Depends on:** TASK-054

## Goal

Stand up `@cosmos/diagnostics`: the **one place** an error is reported (`reportError`), the
**one place** a `should-never-happen` invariant is checked (`assertInvariant`), and a
**pluggable transport** so the app decides where reports go (dev overlay + console; prod
Sentry — wired in TASK-056). This kills the "every call site reinvents handling" problem
(audit §3.5) and gives us the seam we never had (audit §4.1).

The package core is **dependency-light and framework-agnostic** (no React, no Three, no
Sentry). It ships a self-contained **vanilla-DOM dev overlay** so a failure is impossible to
miss in development — the *opposite* of today's silent swallow — and a default console
transport. The Sentry transport is NOT here (it lives in `apps/web`, TASK-056); diagnostics
only defines the transport *interface* and lets the app install one.

When done: any package can `import { reportError, assertInvariant } from '@cosmos/diagnostics'`
and a thrown/asserted error becomes a structured `AppError` (TASK-054) that is logged, shown
loudly in dev, and forwarded to whatever transport the app installed.

## Frozen Interface

```ts
// public API of @cosmos/diagnostics
import type { AppError, AppErrorKind } from '@cosmos/core-types';

/** A sink destination. The app installs one (or more) at boot. Receives every
 *  normalized AppError. MUST NOT throw (a throwing transport is swallowed + warned). */
export type ErrorTransport = (e: AppError) => void;

/** Replace the active transports. Passing [] resets to console-only.
 *  Returns an unsubscribe that restores the previous set. */
export function setTransports(transports: readonly ErrorTransport[]): () => void;

/** THE central sink. Normalizes `err` to an AppError (via toAppError) and fans it
 *  out to: (1) console.error always, (2) the dev overlay if installed, (3) every
 *  installed transport. Never throws. Deduplicates identical (kind+name+message)
 *  reports within `dedupeWindowMs` (default 1000) to avoid storms (audit §3.1 BUG-6:
 *  ~6 identical failures/frame). Returns the AppError it produced. */
export function reportError(
  err: unknown,
  kind: AppErrorKind,
  context?: AppError['context'],
): AppError;

/** Invariant check. If `condition` is false:
 *   - DEV (import.meta.env.DEV or NODE_ENV !== 'production'): reportError(kind:'invariant')
 *     AND throw (loud — surfaces in the ErrorBoundary / test).
 *   - PROD: reportError(kind:'invariant') and RETURN (degrade, don't crash the app).
 *  `message` describes the expected post-condition ("octree tiles should have loaded"). */
export function assertInvariant(
  condition: boolean,
  message: string,
  context?: AppError['context'],
): asserts condition; // (asserts only sound in DEV; prod returns — see Common Mistakes)

/** Monotonic count of reports since process/page start, by kind and total.
 *  Read by the gate (TASK-059) via the app's `__cosmos` global. */
export function getErrorCounts(): { readonly total: number } & Readonly<Record<AppErrorKind, number>>;

/** Test/probe hook: reset counts + dedupe state. Not for production code. */
export function __resetDiagnostics(): void;

// ── Dev overlay (vanilla DOM; no framework) ──────────────────────────────────
/** Mounts a fixed-position overlay that lists recent AppErrors. Idempotent.
 *  Returns a teardown fn. The app calls this only in DEV (TASK-056). */
export function installDevOverlay(target?: HTMLElement): () => void;

/** A ready-made transport that writes to the dev overlay (used internally by
 *  installDevOverlay; exported so tests can assert routing). */
export const devOverlayTransport: ErrorTransport;
```

## Inputs / Outputs

- **Inputs:** thrown values of every shape (Error, string, object), a flapping invariant,
  repeated identical reports (dedupe test), a transport that throws.
- **Outputs:** `reportError` returns the `AppError`; console.error called once per unique
  report within the window; installed transports each receive the AppError; `getErrorCounts`
  increments `total` and the per-kind bucket; a throwing transport is caught + warned, never
  propagated.

## Construction notes (fixed — transcribe, don't redesign)

- `reportError` calls `toAppError(err, kind, context)` (TASK-054) — it does NOT re-implement
  the `instanceof Error` idiom.
- **Dedupe:** keep a small `Map<string, number>` of `${kind}|${name}|${message}` → lastMs;
  within `dedupeWindowMs` skip console + transports but STILL increment counts (so the gate
  sees the true failure rate; the storm is silenced in the UI, not hidden from the metric).
- **DEV detection:** prefer `import.meta.env?.DEV`; fall back to
  `process.env.NODE_ENV !== 'production'` (works in Vitest/Node and Vite). Compute once.
- **Dev overlay:** a single `<div>` with a header (count) and a scrollable list of the last
  ~20 reports (kind · name · message · context). Fixed bottom-right, high z-index, pointer
  events on a "clear" button only. No external CSS — inline styles. Must not throw if
  `document` is undefined (SSR/Node) — `installDevOverlay` is a no-op there.
- **No allocation discipline needed** — diagnostics is never on the frame-loop hot path; the
  streamer (TASK-057) is responsible for not calling `reportError` 60×/s (it dedupes +
  backs off on its side too).

## Constraints & Forbidden Actions

- Allowed dependencies: `@cosmos/core-types` only. **No React, no Three.js, no Sentry, no
  fetch.** (Boundary lint: `diagnostics` is a leaf utility; nothing app-specific.)
- `reportError`/`assertInvariant`/transports MUST NOT throw out of the sink (except
  `assertInvariant`'s intentional DEV throw). A transport error is caught + `console.warn`.
- Do not read `localStorage`, do not make network calls (the beacon/Sentry is a transport
  injected by the app).
- Do not import from `apps/web` or any `render-*`/`ui` package (leaf direction only).

## Common Mistakes

- **`asserts condition` + prod-return is unsound to the type system.** In prod
  `assertInvariant` returns even when false, so TS's narrowing would be a lie. Mitigate:
  keep the `asserts` signature (it is correct in DEV where we throw, and callers should
  treat a tripped invariant as fatal), but document that prod callers must still handle the
  degraded path explicitly — do NOT rely on the narrowing to skip a null-check after the
  assert in code that must survive prod. (If this feels wrong, split into
  `assertInvariant` (throws always) vs `checkInvariant` (reports + returns boolean) — but
  ship the single signature above for v1 and note the caveat.)
- Letting the dedupe map grow unbounded — cap it (LRU or periodic clear) so a long session
  with many distinct errors doesn't leak.
- Console-spamming the dedupe'd storm (the whole point is BUG-6 must not print 6×/frame).
- Making the overlay depend on React/the app's render tree — it is vanilla DOM so it works
  even when the React tree has crashed (that is exactly when you need it).
- Forgetting `installDevOverlay` must be a no-op when `document` is undefined (Vitest/Node).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/diagnostics test` (Vitest, jsdom):
   - `reportError(new TypeError('x'),'loader',{a:1})` returns an `AppError{kind:'loader',
     name:'TypeError',context:{a:1}}`, calls `console.error` once (spy), and increments
     `getErrorCounts().total` and `.loader`.
   - Installed transport (via `setTransports`) receives the AppError; after the returned
     unsubscribe, it no longer does.
   - **Dedupe:** 6 identical `reportError` calls within the window → console.error called
     once, transport called once, BUT `getErrorCounts().total === 6`.
   - A transport that throws does not propagate out of `reportError`; a `console.warn` fires.
   - `assertInvariant(false,'msg')` in the DEV path **throws** and increments
     `.invariant`; `assertInvariant(true,'msg')` does nothing. (Force the prod path via the
     env shim and assert it returns without throwing but still counts.)
   - `installDevOverlay()` mounts exactly one overlay element; a subsequent `reportError`
     appends a row; teardown removes it; calling it with `document` stubbed undefined is a
     no-op (no throw).
   - `__resetDiagnostics()` zeroes counts + dedupe.
2. **Coverage gate:** statement coverage ≥ 90% on `src` (utility package precedent, cf.
   `render-fx`/`procgen`).
3. `pnpm verify` exits 0 (boundary lint: no React/Three/Sentry import anywhere in the pkg).

## Deliverables

- `packages/diagnostics/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/diagnostics/src/sink.ts` (`reportError`, `setTransports`, counts, dedupe)
- `packages/diagnostics/src/assert.ts` (`assertInvariant`)
- `packages/diagnostics/src/dev-overlay.ts` (`installDevOverlay`, `devOverlayTransport`)
- `packages/diagnostics/src/env.ts` (DEV detection shim, injectable for tests)
- `packages/diagnostics/src/index.ts`
- `packages/diagnostics/test/sink.test.ts`, `test/assert.test.ts`, `test/dev-overlay.test.ts`
- `packages/diagnostics/README.md` (< 150 lines)
- Add `@cosmos/diagnostics` to the workspace + the `eslint.config.js` boundary rules as a
  leaf package (importable by anyone, imports only `core-types`).

## Context Files

- `docs/research/error-handling-audit.md` §3.5, §4.1, §4.5
- `packages/core-types/src/errors.ts` (TASK-054 — `AppError`, `toAppError`)
- `packages/workers/src/serve.ts` (serializable-error precedent)
- `eslint.config.js` + an existing leaf package's `package.json`/`tsconfig.json` to copy the
  scaffold (e.g. `packages/sim-time` — pure, no Three/React)
- `docs/architecture.md` §4 (dependency boundaries), §15 (naming, no `any`)
