import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError } from '@cosmos/core-types';
import {
  __resetDiagnostics,
  getErrorCounts,
  reportError,
  setTransports,
} from '../src/sink';

beforeEach(() => {
  __resetDiagnostics();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reportError', () => {
  it('normalizes, returns the AppError, logs once, and counts', () => {
    const e = reportError(new TypeError('x'), 'loader', { a: 1 });
    expect(e.kind).toBe('loader');
    expect(e.name).toBe('TypeError');
    expect(e.message).toBe('x');
    expect(e.context).toEqual({ a: 1 });
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(getErrorCounts().total).toBe(1);
    expect(getErrorCounts().loader).toBe(1);
  });

  it('routes to an installed transport and stops after unsubscribe', () => {
    const received: AppError[] = [];
    const unsubscribe = setTransports([(e) => received.push(e)]);
    reportError(new Error('first'), 'render');
    expect(received).toHaveLength(1);
    expect(received[0]?.message).toBe('first');

    unsubscribe();
    reportError(new Error('second'), 'render');
    expect(received).toHaveLength(1);
  });

  it('dedupes identical reports in the window but still counts each', () => {
    const received: AppError[] = [];
    setTransports([(e) => received.push(e)]);
    for (let i = 0; i < 6; i++) reportError(new Error('boom'), 'streaming');
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
    expect(getErrorCounts().total).toBe(6);
    expect(getErrorCounts().streaming).toBe(6);
  });

  it('logs distinct messages separately (dedupe key includes message)', () => {
    reportError(new Error('a'), 'unknown');
    reportError(new Error('b'), 'unknown');
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('swallows a throwing transport and warns instead of propagating', () => {
    setTransports([
      () => {
        throw new Error('transport down');
      },
    ]);
    expect(() => reportError(new Error('x'), 'worker')).not.toThrow();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(getErrorCounts().worker).toBe(1);
  });

  it('__resetDiagnostics zeroes counts, dedupe, and transports', () => {
    const received: AppError[] = [];
    setTransports([(e) => received.push(e)]);
    reportError(new Error('boom'), 'loader');
    expect(getErrorCounts().total).toBe(1);

    __resetDiagnostics();
    expect(getErrorCounts().total).toBe(0);
    expect(getErrorCounts().loader).toBe(0);

    // dedupe was cleared: the same message logs again; transports were dropped.
    reportError(new Error('boom'), 'loader');
    expect(console.error).toHaveBeenCalledTimes(2);
    expect(received).toHaveLength(1);
  });
});
