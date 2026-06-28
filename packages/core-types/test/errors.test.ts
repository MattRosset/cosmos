import { describe, expect, it } from 'vitest';
import { toAppError } from '../src/errors';
import type { AppError } from '../src/errors';
import type { ChunkLifecycleEvent } from '../src/streaming';

describe('toAppError', () => {
  it('normalizes a real Error, preserving name/message/stack', () => {
    const err = new TypeError('x');
    const at = 1_700_000_000_000;
    const result = toAppError(err, 'loader', undefined, at);
    expect(result.kind).toBe('loader');
    expect(result.name).toBe('TypeError');
    expect(result.message).toBe('x');
    expect(typeof result.stack).toBe('string');
    expect(result.atMs).toBe(at);
  });

  it('preserves a custom Error subclass name', () => {
    class PackFormatError extends Error {
      override readonly name = 'PackFormatError';
    }
    const result = toAppError(new PackFormatError('bad pack'), 'loader');
    expect(result.name).toBe('PackFormatError');
    expect(result.message).toBe('bad pack');
  });

  it('normalizes a thrown string with name:Error and no stack', () => {
    const result = toAppError('boom', 'unknown', undefined, 42);
    expect(result.name).toBe('Error');
    expect(result.message).toBe('boom');
    expect(result.stack).toBeUndefined();
    expect(result.atMs).toBe(42);
  });

  it('normalizes a thrown plain object via String()', () => {
    const result = toAppError({ foo: 1 }, 'unknown', undefined, 0);
    expect(result.name).toBe('Error');
    expect(result.message).toBe('[object Object]');
    expect(result.stack).toBeUndefined();
  });

  it('normalizes undefined without throwing', () => {
    const result = toAppError(undefined, 'unknown', undefined, 0);
    expect(result.name).toBe('Error');
    expect(result.message).toBe('undefined');
  });

  it('attaches serializable context when provided', () => {
    const result = toAppError(new Error('x'), 'streaming', {
      chunkId: '3/427',
      tier: 2,
      cached: false,
      parent: null,
    });
    expect(result.context).toEqual({
      chunkId: '3/427',
      tier: 2,
      cached: false,
      parent: null,
    });
  });

  it('returns a fresh object per call (no shared mutation)', () => {
    const a = toAppError('a', 'unknown', undefined, 1);
    const b = toAppError('b', 'unknown', undefined, 2);
    expect(a).not.toBe(b);
    expect(a.message).toBe('a');
    expect(b.message).toBe('b');
  });

  it('round-trips through JSON.stringify/parse unchanged', () => {
    const result = toAppError(new Error('x'), 'render', { url: '/a' }, 100);
    const round = JSON.parse(JSON.stringify(result)) as AppError;
    expect(round).toEqual(result);
  });

  it('round-trips through structuredClone (worker boundary)', () => {
    const result = toAppError(new Error('x'), 'worker', { id: 7 }, 100);
    const cloned = structuredClone(result);
    expect(cloned).toEqual(result);
  });
});

describe('ChunkLifecycleEvent error phase', () => {
  it('accepts an error event with phase:error + AppError + batch:null', () => {
    const error = toAppError(new Error('decode failed'), 'streaming', {
      chunkId: '3/427',
    });
    const event: ChunkLifecycleEvent = {
      phase: 'error',
      kind: 'octree',
      chunkId: '3/427',
      lod: 3,
      batch: null,
      error,
    };
    expect(event.phase).toBe('error');
    expect(event.error?.kind).toBe('streaming');
  });

  it('accepts a ready event with error:null', () => {
    const event: ChunkLifecycleEvent = {
      phase: 'ready',
      kind: 'octree',
      chunkId: '3/427',
      lod: 3,
      batch: null,
      error: null,
    };
    expect(event.error).toBeNull();
  });
});
