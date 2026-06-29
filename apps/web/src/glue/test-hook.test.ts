import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamingPolicy } from '@cosmos/streaming';
import { __resetDiagnostics, reportError } from '@cosmos/diagnostics';
import { streamingHolder, testHook } from './test-hook';

/**
 * TASK-058 acceptance test 4: the `__cosmos` debug global exposes LIVE diagnostics
 * counters the error gate (TASK-059) reads — `errorCounts` mirrors the central sink
 * and `failedChunks` mirrors `streaming.stats.failedChunks`. Both are getters, so a
 * probe reads the true value at access time, never a stale ≤ 4 Hz mirror.
 */
describe('testHook diagnostics read surface (TASK-058)', () => {
  beforeEach(() => {
    __resetDiagnostics();
    streamingHolder.current = null;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    __resetDiagnostics();
    streamingHolder.current = null;
    vi.restoreAllMocks();
  });

  it('errorCounts.total reflects live diagnostics counts', () => {
    expect(testHook.errorCounts.total).toBe(0);
    reportError(new Error('boom'), 'persistence', { op: 'setItem', key: 'k' });
    reportError(new Error('bad'), 'invariant');
    expect(testHook.errorCounts.total).toBe(2);
    // Per-kind tallies flow through too.
    expect(testHook.errorCounts.persistence).toBe(1);
    expect(testHook.errorCounts.invariant).toBe(1);
  });

  it('failedChunks reflects streaming.stats.failedChunks (0 when no policy)', () => {
    expect(testHook.failedChunks).toBe(0);
    streamingHolder.current = {
      stats: { failedChunks: 3 },
    } as unknown as StreamingPolicy;
    expect(testHook.failedChunks).toBe(3);
  });
});
