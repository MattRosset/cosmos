# @cosmos/diagnostics

The **one place** an error is reported and the **one place** a `should-never-happen`
invariant is checked. Kills the "every call site reinvents error handling" problem
(`docs/research/error-handling-audit.md` §3.5) and gives the app the transport seam it
never had (§4.1).

Framework-agnostic and dependency-light: imports only `@cosmos/core-types`. **No React,
no Three.js, no Sentry, no fetch.** The Sentry transport lives in `apps/web` (TASK-056);
diagnostics only defines the transport *interface* and lets the app install one.

## API

```ts
import {
  reportError,
  assertInvariant,
  setTransports,
  getErrorCounts,
  installDevOverlay,
  devOverlayTransport,
  type ErrorTransport,
} from '@cosmos/diagnostics';
```

- **`reportError(err, kind, context?)`** — THE central sink. Normalizes `err` to an
  `AppError` (via `toAppError`, TASK-054), then fans out to: (1) `console.error` always,
  (2) the dev overlay if installed, (3) every installed transport. Never throws. Returns
  the produced `AppError`.
  - **Dedupe:** identical `kind|name|message` reports inside a 1 s window are silenced in
    the console/overlay/transports but **still counted** — the storm (audit §3.1 BUG-6:
    ~6 identical failures/frame) is hidden from the UI, never from the metric.

- **`assertInvariant(condition, message, context?)`** — if `condition` is false it
  `reportError(…, 'invariant')` and then, in **DEV**, throws (loud); in **PROD** it
  returns (degrade, don't crash). The `asserts condition` signature is sound only in DEV
  — prod callers must still handle the degraded path explicitly (do not lean on TS
  narrowing to skip a null-check that must survive production).

- **`setTransports(transports)`** — replace the active transports (`[]` = console-only).
  Returns an unsubscribe restoring the previous set. A transport that throws is caught +
  `console.warn`'d, never propagated.

- **`getErrorCounts()`** — `{ total, ...perKind }`, monotonic since page start. Read by
  the error gate (TASK-059) via the app's `__cosmos` global.

- **`installDevOverlay(target?)`** — mounts a vanilla-DOM, fixed bottom-right overlay
  listing recent errors. Idempotent (exactly one element); returns a teardown. No-op when
  `document` is undefined (SSR/Node). Works even when the React tree has crashed — which
  is exactly when you need it. `devOverlayTransport` is the ready-made transport it uses.

## Test-only

- `__resetDiagnostics()` — zero counts + dedupe + transports.
- `__setDevForTests(value)` — force the DEV/PROD branch (`undefined` restores detection).
