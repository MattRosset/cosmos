# Task: `core-types` thaw — error taxonomy + `ChunkLifecycleEvent.error` phase

**ID:** TASK-054
**Target package:** `packages/core-types`
**Size:** S
**Phase:** H — Hardening track (Error Handling & Observability); the ONE `core-types` thaw
**Depends on:** — (opens the hardening track; see README "Hardening track" note)

## Goal

This is the single sanctioned `core-types` thaw for the error-handling hardening track
(`docs/research/error-handling-audit.md`). It adds two **additive** type surfaces and
nothing else, so the downstream tasks (streaming v1.2, diagnostics, app boundary) have a
shared vocabulary:

1. A small **`AppError` taxonomy** — a structured, serializable error description every
   subsystem reports through the central sink (TASK-055). It is data, not an `Error`
   subclass, so it crosses the worker boundary and the network beacon unchanged.
2. An **`error` phase** added to `ChunkLifecyclePhase` plus an optional `error` field on
   `ChunkLifecycleEvent`, so the streamer can finally surface a failed tile instead of
   swallowing it (audit §3.1; this is the structural root of BUG-6).

When this task is done, `core-types` exports `AppError`, `AppErrorKind`, and `toAppError`,
and `ChunkLifecycleEvent` can describe a failure. No behaviour changes anywhere yet — only
types + one pure helper. `core-types` re-freezes immediately after this task.

## Frozen Interface

Exact signatures to ADD (do not modify or remove anything else in these files):

```ts
// packages/core-types/src/errors.ts  (NEW module, re-exported from index.ts)

/** Coarse origin of an error — drives grouping + which UI surface reacts. */
export type AppErrorKind =
  | 'loader'       // pack / manifest / tile fetch + decode (data package)
  | 'streaming'    // chunk load/decode failure surfaced by the streamer
  | 'worker'       // a worker handler threw (WorkerErrorPayload origin)
  | 'render'       // a render-tree / Three.js / R3F failure (ErrorBoundary)
  | 'persistence'  // localStorage / migration failure (app-state)
  | 'invariant'    // a `should-never-happen` assertion tripped
  | 'unknown';     // anything uncategorized (global handlers)

/** Structured, JSON-serializable error description. NOT an Error subclass:
 *  it must survive `postMessage` (worker boundary) and `JSON.stringify` (beacon). */
export interface AppError {
  readonly kind: AppErrorKind;
  /** Human-readable, already-extracted message (never the raw Error object). */
  readonly message: string;
  /** Stable-ish error name, e.g. 'TypeError', 'PackFormatError'. */
  readonly name: string;
  /** Stack if available (best-effort; absent in some worker/transfer paths). */
  readonly stack?: string;
  /** Free-form breadcrumb context: where/what — e.g. { chunkId, url, tier }.
   *  Values must be JSON-serializable primitives. */
  readonly context?: Readonly<Record<string, string | number | boolean | null>>;
  /** Epoch ms when normalized (Date.now()), for ordering in the sink. */
  readonly atMs: number;
}

/** Normalize any thrown value into an AppError. The ONE place the
 *  `err instanceof Error ? err.message : String(err)` idiom lives (audit §3.5).
 *  Pure + deterministic given `atMs` (injectable for tests; defaults to Date.now). */
export function toAppError(
  err: unknown,
  kind: AppErrorKind,
  context?: AppError['context'],
  atMs?: number,
): AppError;
```

```ts
// packages/core-types/src/streaming.ts  (MODIFY — additive only)

// CHANGE this union (append 'error'):
export type ChunkLifecyclePhase = 'request' | 'ready' | 'evict' | 'error';

// ADD one field to the existing interface (do not touch the others):
export interface ChunkLifecycleEvent {
  readonly phase: ChunkLifecyclePhase;
  readonly kind: ChunkKind;
  readonly chunkId: string;
  readonly lod: number;
  readonly batch: StarBatch | null;
  /** Present only on `phase: 'error'`; null otherwise. The reason the chunk
   *  failed to load/decode. A cancelled/aborted chunk is NOT an error and never
   *  emits this phase (see TASK-057). */
  readonly error: AppError | null;
}
```

