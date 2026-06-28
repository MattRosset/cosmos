import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertInvariant } from '../src/assert';
import { __setDevForTests } from '../src/env';
import { __resetDiagnostics, getErrorCounts } from '../src/sink';

beforeEach(() => {
  __resetDiagnostics();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  __setDevForTests(undefined);
  vi.restoreAllMocks();
});

describe('assertInvariant', () => {
  it('does nothing when the condition holds', () => {
    __setDevForTests(true);
    expect(() => assertInvariant(true, 'always true')).not.toThrow();
    expect(getErrorCounts().total).toBe(0);
  });

  it('DEV: throws and counts an invariant report on failure', () => {
    __setDevForTests(true);
    expect(() => assertInvariant(false, 'tiles should have loaded')).toThrow(
      /tiles should have loaded/,
    );
    expect(getErrorCounts().invariant).toBe(1);
  });

  it('PROD: reports + returns without throwing (degrade)', () => {
    __setDevForTests(false);
    expect(() => assertInvariant(false, 'degrade me', { where: 'octree' })).not.toThrow();
    expect(getErrorCounts().invariant).toBe(1);
  });
});
