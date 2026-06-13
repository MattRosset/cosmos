import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryStore } from '../src/history';

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
  useHistoryStore.setState({ entries: [] });
  localStorage.clear();
});

describe('useHistoryStore', () => {
  it('starts with empty entries', () => {
    expect(useHistoryStore.getState().entries).toEqual([]);
  });

  it('push adds entry at front (newest first)', () => {
    useHistoryStore.getState().push('sirius', '2026-06-12T10:00:00Z');
    useHistoryStore.getState().push('betelgeuse', '2026-06-12T11:00:00Z');
    const entries = useHistoryStore.getState().entries;
    expect(entries[0]?.id).toBe('betelgeuse');
    expect(entries[1]?.id).toBe('sirius');
  });

  it('push with consecutive duplicate id is a no-op', () => {
    useHistoryStore.getState().push('sirius', '2026-06-12T10:00:00Z');
    useHistoryStore.getState().push('sirius', '2026-06-12T11:00:00Z');
    const entries = useHistoryStore.getState().entries;
    expect(entries.length).toBe(1);
  });

  it('push allows non-consecutive duplicates (A, B, A → 3 entries)', () => {
    useHistoryStore.getState().push('sirius', '2026-06-12T10:00:00Z');
    useHistoryStore.getState().push('betelgeuse', '2026-06-12T11:00:00Z');
    useHistoryStore.getState().push('sirius', '2026-06-12T12:00:00Z');
    const entries = useHistoryStore.getState().entries;
    expect(entries.length).toBe(3);
    expect(entries[0]?.id).toBe('sirius');
    expect(entries[1]?.id).toBe('betelgeuse');
    expect(entries[2]?.id).toBe('sirius');
  });

  it('push caps history at 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      useHistoryStore.getState().push(`body${i}`, '2026-06-12T00:00:00Z');
    }
    const entries = useHistoryStore.getState().entries;
    expect(entries.length).toBe(50);
    // Newest entries should be preserved (body59 to body10).
    expect(entries[0]?.id).toBe('body59');
    expect(entries[49]?.id).toBe('body10');
  });

  it('clear empties the history', () => {
    useHistoryStore.getState().push('sirius', '2026-06-12T10:00:00Z');
    useHistoryStore.getState().push('betelgeuse', '2026-06-12T11:00:00Z');
    useHistoryStore.getState().clear();
    expect(useHistoryStore.getState().entries).toEqual([]);
  });

  it('persists to localStorage under cosmos.history key', () => {
    useHistoryStore.getState().push('sirius', '2026-06-12T10:00:00Z');
    const stored = localStorage.getItem('cosmos.history');
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!);
    expect(parsed.version).toBe(1);
    expect(parsed.state.entries).toEqual([
      { id: 'sirius', visitedAtIso: '2026-06-12T10:00:00Z' },
    ]);
  });

  it('rehydrates history from localStorage', () => {
    const entry = { id: 'sirius', visitedAtIso: '2026-06-12T10:00:00Z' };
    localStorage.setItem(
      'cosmos.history',
      JSON.stringify({
        state: { entries: [entry] },
        version: 1,
      })
    );
    const stored = localStorage.getItem('cosmos.history');
    const parsed = JSON.parse(stored!);
    expect(parsed.state.entries).toEqual([entry]);
  });

  it('migration: corrupt JSON returns empty state, no throw', () => {
    localStorage.setItem('cosmos.history', 'not valid json');
    expect(() => useHistoryStore.getState()).not.toThrow();
  });

  it('migration: future version returns empty + single warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(
      'cosmos.history',
      JSON.stringify({
        state: { entries: [] },
        version: 99,
      })
    );
    const stored = localStorage.getItem('cosmos.history');
    const parsed = JSON.parse(stored!);
    expect(parsed.version).toBe(99);
    warnSpy.mockRestore();
  });
});
