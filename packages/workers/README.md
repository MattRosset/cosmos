# @cosmos/workers

Pooled Web Worker infrastructure for Cosmos (architecture §5.13).

Manages a fixed pool of workers, typed RPC over `postMessage`, cooperative
cancellation tokens, and zero-copy `ArrayBuffer` transfer discipline.

This package **never imports Three.js, `@cosmos/procgen`, or `@cosmos/data`**
— it moves raw buffers only.  Handler logic is injected by the callers.

## Pool sizing

```ts
import { defaultPoolSize, createWorkerPool } from '@cosmos/workers';
// min(hardwareConcurrency − 1, 4), floored at 1
```

## Vite worker syntax (app responsibility)

Worker entry files live in `procgen` and `data`.  The **app** passes a `spawn`
factory that uses Vite's special URL syntax so the bundler picks up the entry:

```ts
import { createWorkerPool } from '@cosmos/workers';

const pool = createWorkerPool({
  spawn: () =>
    new Worker(new URL('./workers/procgen-entry.ts', import.meta.url), {
      type: 'module',
    }),
});
```

The `@cosmos/workers` package itself never contains a `new Worker(new URL(…))`
call — it has no worker entry files to point at.

## Handler injection model

Each worker entry file calls `serveWorker` **once** at its top level, injecting
the handlers for the methods that entry supports:

```ts
// packages/procgen/src/worker-entry.ts
import { serveWorker } from '@cosmos/workers';
import { runGalaxy } from './galaxy.js';

serveWorker({
  'procgen.galaxy': (params, isCancelled) => runGalaxy(params, isCancelled),
});
```

Handlers receive a cheap `isCancelled()` that **must** be polled in long loops
(§5.13 gate: free the worker within 50 ms of cancellation):

```ts
for (let i = 0; i < N; i++) {
  if (i % 1_000 === 0 && isCancelled()) return earlyBatch;
  // … heavy work …
}
```

Return `{ batch, transfer }` where `transfer` lists every `ArrayBuffer` that
backs the result's typed arrays so they are moved (not cloned) back to the main
thread.

## Dispatching

```ts
const batch = await pool.dispatch(
  'octree.decode',
  { tile, idPrefix, bin },
  { transfer: [bin] },          // transfer the fetched .bin buffer
);
// batch.positionsPc.buffer is a transferred ArrayBuffer — no copy
```

A `CancelToken` can be passed to abort in-flight work:

```ts
import { createCancelToken } from '@cosmos/workers';

const token = createCancelToken();
pool.dispatch('procgen.galaxy', params, { token }).catch(…);
// later:
token.cancel();
```

## Errors

| Class | When |
|---|---|
| `WorkerTaskError` | Handler threw — `.payload` carries `{ name, message, stack }` |
| `WorkerCancelledError` | Token cancelled, or `pool.dispose()` called |

## Tear-down

```ts
pool.dispose(); // terminates all workers; in-flight dispatches reject
```
