import type { WorkerPool, WorkerMethod, WorkerMethodParams, DispatchOptions } from '@cosmos/workers';
import { WorkerCancelledError } from '@cosmos/workers';
import type { StarBatch } from '@cosmos/core-types';
import { decodeTile } from '../../src/octree-decode.js';

export interface FakeDispatch {
  method: WorkerMethod;
  params: WorkerMethodParams[WorkerMethod];
  transferList: readonly ArrayBuffer[];
  cancelled: boolean;
}

export interface FakePool extends WorkerPool {
  dispatches: FakeDispatch[];
}

export interface FakePoolOptions {
  /** When true, dispatches do not resolve until resolveAll() is called (for abort tests). */
  hold?: boolean;
}

/** Creates a synchronous-decode fake WorkerPool for use in Node tests. */
export function createFakePool(opts?: FakePoolOptions): FakePool {
  const dispatches: FakeDispatch[] = [];

  const pool: FakePool = {
    size: 1,
    get inFlight() {
      return 0;
    },
    dispatches,

    dispatch(
      method: WorkerMethod,
      params: WorkerMethodParams[WorkerMethod],
      dispatchOpts?: DispatchOptions,
    ): Promise<StarBatch> {
      const record: FakeDispatch = {
        method,
        params,
        transferList: dispatchOpts?.transfer ?? [],
        cancelled: false,
      };
      dispatches.push(record);

      return new Promise<StarBatch>((resolve, reject) => {
        const token = dispatchOpts?.token;

        if (token?.cancelled) {
          record.cancelled = true;
          reject(new WorkerCancelledError());
          return;
        }

        const onCancel = (): void => {
          record.cancelled = true;
          reject(new WorkerCancelledError());
        };

        token?.signal.addEventListener('abort', onCancel, { once: true });

        if (opts?.hold) {
          // Caller controls resolution via resolveAll; just hold here.
          return;
        }

        queueMicrotask(() => {
          if (token?.cancelled) {
            record.cancelled = true;
            token.signal.removeEventListener('abort', onCancel);
            reject(new WorkerCancelledError());
            return;
          }

          token?.signal.removeEventListener('abort', onCancel);

          if (method === 'octree.decode') {
            const req = params as { tile: Parameters<typeof decodeTile>[1]; idPrefix: string; bin: ArrayBuffer };
            try {
              const { batch } = decodeTile(req.bin, req.tile, req.idPrefix);
              resolve(batch);
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error(`FakePool: unknown method "${method}"`));
          }
        });
      });
    },

    dispose() {
      // nothing to tear down
    },
  };

  return pool;
}
