import type {
  WorkerRequest,
  WorkerResponse,
  StarBatch,
  ProcgenGalaxyRequest,
  OctreeDecodeRequest,
} from '@cosmos/core-types';
import { createCancelToken } from './cancel.js';
import type { CancelToken } from './cancel.js';
import { WorkerTaskError, WorkerCancelledError } from './errors.js';

// Dev check: true unless explicitly in a production build
const _isDev: boolean = (() => {
  try {
    return (globalThis as unknown as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.['NODE_ENV'] !== 'production';
  } catch {
    return true;
  }
})();

/** §5.13: min(hardwareConcurrency − 1, 4), floored at 1. */
export function defaultPoolSize(): number {
  const concurrency =
    typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 4) : 4;
  return Math.max(1, Math.min(concurrency - 1, 4));
}

export type WorkerMethod = 'procgen.galaxy' | 'octree.decode';

export interface WorkerMethodParams {
  readonly 'procgen.galaxy': ProcgenGalaxyRequest;
  readonly 'octree.decode': OctreeDecodeRequest;
}

export interface DispatchOptions {
  readonly transfer?: readonly ArrayBuffer[];
  readonly token?: CancelToken;
}

export interface WorkerPool {
  readonly size: number;
  dispatch(
    method: WorkerMethod,
    params: WorkerMethodParams[WorkerMethod],
    opts?: DispatchOptions,
  ): Promise<StarBatch>;
  readonly inFlight: number;
  dispose(): void;
}

export interface WorkerPoolOptions {
  readonly size?: number;
  readonly spawn: () => Worker;
}

interface InFlight {
  resolve: (batch: StarBatch) => void;
  reject: (err: unknown) => void;
  workerIndex: number;
  cleanup: () => void;
}

interface Queued {
  id: number;
  method: WorkerMethod;
  params: WorkerMethodParams[WorkerMethod];
  transfer: ArrayBuffer[];
  token: CancelToken;
  resolve: (batch: StarBatch) => void;
  reject: (err: unknown) => void;
}

export function createWorkerPool(opts: WorkerPoolOptions): WorkerPool {
  const poolSize = opts.size ?? defaultPoolSize();

  const slots = Array.from({ length: poolSize }, () => ({
    worker: opts.spawn(),
    busy: false,
  }));

  let _nextId = 0;
  let _inFlight = 0;
  const inFlightMap = new Map<number, InFlight>();
  const pendingQueue: Queued[] = [];
  const queuedAbortHandlers = new Map<number, () => void>();
  let disposed = false;

  function handleResponse(response: WorkerResponse<StarBatch>): void {
    const entry = inFlightMap.get(response.id);
    if (!entry) return;

    inFlightMap.delete(response.id);
    _inFlight--;
    slots[entry.workerIndex]!.busy = false;
    entry.cleanup();

    if ('cancelled' in response) {
      entry.reject(new WorkerCancelledError());
    } else if (response.ok) {
      entry.resolve(response.result);
    } else {
      entry.reject(new WorkerTaskError(response.error));
    }

    tryFlush();
  }

  for (let i = 0; i < poolSize; i++) {
    slots[i]!.worker.addEventListener('message', (e: MessageEvent) => {
      handleResponse(e.data as WorkerResponse<StarBatch>);
    });
  }

  function findFree(): number {
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i]!.busy) return i;
    }
    return -1;
  }

  function sendToWorker(queued: Queued, workerIndex: number): void {
    const slot = slots[workerIndex]!;
    slot.busy = true;
    _inFlight++;

    const onAbort = (): void => {
      if (inFlightMap.has(queued.id)) {
        slot.worker.postMessage({ cancel: queued.id });
      }
    };

    queued.token.signal.addEventListener('abort', onAbort);

    inFlightMap.set(queued.id, {
      resolve: queued.resolve,
      reject: queued.reject,
      workerIndex,
      cleanup: () => queued.token.signal.removeEventListener('abort', onAbort),
    });

    const request: WorkerRequest<string, unknown> = {
      id: queued.id,
      method: queued.method,
      params: queued.params,
      token: queued.token.id,
    };

    slot.worker.postMessage(request, queued.transfer);

    if (_isDev) {
      for (const buf of queued.transfer) {
        if (buf.byteLength !== 0) {
          inFlightMap.delete(queued.id);
          _inFlight--;
          slot.busy = false;
          queued.token.signal.removeEventListener('abort', onAbort);
          queued.reject(
            new Error(
              `[workers] Dev transfer assertion: buffer.byteLength is ${buf.byteLength} after postMessage — buffer was cloned, not transferred.`,
            ),
          );
          return;
        }
      }
    }
  }

  function tryFlush(): void {
    while (pendingQueue.length > 0) {
      const idx = findFree();
      if (idx === -1) break;

      const queued = pendingQueue.shift()!;
      const abortHandler = queuedAbortHandlers.get(queued.id);
      if (abortHandler) {
        queued.token.signal.removeEventListener('abort', abortHandler);
        queuedAbortHandlers.delete(queued.id);
      }

      if (queued.token.cancelled) {
        queued.reject(new WorkerCancelledError());
        continue;
      }

      sendToWorker(queued, idx);
    }
  }

  return {
    get size() {
      return poolSize;
    },
    get inFlight() {
      return _inFlight;
    },

    dispatch(method, params, dispatchOpts) {
      return new Promise<StarBatch>((resolve, reject) => {
        if (disposed) {
          reject(new WorkerCancelledError());
          return;
        }

        const token = dispatchOpts?.token ?? createCancelToken();

        if (token.cancelled) {
          reject(new WorkerCancelledError());
          return;
        }

        const id = _nextId++;
        const transfer = dispatchOpts?.transfer ? [...dispatchOpts.transfer] : [];

        const queued: Queued = { id, method, params, transfer, token, resolve, reject };

        const freeIdx = findFree();
        if (freeIdx !== -1) {
          sendToWorker(queued, freeIdx);
        } else {
          // All workers busy — queue and set up cancellation while queued
          const onAbort = (): void => {
            const qIdx = pendingQueue.findIndex((q) => q.id === id);
            if (qIdx !== -1) {
              pendingQueue.splice(qIdx, 1);
              queuedAbortHandlers.delete(id);
              reject(new WorkerCancelledError());
            }
          };
          token.signal.addEventListener('abort', onAbort);
          queuedAbortHandlers.set(id, onAbort);
          pendingQueue.push(queued);
        }
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;

      for (const queued of pendingQueue) {
        const handler = queuedAbortHandlers.get(queued.id);
        if (handler) queued.token.signal.removeEventListener('abort', handler);
        queued.reject(new WorkerCancelledError());
      }
      pendingQueue.length = 0;
      queuedAbortHandlers.clear();

      for (const [, entry] of inFlightMap) {
        entry.cleanup();
        entry.reject(new WorkerCancelledError());
      }
      inFlightMap.clear();
      _inFlight = 0;

      for (const slot of slots) {
        slot.busy = false;
        slot.worker.terminate();
      }
    },
  };
}
