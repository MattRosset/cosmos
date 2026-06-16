import { describe, expect, it } from 'vitest';
import type { ChunkLifecycleEvent } from '../src/streaming';
import type { WorkerResponse } from '../src/worker-rpc';

describe('ChunkLifecycleEvent shape', () => {
  it('accepts a valid event with batch: null', () => {
    const event: ChunkLifecycleEvent = {
      phase: 'request',
      kind: 'octree',
      chunkId: '3/427',
      lod: 3,
      batch: null,
    };
    expect(event.phase).toBe('request');
    expect(event.batch).toBeNull();
  });

  it('accepts a ready event with a batch object', () => {
    const batch = {
      count: 1,
      originPc: [0, 0, 0] as const,
      positionsPc: new Float32Array(3),
      absMag: new Float32Array(1),
      colorIndexBV: new Float32Array(1),
      catalogIds: new Uint32Array(1),
      hipIds: new Uint32Array(1),
      idPrefix: 'gaia',
    };
    const event: ChunkLifecycleEvent = {
      phase: 'ready',
      kind: 'octree',
      chunkId: '3/427',
      lod: 3,
      batch,
    };
    expect(event.batch).toBe(batch);
  });

  it('rejects mutation of readonly fields (compile-time only)', () => {
    const event: ChunkLifecycleEvent = {
      phase: 'evict',
      kind: 'procgen',
      chunkId: 'gal42:sec7',
      lod: 2,
      batch: null,
    };
    // @ts-expect-error — readonly field cannot be reassigned
    event.phase = 'ready';
    // @ts-expect-error — readonly field cannot be reassigned
    event.chunkId = 'other';
    expect(event).toBeDefined();
  });

  it('batch field is required — omitting it is a type error (compile-time only)', () => {
    // @ts-expect-error — batch is required
    const incomplete: ChunkLifecycleEvent = {
      phase: 'request',
      kind: 'octree',
      chunkId: '0/0',
      lod: 0,
    };
    expect(incomplete).toBeDefined();
  });
});

describe('WorkerResponse discriminated union', () => {
  it('narrows to result on ok: true', () => {
    const res: WorkerResponse<string> = { id: 1, ok: true, result: 'hello' };
    if (res.ok === true) {
      expect(res.result).toBe('hello');
    }
  });

  it('narrows to error on ok: false', () => {
    const res: WorkerResponse<string> = {
      id: 2,
      ok: false,
      error: { name: 'Error', message: 'boom' },
    };
    if (!res.ok && !('cancelled' in res)) {
      expect(res.error.message).toBe('boom');
    }
  });

  it('narrows to cancelled variant', () => {
    const res: WorkerResponse<string> = { id: 3, cancelled: true };
    if ('cancelled' in res && res.cancelled) {
      expect(res.id).toBe(3);
    }
  });

  it('result is not accessible without narrowing (compile-time only)', () => {
    // Function parameter prevents TypeScript from narrowing the union.
    function getResult(res: WorkerResponse<string>): void {
      // @ts-expect-error — result only exists on the ok:true variant, not accessible unnarrowed
      void res.result;
    }
    expect(getResult).toBeDefined();
  });
});
