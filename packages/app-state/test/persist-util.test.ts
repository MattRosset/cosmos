import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError } from '@cosmos/core-types';
import { __resetDiagnostics, setTransports } from '@cosmos/diagnostics';
import {
  createSafeStorage,
  migrateBookmarks,
  migrateHistory,
  migrateOverlay,
} from '../src/persist-util';

describe('createSafeStorage', () => {
  it('returns getItem, setItem, removeItem methods', () => {
    const storage = createSafeStorage();
    expect(typeof storage.getItem).toBe('function');
    expect(typeof storage.setItem).toBe('function');
    expect(typeof storage.removeItem).toBe('function');
  });

  it('getItem returns null when localStorage unavailable', () => {
    const storage = createSafeStorage();
    // When localStorage is undefined, getItem should return null.
    const original = global.localStorage;
    // @ts-expect-error — deleting a non-optional global to simulate unavailability
    delete global.localStorage;
    const result = storage.getItem('test');
    expect(result).toBeNull();
    global.localStorage = original;
  });

  it('setItem silently fails when localStorage unavailable', () => {
    const storage = createSafeStorage();
    const original = global.localStorage;
    // @ts-expect-error — deleting a non-optional global to simulate unavailability
    delete global.localStorage;
    // Should not throw.
    expect(() => storage.setItem('test', 'value')).not.toThrow();
    global.localStorage = original;
  });

  it('removeItem silently fails when localStorage unavailable', () => {
    const storage = createSafeStorage();
    const original = global.localStorage;
    // @ts-expect-error — deleting a non-optional global to simulate unavailability
    delete global.localStorage;
    // Should not throw.
    expect(() => storage.removeItem('test')).not.toThrow();
    global.localStorage = original;
  });

  // TASK-058 (audit §3.6): a localStorage that THROWS (quota exceeded, private mode,
  // disabled) still degrades silently for the USER, but is no longer silent for the
  // DEVELOPER — each catch now reports kind:'persistence' to the diagnostics sink.
  describe('reports kind:persistence when localStorage throws', () => {
    const reports: AppError[] = [];
    let original: Storage;

    beforeEach(() => {
      __resetDiagnostics();
      reports.length = 0;
      setTransports([(e) => reports.push(e)]);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      original = global.localStorage;
    });
    afterEach(() => {
      global.localStorage = original;
      setTransports([]);
      __resetDiagnostics();
      vi.restoreAllMocks();
    });

    const throwingStorage = (): Storage =>
      ({
        getItem: () => {
          throw new Error('boom');
        },
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
        removeItem: () => {
          throw new Error('boom');
        },
      }) as unknown as Storage;

    it('setItem degrades (no throw) AND reports kind:persistence', () => {
      global.localStorage = throwingStorage();
      const storage = createSafeStorage();
      expect(() => storage.setItem('k', 'v')).not.toThrow();
      expect(reports).toHaveLength(1);
      expect(reports[0]?.kind).toBe('persistence');
      expect(reports[0]?.context).toMatchObject({ op: 'setItem', key: 'k' });
    });

    it('getItem returns null AND reports kind:persistence', () => {
      global.localStorage = throwingStorage();
      const storage = createSafeStorage();
      expect(storage.getItem('k')).toBeNull();
      expect(reports).toHaveLength(1);
      expect(reports[0]?.kind).toBe('persistence');
      expect(reports[0]?.context).toMatchObject({ op: 'getItem', key: 'k' });
    });

    it('removeItem degrades AND reports kind:persistence', () => {
      global.localStorage = throwingStorage();
      const storage = createSafeStorage();
      expect(() => storage.removeItem('k')).not.toThrow();
      expect(reports).toHaveLength(1);
      expect(reports[0]?.kind).toBe('persistence');
      expect(reports[0]?.context).toMatchObject({ op: 'removeItem', key: 'k' });
    });
  });
});

describe('migrateBookmarks', () => {
  it('version 1 passes through valid bookmarks', () => {
    const record = {
      id: 'b1',
      name: 'Test',
      createdAtIso: '2026-06-12T00:00:00Z',
      position: { context: 'system', local: [1, 0, 0] },
      orientation: [0, 0, 0, 1] as const,
      epochJD: 2451545.0,
    };
    const result = migrateBookmarks([record], 1);
    expect(result).toEqual([record]);
  });

  it('version 1 drops invalid bookmarks', () => {
    const valid = {
      id: 'b1',
      name: 'Valid',
      createdAtIso: '2026-06-12T00:00:00Z',
      position: { context: 'system', local: [1, 0, 0] },
      orientation: [0, 0, 0, 1] as const,
      epochJD: 2451545.0,
    };
    const invalid = { id: 'b2' }; // Missing required fields.
    const result = migrateBookmarks([valid, invalid], 1);
    expect(result).toEqual([valid]);
  });

  it('version 1 handles non-array input', () => {
    const result = migrateBookmarks('not an array', 1);
    expect(result).toEqual([]);
  });

  it('future version warns and returns empty', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = migrateBookmarks([], 99);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown bookmarks schema version 99')
    );
    warnSpy.mockRestore();
  });

  it('undefined version returns empty', () => {
    const result = migrateBookmarks([], 0);
    expect(result).toEqual([]);
  });
});

describe('migrateHistory', () => {
  it('version 1 passes through valid entries', () => {
    const entry = { id: 'sirius', visitedAtIso: '2026-06-12T10:00:00Z' };
    const result = migrateHistory([entry], 1);
    expect(result).toEqual([entry]);
  });

  it('version 1 drops invalid entries', () => {
    const valid = { id: 'sirius', visitedAtIso: '2026-06-12T10:00:00Z' };
    const invalid = { id: 'betelgeuse' }; // Missing visitedAtIso.
    const result = migrateHistory([valid, invalid], 1);
    expect(result).toEqual([valid]);
  });

  it('version 1 handles non-array input', () => {
    const result = migrateHistory('not an array', 1);
    expect(result).toEqual([]);
  });

  it('future version warns and returns empty', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = migrateHistory([], 99);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown history schema version 99')
    );
    warnSpy.mockRestore();
  });

  it('undefined version returns empty', () => {
    const result = migrateHistory([], 0);
    expect(result).toEqual([]);
  });
});

describe('migrateOverlay', () => {
  it('version 1 passes through valid flags', () => {
    const flags = { constellations: true, labels: false, cinematic: true };
    const result = migrateOverlay(flags, 1);
    expect(result).toEqual(flags);
  });

  it('version 1 falls back to defaults for non-object input', () => {
    const result = migrateOverlay('not an object', 1);
    expect(result).toEqual({
      constellations: false,
      labels: false,
      cinematic: false,
    });
  });

  it('version 1 falls back per-field for invalid types', () => {
    const result = migrateOverlay(
      { constellations: 'yes', labels: true, cinematic: 1 },
      1
    );
    expect(result).toEqual({
      constellations: false,
      labels: true,
      cinematic: false,
    });
  });

  it('future version warns and returns defaults', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = migrateOverlay({}, 99);
    expect(result).toEqual({
      constellations: false,
      labels: false,
      cinematic: false,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown overlay schema version 99')
    );
    warnSpy.mockRestore();
  });

  it('undefined version returns defaults', () => {
    const result = migrateOverlay({}, 0);
    expect(result).toEqual({
      constellations: false,
      labels: false,
      cinematic: false,
    });
  });
});
