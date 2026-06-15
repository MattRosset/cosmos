import { afterEach, describe, expect, it } from 'vitest';
import { useHudStore } from '../src/hud';

afterEach(() => {
  useHudStore.setState({ cleanView: false, searchOpen: false, bookmarksOpen: false });
});

describe('useHudStore', () => {
  it('starts with all chrome shown and panels closed', () => {
    const s = useHudStore.getState();
    expect(s.cleanView).toBe(false);
    expect(s.searchOpen).toBe(false);
    expect(s.bookmarksOpen).toBe(false);
  });

  it('setCleanView round-trips', () => {
    useHudStore.getState().setCleanView(true);
    expect(useHudStore.getState().cleanView).toBe(true);
  });

  it('toggleCleanView flips the flag', () => {
    useHudStore.getState().toggleCleanView();
    expect(useHudStore.getState().cleanView).toBe(true);
    useHudStore.getState().toggleCleanView();
    expect(useHudStore.getState().cleanView).toBe(false);
  });

  it('setSearchOpen round-trips', () => {
    useHudStore.getState().setSearchOpen(true);
    expect(useHudStore.getState().searchOpen).toBe(true);
    useHudStore.getState().setSearchOpen(false);
    expect(useHudStore.getState().searchOpen).toBe(false);
  });

  it('setBookmarksOpen round-trips', () => {
    useHudStore.getState().setBookmarksOpen(true);
    expect(useHudStore.getState().bookmarksOpen).toBe(true);
    useHudStore.getState().setBookmarksOpen(false);
    expect(useHudStore.getState().bookmarksOpen).toBe(false);
  });
});
