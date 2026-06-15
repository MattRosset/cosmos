# Task: `workers` v1 — worker pool, Comlink contracts, cancellation, transfer discipline

**ID:** TASK-032
**Target package:** `packages/workers` (new)
**Size:** M
**Phase:** 3 — lane (worker infrastructure; prerequisite for procgen-in-worker and octree decode-in-worker)
**Depends on:** TASK-031

## Goal

The worker infrastructure of architecture §5.13: a pooled set of Web Workers
(`size = min(navigator.hardwareConcurrency − 1, 4)`), Comlink-wrapped typed request
contracts, cooperative cancellation tokens, transferable-`ArrayBuffer` discipline
(assert `byteLength === 0` post-transfer in dev), and structured error propagation.
The package owns the pool + the typed client; the actual generation/decode bodies
are injected by the callers (`procgen` worker entry in TASK-033, octree decode in
TASK-035) so this package **never imports Three.js, `procgen`, or `data`** (it would
create a cycle and §5.13 bans Three.js in workers). It produces and moves raw
buffers only.

## Frozen Interface

```ts
// public API of @cosmos/workers
import type {
  WorkerRequest, WorkerResponse, WorkerErrorPayload,
  ProcgenGalaxyRequest, OctreeDecodeRequest, StarBatch,
} from '@cosmos/core-types';

/** §5.13: min(hardwareConcurrency − 1, 4), floored at 1. */
export function defaultPoolSize(): number;

/** A cancellation handle. `cancel()` is idempotent; `signal` is an AbortSignal
 *  the caller may also pass to fetch (§5.8 cancel stale requests). */
export interface CancelToken {
  readonly id: number;
  readonly signal: AbortSignal;
  cancel(): void;
  readonly cancelled: boolean;
}
export function createCancelToken(): CancelToken;

/** The methods this pool can dispatch. Result is always a StarBatch in Phase 3
 *  (both procgen galaxies and decoded octree tiles produce StarBatches). */
export type WorkerMethod = 'procgen.galaxy' | 'octree.decode';
export interface WorkerMethodParams {
  readonly 'procgen.galaxy': ProcgenGalaxyRequest;
  readonly 'octree.decode': OctreeDecodeRequest;
}

export interface DispatchOptions {
  /** Buffers to TRANSFER (not clone) with the request (e.g. the tile .bin). */
  readonly transfer?: readonly ArrayBuffer[];
  /** Cancellation; if omitted a token is created internally. */
  readonly token?: CancelToken;
}

export interface WorkerPool {
  readonly size: number;
  /** Dispatch to the least-busy worker. Resolves with a StarBatch whose typed
   *  arrays back onto the TRANSFERRED result buffer (zero-copy into the main
   *  thread). Rejects with a `WorkerTaskError` on worker error; rejects with a
   *  `WorkerCancelledError` if the token was cancelled before completion. */
  dispatch(
    method: WorkerMethod,
    params: WorkerMethodParams[WorkerMethod],
    opts?: DispatchOptions,
  ): Promise<StarBatch>;
  /** In-flight task count (for streaming's in-flight cap, §5.8). */
  readonly inFlight: number;
  /** Terminates all workers; pending dispatches reject with WorkerCancelledError. */
  dispose(): void;
}

/** Inject the worker factory so the package is testable without a real Worker
 *  (Node test passes a stub that runs handlers synchronously on a MessageChannel). */
export interface WorkerPoolOptions {
  readonly size?: number;
  /** Vite syntax in the app: () => new Worker(new URL('./entry.ts', import.meta.url),
   *  { type: 'module' }). */
  readonly spawn: () => Worker;
}
export function createWorkerPool(opts: WorkerPoolOptions): WorkerPool;

export class WorkerTaskError extends Error {
  readonly payload: WorkerErrorPayload;
}
export class WorkerCancelledError extends Error {}

// ── Worker-side helper (imported by procgen/data worker ENTRY files) ──────────
/** Maps a WorkerMethod to its handler. Handlers receive params + a CHEAP
 *  `isCancelled()` they MUST poll in long loops (§5.13 free worker within 50 ms).
 *  Return value: { batch, transfer } — `transfer` lists buffers to move back. */
export interface WorkerHandlers {
  readonly 'procgen.galaxy': (
    params: ProcgenGalaxyRequest,
    isCancelled: () => boolean,
  ) => { readonly batch: StarBatch; readonly transfer: readonly ArrayBuffer[] };
  readonly 'octree.decode': (
    params: OctreeDecodeRequest,
    isCancelled: () => boolean,
  ) => { readonly batch: StarBatch; readonly transfer: readonly ArrayBuffer[] };
}

/** Call ONCE at the top of a worker entry module: wires Comlink/onmessage,
 *  request correlation, cancellation, and structured error → WorkerResponse. */
export function serveWorker(handlers: Partial<WorkerHandlers>): void;
```

## Fixed semantics (transcribe, don't redesign)

- **Pool sizing:** `defaultPoolSize()` = `Math.max(1, Math.min((navigator
  .hardwareConcurrency ?? 4) − 1, 4))`. `createWorkerPool` spawns `size` workers via
  `opts.spawn()` eagerly (§5.13 "pool them" — never spawn per task).
- **Dispatch routing:** least-busy (fewest in-flight) worker; ties → lowest index.
- **Transfer discipline (§5.13):** every buffer in `opts.transfer` is passed in the
  `postMessage` transfer list; in DEV (`import.meta.env?.DEV` or
  `process.env.NODE_ENV !== 'production'`) assert each transferred buffer's
  `byteLength === 0` *after* posting (it would be 0 only if actually transferred) —
  throw if not. Result buffers travel back the same way (worker lists them in its
  `transfer`).
