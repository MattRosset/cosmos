import { describe, expect, it, vi } from 'vitest';
import {
  createSafeStorage,
  migrateBookmarks,
  migrateHistory,
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
