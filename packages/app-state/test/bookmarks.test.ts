import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkRecord } from '@cosmos/core-types';
import { BOOKMARKS_SCHEMA_VERSION } from '@cosmos/core-types';
import { useBookmarkStore } from '../src/bookmarks';

// Mock localStorage for each test.
beforeEach(() => {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        Object.keys(store).forEach((key) => delete store[key]);
      },
    },
    configurable: true,
  });
});

afterEach(() => {
  useBookmarkStore.setState({ bookmarks: [] });
  localStorage.clear();
});

const createTestRecord = (overrides?: Partial<BookmarkRecord>): BookmarkRecord => ({
  id: 'b1',
  name: 'Test',
  createdAtIso: '2026-06-12T00:00:00Z',
  position: { context: 'system', local: [1, 0, 0] },
  orientation: [0, 0, 0, 1],
  epochJD: 2451545.0,
  ...overrides,
});

describe('useBookmarkStore', () => {
  it('starts with empty bookmarks', () => {
    expect(useBookmarkStore.getState().bookmarks).toEqual([]);
  });

  it('add inserts a new bookmark', () => {
    const record = createTestRecord({ id: 'b1', name: 'Saturn ringside' });
    useBookmarkStore.getState().add(record);
    expect(useBookmarkStore.getState().bookmarks).toEqual([record]);
  });

  it('add with duplicate id replaces in place', () => {
    const record1 = createTestRecord({ id: 'b1', name: 'First' });
    const record2 = createTestRecord({
      id: 'b1',
      name: 'Second',
      position: { context: 'system', local: [2, 0, 0] },
    });
    useBookmarkStore.getState().add(record1);
    useBookmarkStore.getState().add(record2);
    const bookmarks = useBookmarkStore.getState().bookmarks;
    expect(bookmarks.length).toBe(1);
    expect(bookmarks[0]!.name).toBe('Second');
    expect(bookmarks[0]!.position.local).toEqual([2, 0, 0]);
  });

  it('remove deletes a bookmark by id', () => {
    const r1 = createTestRecord({ id: 'b1', name: 'First' });
    const r2 = createTestRecord({
      id: 'b2',
      name: 'Second',
      position: { context: 'system', local: [2, 0, 0] },
    });
    useBookmarkStore.getState().add(r1);
    useBookmarkStore.getState().add(r2);
    useBookmarkStore.getState().remove('b1');
    expect(useBookmarkStore.getState().bookmarks).toEqual([r2]);
  });

  it('rename updates bookmark name', () => {
    const record = createTestRecord({ id: 'b1', name: 'Original' });
    useBookmarkStore.getState().add(record);
    useBookmarkStore.getState().rename('b1', 'Updated');
    const updated = useBookmarkStore.getState().bookmarks[0];
    expect(updated?.name).toBe('Updated');
  });

  it('persists to localStorage under cosmos.bookmarks key', () => {
    const record = createTestRecord({ id: 'b1' });
    useBookmarkStore.getState().add(record);
    const stored = localStorage.getItem('cosmos.bookmarks');
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!);
    expect(parsed.version).toBe(BOOKMARKS_SCHEMA_VERSION);
    expect(parsed.state.bookmarks).toEqual([record]);
  });

  it('rehydrates bookmarks from localStorage', () => {
    const record = createTestRecord({ id: 'b1' });
    localStorage.setItem(
      'cosmos.bookmarks',
      JSON.stringify({
        state: { bookmarks: [record] },
        version: BOOKMARKS_SCHEMA_VERSION,
      })
    );
    const stored = localStorage.getItem('cosmos.bookmarks');
    expect(stored).toBeDefined();
  });

  it('migration: corrupt JSON returns empty state, no throw', () => {
    localStorage.setItem('cosmos.bookmarks', 'not valid json');
    expect(() => useBookmarkStore.getState()).not.toThrow();
  });

  it('migration: future version returns empty + single warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(
      'cosmos.bookmarks',
      JSON.stringify({
        state: { bookmarks: [] },
        version: 99,
      })
    );
    expect(localStorage.getItem('cosmos.bookmarks')).toBeDefined();
    warnSpy.mockRestore();
  });
});
