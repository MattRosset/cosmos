import { create } from 'zustand';

/**
 * HUD chrome visibility. "Clean view" collapses every non-essential overlay so
 * only the persistent layer (crosshair + breadcrumb) remains — the scene gets
 * the full frame. Low-frequency store: toggled by a keypress or a dock button,
 * never per-frame, so it must cause zero Canvas re-renders (§5.12).
 */
export interface HudState {
  /** When true, collapsible chrome (panels, dock, readouts) is hidden. */
  readonly cleanView: boolean;
  setCleanView(clean: boolean): void;
  toggleCleanView(): void;
  /** Search palette open (dock button + Ctrl+K / "/" both drive this in the app). */
  readonly searchOpen: boolean;
  setSearchOpen(open: boolean): void;
  /** Bookmarks panel open (dock button drives this in the app). */
  readonly bookmarksOpen: boolean;
  setBookmarksOpen(open: boolean): void;
}

export const useHudStore = create<HudState>()((set) => ({
  cleanView: false,
  setCleanView: (cleanView) => set({ cleanView }),
  toggleCleanView: () => set((s) => ({ cleanView: !s.cleanView })),
  searchOpen: false,
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  bookmarksOpen: false,
  setBookmarksOpen: (bookmarksOpen) => set({ bookmarksOpen }),
}));
