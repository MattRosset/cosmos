import type { BodyId, BodyRecord, BookmarkRecord } from '@cosmos/core-types';

/** Injected by the app. Adapter type widened in TASK-026 to cover all body kinds. */
export interface BodyLookupAdapter {
  getBody(id: BodyId): BodyRecord | undefined;
  search(query: string, max?: number): BodyRecord[];
}

export interface SearchPaletteProps {
  readonly adapter: BodyLookupAdapter;
  /** Called on Enter/click of a result: the app selects AND flies to it. */
  onGoTo(id: BodyId): void;
}

export interface InfoPanelProps {
  readonly adapter: BodyLookupAdapter;
  onGoTo(id: BodyId): void;
}

export interface TimeControlsProps {
  /** Optional: "sync to now" button handler. Hidden when absent. */
  readonly onSyncToNow?: () => void;
}

export interface BookmarksPanelProps {
  /** Returns a complete BookmarkRecord for the current view, or null when
   *  capture is impossible. The panel adds it to useBookmarkStore. */
  readonly onCapture: (name: string) => BookmarkRecord | null;
  readonly onGoToBookmark: (bookmark: BookmarkRecord) => void;
  /** History tab row click. */
  readonly onGoToBody: (id: BodyId) => void;
  readonly adapter: BodyLookupAdapter;
}
