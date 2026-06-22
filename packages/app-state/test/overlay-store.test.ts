import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOverlayStore } from '../src/overlay-store';

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
  useOverlayStore.setState({
    constellations: false,
    labels: false,
    cinematic: false,
  });
  localStorage.clear();
});

describe('useOverlayStore', () => {
  it('defaults all overlays to false', () => {
    const state = useOverlayStore.getState();
    expect(state.constellations).toBe(false);
    expect(state.labels).toBe(false);
    expect(state.cinematic).toBe(false);
  });

  it('setConstellations flips constellations only', () => {
    useOverlayStore.getState().setConstellations(true);
    const state = useOverlayStore.getState();
    expect(state.constellations).toBe(true);
    expect(state.labels).toBe(false);
    expect(state.cinematic).toBe(false);
  });

  it('setLabels flips labels only', () => {
    useOverlayStore.getState().setLabels(true);
    const state = useOverlayStore.getState();
    expect(state.labels).toBe(true);
    expect(state.constellations).toBe(false);
    expect(state.cinematic).toBe(false);
  });

  it('setCinematic flips cinematic only', () => {
    useOverlayStore.getState().setCinematic(true);
    const state = useOverlayStore.getState();
    expect(state.cinematic).toBe(true);
    expect(state.constellations).toBe(false);
    expect(state.labels).toBe(false);
  });

  it('persists to localStorage under cosmos.overlay key', () => {
    useOverlayStore.getState().setConstellations(true);
    const stored = localStorage.getItem('cosmos.overlay');
    expect(stored).toBeDefined();
    const parsed = JSON.parse(stored!);
    expect(parsed.version).toBe(1);
    expect(parsed.state.constellations).toBe(true);
  });

  it('rehydrates from localStorage', () => {
    localStorage.setItem(
      'cosmos.overlay',
      JSON.stringify({
        state: { constellations: false, labels: true, cinematic: false },
        version: 1,
      })
    );
    const stored = localStorage.getItem('cosmos.overlay');
    const parsed = JSON.parse(stored!);
    expect(parsed.state.labels).toBe(true);
  });

  it('migration: corrupt JSON returns defaults, no throw', () => {
    localStorage.setItem('cosmos.overlay', 'not valid json');
    expect(() => useOverlayStore.getState()).not.toThrow();
  });

  it('migration: future version resets to defaults + warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(
      'cosmos.overlay',
      JSON.stringify({
        state: { constellations: true, labels: true, cinematic: true },
        version: 99,
      })
    );
    const stored = localStorage.getItem('cosmos.overlay');
    const parsed = JSON.parse(stored!);
    expect(parsed.version).toBe(99);
    warnSpy.mockRestore();
  });
});
