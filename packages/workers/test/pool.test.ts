import { describe, it, expect, vi } from 'vitest';
import {
  createWorkerPool,
  defaultPoolSize,
  createCancelToken,
  WorkerTaskError,
  WorkerCancelledError,
} from '../src/index.js';
import type {
  WorkerHandlers,
  WorkerPool,
  DispatchOptions,
} from '../src/index.js';
import type {
  StarBatch,
  ProcgenGalaxyRequest,
  OctreeTileManifest,
} from '@cosmos/core-types';
import { FakeWorker } from './helpers/fake-worker.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

function makeBatch(count = 1): { batch: StarBatch; transfer: readonly ArrayBuffer[] } {
  const posBuf = new ArrayBuffer(count * 3 * 4);
  const magBuf = new ArrayBuffer(count * 4);
  const bvBuf  = new ArrayBuffer(count * 4);
  const catBuf = new ArrayBuffer(count * 4);
  const hipBuf = new ArrayBuffer(count * 4);
  const batch: StarBatch = {
    count,
    originPc: [0, 0, 0],
    positionsPc: new Float32Array(posBuf),
    absMag: new Float32Array(magBuf),
    colorIndexBV: new Float32Array(bvBuf),
    catalogIds: new Uint32Array(catBuf),
    hipIds: new Uint32Array(hipBuf),
    idPrefix: 'test',
  };
  return { batch, transfer: [posBuf, magBuf, bvBuf, catBuf, hipBuf] };
}

const galaxyParams: ProcgenGalaxyRequest = {
  params: { seed: 1, starCount: 10 },
};

const mockTile: OctreeTileManifest = {
  key: '0/0',
  isLeaf: true,
  childMask: 0,
  pointCount: 1,
  centerUnits: [0, 0, 0],
  halfExtentUnits: 1000,
  binUrl: 'tile.bin',
  contentHashSha256: 'abc',
  buffers: {
    positionsPc: { byteOffset: 0, byteLength: 12 },
    absMag: { byteOffset: 12, byteLength: 4 },
    colorIndexBV: { byteOffset: 16, byteLength: 4 },
    catalogIds: { byteOffset: 20, byteLength: 4 },
    hipIds: { byteOffset: 24, byteLength: 4 },
  },
};

// Handlers that return immediately
const trivialHandlers: Partial<WorkerHandlers> = {
  'procgen.galaxy': () => makeBatch(),
};

// Cast an async handler to the sync signature — serveWorker wraps with
// Promise.resolve so async handlers work transparently at runtime.
type AsyncHandlerFn<K extends keyof WorkerHandlers> = (
  params: Parameters<WorkerHandlers[K]>[0],
  isCancelled: () => boolean,
) => Promise<ReturnType<WorkerHandlers[K]>>;

function asyncHandler<K extends keyof WorkerHandlers>(fn: AsyncHandlerFn<K>): WorkerHandlers[K] {
  return fn as unknown as WorkerHandlers[K];
}

function spawn(handlers: Partial<WorkerHandlers> = trivialHandlers, skipTransfer = false): Worker {
  const fw = new FakeWorker(handlers);
  fw.skipTransfer = skipTransfer;
  return fw as unknown as Worker;
}