- **Cancellation:** `token.cancel()` posts a cancel message tagged with the request
  `id`; the worker sets its `isCancelled()` true; the in-flight `dispatch` promise
  rejects with `WorkerCancelledError`. A token cancelled BEFORE dispatch makes
  `dispatch` reject immediately without posting. The pooled worker must be free for
  reuse within 50 ms of cancellation (§5.13 gate).
- **Error propagation:** a handler throw becomes
  `WorkerResponse { ok:false, error: { name, message, stack } }` → client rejects
  with `WorkerTaskError` carrying that payload. Raw `Error` objects never cross the
  boundary (§5.13 "structured error propagation").
- **No Three.js, no `procgen`, no `data`** imported here — handlers are injected at
  the worker entry by those packages.

## Inputs / Outputs

- **Inputs:** `createWorkerPool({ spawn })`; `dispatch('octree.decode', { tile,
  idPrefix, bin }, { transfer: [bin] })`.
- **Outputs:** `Promise<StarBatch>`; on success the StarBatch's `positionsPc`/etc.
  are views over the transferred-back result `ArrayBuffer` (no copy into JS heap).

## Constraints & Forbidden Actions

- Do not modify `core-types`. The package consumes the RPC types from TASK-031.
- Allowed dependencies: `comlink`. (`comlink` is the §2.1/§5.13 sanctioned RPC lib;
  list it exactly under workspace deps.) Nothing else — no Three.js, no
  `@cosmos/procgen`, no `@cosmos/data`.
- The frame loop never calls `dispatch` directly on a hot path; callers (streaming)
  schedule via `requestIdleCallback` for non-urgent uploads (§9) — not this
  package's concern but do not block the main thread inside `dispatch`.
- No `Math.random()`; no allocations in the worker message hot path beyond the
  unavoidable response object.
- Vite worker bundling syntax is the APP's responsibility via `opts.spawn`; this
  package must not hardcode a `new Worker(new URL(...))` (it has no entry to point
  at — entries live in `procgen`/`data` worker tasks).

## Common Mistakes (architecture §5.13 — copy kept verbatim)

- Cloning instead of transferring buffers (assert `byteLength === 0` post-transfer
  in dev).
- Spawning workers per task (pool them).
- Importing Three.js into workers (banned — workers produce raw buffers).
- Forgetting Vite worker bundling syntax (`new Worker(new URL('./x.ts',
  import.meta.url), { type: 'module' })`).
- Plus: leaking cancelled tasks (a cancelled task must free its worker within 50 ms,
  not run to completion); letting a handler throw escape as an unstructured error.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/workers test` — `test/pool.test.ts` (Node, a stub
   `spawn` that returns a fake `Worker` backed by a `MessageChannel`, handlers
   running on the "worker" side):
   - **No-op round-trip < 2 ms** (§5.13): a trivial handler resolves; measure
     dispatch→resolve under a generous CI multiple of 2 ms (assert the logic; the
     2 ms is the reference-machine target, documented).
   - **Transfer:** dispatch with `transfer: [buf]` leaves `buf.byteLength === 0` on
     the main side; the result StarBatch's buffer is a different non-zero
     `ArrayBuffer` (round-tripped, not cloned).
   - **Dev transfer assertion:** dispatching a buffer NOT in `transfer` but mutated
     by the worker proves it was cloned (control); a buffer in `transfer` that the
     stub fails to detach makes `dispatch` throw the dev assertion.
   - **Cancellation frees the worker < 50 ms** (§5.13): a long handler that polls
     `isCancelled()`; cancel mid-run → `dispatch` rejects `WorkerCancelledError`
     and the worker reports free; a subsequent dispatch on the same pool succeeds.
   - **Cancel-before-dispatch:** a pre-cancelled token makes `dispatch` reject
     without posting (spy on the stub's `postMessage`).
   - **Error propagation:** a throwing handler → `dispatch` rejects
     `WorkerTaskError` with `payload.message` matching the thrown message.
   - **Pool routing:** with size 2 and two concurrent long tasks, the third
     dispatch waits; `inFlight` reflects 2 then drains; `defaultPoolSize` math
     verified against mocked `hardwareConcurrency` of 1, 5, 16 → 1, 4, 4.
   - **dispose:** pending dispatches reject `WorkerCancelledError`; the stub
     workers' `terminate` was called.
2. **Coverage gate:** statement coverage ≥ 85% on `src` (TASK-010/024 precedent for
   infra packages).
3. `pnpm verify` exits 0 (boundary lint: no Three.js/React import; no
   `@cosmos/procgen`/`@cosmos/data` import).

## Deliverables

- `packages/workers/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/workers/src/pool.ts` (pool + dispatch + routing + transfer/cancel),
  `src/cancel.ts` (`CancelToken`), `src/serve.ts` (`serveWorker` worker-side),
  `src/errors.ts` (`WorkerTaskError`/`WorkerCancelledError`), `src/index.ts`
- `packages/workers/test/pool.test.ts`, `test/helpers/fake-worker.ts`
  (MessageChannel-backed stub)
- `packages/workers/README.md` (< 150 lines; document the `spawn` Vite syntax the
  app must use and the handler-injection model)

## Context Files

- `docs/architecture.md` §5.13 (whole section), §9 (idle uploads), §2.1 (Comlink)
- `packages/core-types/src/worker-rpc.ts`, `src/batches.ts` (the contract types
  from TASK-031)
- `packages/scene-host/README.md` (frame-loop discipline the callers respect)