## Inputs / Outputs

- **Inputs (for `toAppError` tests):** a real `Error` (`new PackFormatError('x')`-like with
  a `.name`/`.stack`), a thrown string `'boom'`, a thrown plain object `{ foo: 1 }`,
  `undefined`.
- **Outputs:** for the `Error` → `{kind, name:'PackFormatError', message:'x', stack:<str>,
  atMs}`; for the string → `{name:'Error', message:'boom', stack:undefined, atMs}`; for the
  object → `{name:'Error', message:'[object Object]' or JSON, ...}`; for `undefined` →
  `{name:'Error', message:'undefined' or 'Unknown error', ...}`. Pick one deterministic rule
  for the non-Error cases and assert it.

## Constraints & Forbidden Actions

- **Additive only.** Do not change the meaning of `request`/`ready`/`evict`, do not remove
  or rename any existing field, do not touch any other `core-types` module.
- `core-types` imports NOTHING (architecture §4) — `errors.ts` is pure TS, no deps.
- `AppError` must stay **JSON-serializable**: no functions, no `Error` instances, no
  `undefined`-only-via-omission ambiguity beyond the documented optional fields. It must
  survive `structuredClone`/`postMessage`.
- `toAppError` allocates a new object; it is NOT called on the frame-loop hot path, so
  allocation is fine here (the streamer decides when to call it — TASK-057).
- Re-export the new module from `src/index.ts` alongside the others; do not change unrelated
  exports.

## Common Mistakes (architecture §15, §5.13)

- Making `AppError` extend `Error` — it then will NOT survive `postMessage`/`JSON.stringify`
  (the §5.13 worker boundary already learned this: `WorkerErrorPayload` is a plain object).
- Putting non-serializable values in `context` (DOM nodes, Errors, functions). Lint/types
  forbid via the `string | number | boolean | null` value type — keep it.
- Reusing/mutating a shared `AppError` object — each `toAppError` call returns a fresh one.
- Treating an aborted/cancelled chunk as an `error` (that distinction is enforced in
  TASK-057, but the type doc must already say "cancel is not error").

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/core-types test` (Vitest):
   - `toAppError(new TypeError('x'), 'loader')` → `kind:'loader'`, `name:'TypeError'`,
     `message:'x'`, `stack` is a string, `atMs` is the injected value.
   - `toAppError('boom', 'unknown')` and `toAppError({foo:1},'unknown')` and
     `toAppError(undefined,'unknown')` each produce the documented deterministic shape with
     `name:'Error'` and no thrown exception.
   - The result of `toAppError` round-trips through `JSON.parse(JSON.stringify(x))`
     unchanged (serializability guarantee) and through `structuredClone`.
   - A `ChunkLifecycleEvent` literal with `phase:'error', error:<AppError>, batch:null`
     type-checks; one with `phase:'ready'` still type-checks with `error:null`.
2. `pnpm verify` exits 0 (typecheck across all 22 packages — additive change must not break
   any existing `ChunkLifecycleEvent` consumer; streaming still compiles because `error` is
   added as a required field — **NOTE:** making `error` required means every existing event
   construction must add `error: null`; if that ripples beyond `core-types`, keep `error`
   required and fix the `eventScratch`/emit in streaming as part of TASK-057, OR land this
   task with `error?: AppError | null` optional to avoid the ripple — **pick optional** so
   this thaw stays self-contained and TASK-057 tightens it. Document the choice in the
   README note.)

## Deliverables

- `packages/core-types/src/errors.ts` (new)
- `packages/core-types/src/streaming.ts` (modified: union + optional field)
- `packages/core-types/src/index.ts` (re-export `errors`)
- `packages/core-types/test/errors.test.ts` (new)
- Append a one-line entry to `packages/core-types/README.md` error-types section if present.

## Context Files

- `docs/research/error-handling-audit.md` §3.1, §3.5, §4 (why this exists)
- `packages/core-types/src/streaming.ts` (the event being extended)
- `packages/workers/src/serve.ts` (`WorkerErrorPayload` — the existing serializable-error
  precedent to mirror)
- `docs/architecture.md` §5.13 (structured error propagation), §15 (naming, no `any`)