function pool(
  handlers: Partial<WorkerHandlers> = trivialHandlers,
  size = 1,
  skipTransfer = false,
): WorkerPool {
  return createWorkerPool({ size, spawn: () => spawn(handlers, skipTransfer) });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('defaultPoolSize', () => {
  it.each([
    [1,  1],
    [5,  4],
    [16, 4],
  ])('hardwareConcurrency %i → %i', (hc, expected) => {
    vi.stubGlobal('navigator', { hardwareConcurrency: hc });
    expect(defaultPoolSize()).toBe(expected);
    vi.unstubAllGlobals();
  });
});

describe('no-op round-trip', () => {
  it('resolves within 100 ms (CI generous multiple of the 2 ms reference target §5.13)', async () => {
    const p = pool();
    const start = Date.now();
    const result = await p.dispatch('procgen.galaxy', galaxyParams);
    const elapsed = Date.now() - start;
    expect(result.count).toBe(1);
    // 2 ms reference; 100 ms CI guard
    expect(elapsed).toBeLessThan(100);
    p.dispose();
  });
});

describe('transfer discipline', () => {
  it('transferred buffer is detached on main side after dispatch', async () => {
    const octDecodeHandlers: Partial<WorkerHandlers> = {
      'octree.decode': () => makeBatch(),
    };
    const p = pool(octDecodeHandlers);

    const bin = new ArrayBuffer(64);
    const opts: DispatchOptions = { transfer: [bin] };
    await p.dispatch('octree.decode', { tile: mockTile, idPrefix: '', bin }, opts);

    // Buffer transferred → detached in main thread
    expect(bin.byteLength).toBe(0);
    p.dispose();
  });

  it('result StarBatch buffers are non-zero (round-tripped from worker)', async () => {
    const p = pool();
    const result = await p.dispatch('procgen.galaxy', galaxyParams);
    expect(result.positionsPc.buffer.byteLength).toBeGreaterThan(0);
    p.dispose();
  });

  it('dev assertion — control: non-transferred buffer is cloned (still accessible)', async () => {
    const p = pool();
    const buf = new ArrayBuffer(8);
    // buf NOT in opts.transfer
    await p.dispatch('procgen.galaxy', galaxyParams);
    // buf is still intact because it was never transferred
    expect(buf.byteLength).toBe(8);
    p.dispose();
  });

  it('dev assertion — failure: stub that clones instead of transferring makes dispatch reject', async () => {
    // skipTransfer=true → FakeWorker ignores transfer list → buffer not detached
    const p = pool(trivialHandlers, 1, true);
    const buf = new ArrayBuffer(8);
    await expect(
      p.dispatch('procgen.galaxy', galaxyParams, { transfer: [buf] }),
    ).rejects.toThrow(/transfer assertion/i);
    p.dispose();
  });
});

describe('cancellation', () => {
  it('cancel-before-dispatch: pre-cancelled token rejects immediately without postMessage', async () => {
    let postMessageCalled = false;
    const p = createWorkerPool({
      size: 1,
      spawn: () => {
        const fw = new FakeWorker(trivialHandlers);
        const origPost = fw.postMessage.bind(fw);
        fw.postMessage = (...args: Parameters<typeof fw.postMessage>) => {
          postMessageCalled = true;
          origPost(...args);
        };
        return fw as unknown as Worker;
      },
    });

    const token = createCancelToken();
    token.cancel();

    await expect(
      p.dispatch('procgen.galaxy', galaxyParams, { token }),
    ).rejects.toThrow(WorkerCancelledError);

    expect(postMessageCalled).toBe(false);
    p.dispose();
  });

  it('cancel mid-run: dispatch rejects WorkerCancelledError and worker is freed', async () => {
    const slowHandlers: Partial<WorkerHandlers> = {
      'procgen.galaxy': asyncHandler<'procgen.galaxy'>(async (_p, isCancelled) => {
        // Poll isCancelled every 5 ms — simulates a long computation
        for (let i = 0; i < 20; i++) {
          await new Promise<void>((r) => setTimeout(r, 5));
          if (isCancelled()) return makeBatch();
        }
        return makeBatch();
      }),
    };

    const p = pool(slowHandlers);
    const token = createCancelToken();

    const start = Date.now();
    const dispatch = p.dispatch('procgen.galaxy', galaxyParams, { token });

    // Cancel after a tick so the handler has started
    await new Promise<void>((r) => setTimeout(r, 15));
    token.cancel();

    await expect(dispatch).rejects.toThrow(WorkerCancelledError);

    // §5.13: worker must free within 50 ms of cancellation
    expect(Date.now() - start).toBeLessThan(500); // generous CI guard
    expect(p.inFlight).toBe(0);

    // Subsequent dispatch must succeed on the now-free worker
    const result = await p.dispatch('procgen.galaxy', galaxyParams);
    expect(result.count).toBe(1);

    p.dispose();
  }, 5000);

  it('error propagation: throwing handler rejects with WorkerTaskError carrying the message', async () => {
    const errorHandlers: Partial<WorkerHandlers> = {
      'procgen.galaxy': () => {
        throw new Error('handler boom');
      },
    };
    const p = pool(errorHandlers);

    const err = await p.dispatch('procgen.galaxy', galaxyParams).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerTaskError);
    expect((err as WorkerTaskError).payload.message).toBe('handler boom');
    p.dispose();
  });
});

describe('pool routing', () => {
  it('inFlight reflects dispatched-only tasks; third task queues when both workers busy', async () => {
    // Long handlers so workers stay busy during the assertion window
    const slowHandlers: Partial<WorkerHandlers> = {
      'procgen.galaxy': asyncHandler<'procgen.galaxy'>(async () => {
        await new Promise<void>((r) => setTimeout(r, 50));
        return makeBatch();
      }),
    };

    const p = createWorkerPool({
      size: 2,
      spawn: () => new FakeWorker(slowHandlers) as unknown as Worker,
    });

    const p1 = p.dispatch('procgen.galaxy', galaxyParams);
    const p2 = p.dispatch('procgen.galaxy', galaxyParams);

    // Both workers in flight
    expect(p.inFlight).toBe(2);

    const p3 = p.dispatch('procgen.galaxy', galaxyParams);
    // Third is queued — inFlight still 2
    expect(p.inFlight).toBe(2);

    await Promise.all([p1, p2, p3]);
    expect(p.inFlight).toBe(0);

    p.dispose();
  }, 5000);
});

describe('dispose', () => {
  it('pending dispatches reject with WorkerCancelledError and terminate is called', async () => {
    let terminateCount = 0;
    const slowHandlers: Partial<WorkerHandlers> = {
      'procgen.galaxy': asyncHandler<'procgen.galaxy'>(async () => {
        await new Promise<void>((r) => setTimeout(r, 500));
        return makeBatch();
      }),
    };

    const p = createWorkerPool({
      size: 2,
      spawn: () => {
        const fw = new FakeWorker(slowHandlers);
        fw.onTerminate = () => { terminateCount++; };
        return fw as unknown as Worker;
      },
    });

    const promises = [
      p.dispatch('procgen.galaxy', galaxyParams),
      p.dispatch('procgen.galaxy', galaxyParams),
      p.dispatch('procgen.galaxy', galaxyParams), // queued
    ];

    // Let workers start
    await new Promise<void>((r) => setTimeout(r, 10));

    p.dispose();

    const results = await Promise.allSettled(promises);
    for (const r of results) {
      expect(r.status).toBe('rejected');
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(WorkerCancelledError);
    }

    expect(terminateCount).toBe(2);
  }, 5000);
});
