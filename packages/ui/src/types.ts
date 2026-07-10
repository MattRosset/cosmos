import type { BodyId, BodyRecord, BookmarkRecord } from '@cosmos/core-types';

/** Injected by the app. Adapter type widened in TASK-026 to cover all body kinds. */
export interface BodyLookupAdapter {
  getBody(id: BodyId): BodyRecord | undefined;
  search(query: string, max?: number): BodyRecord[];
  /**
   * If `id` is a star that hosts a planetary system, its system id (so the panel
   * can offer "Enter system"); null otherwise. Optional — absent ⇒ never offered.
   */
  hostSystemIdFor?(id: BodyId): BodyId | null;
}

export interface SearchPaletteProps {
  readonly adapter: BodyLookupAdapter;
  /** Called on Enter/click of a result: the app selects AND flies to it. */
  onGoTo(id: BodyId): void;
  /** Controlled open state. Omit for self-managed (Ctrl+K / "/") behavior. */
  readonly open?: boolean;
  /** Notified when the palette wants to open/close (required for controlled use). */
  readonly onOpenChange?: (open: boolean) => void;
}

export interface InfoPanelProps {
  readonly adapter: BodyLookupAdapter;
  onGoTo(id: BodyId): void;
  /** System the camera is currently inside, or null in the galaxy context. Lets
   *  the panel swap a host's action between "Enter system" and "Exit system". */
  readonly currentSystemId?: BodyId | null;
  /** Fly back out to the galaxy. Used by the host's "Exit system" action. */
  readonly onExitSystem?: () => void;
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
  /** Controlled open state. Omit for self-managed (built-in toggle button). */
  readonly open?: boolean;
  /** Notified on open/close. When provided, the built-in toggle button is
   *  suppressed (the host — e.g. the dock — owns the trigger). */
  readonly onOpenChange?: (open: boolean) => void;
}

export interface DockProps {
  /** Optional "sync to now" handler, forwarded to the time controls. */
  readonly onSyncToNow?: () => void;
  /** Open the search palette. */
  readonly onOpenSearch: () => void;
  /** Open the bookmarks panel. */
  readonly onOpenBookmarks: () => void;
  /** Re-open the first-run movement guide (TASK-066 V1). Omit ⇒ no `?` button. */
  readonly onOpenHelp?: () => void;
}

export interface FirstRunOverlayProps {
  /** Whether the teaching overlay is visible. */
  readonly open: boolean;
  /** Dismiss (button / backdrop / Esc). The host persists the seen flag. */
  readonly onDismiss: () => void;
}

/** A body label already projected to screen space by the app (ui never sees
 *  the camera). */
export interface ProjectedLabel {
  readonly id: string;
  readonly text: string;
  /** Screen-space pixel position (the app computed it from the camera). */
  readonly xPx: number;
  readonly yPx: number;
  /** Lower = more important; the layer shows the most important that fit. */
  readonly priority: number;
  /** false ⇒ behind the camera / off-screen; the layer skips it. */
  readonly visible: boolean;
}

export interface LabelLayerProps {
  /** Recomputed by the app at ≤ ~10 Hz (NOT per frame, §5.12) and passed in. */
  readonly labels: readonly ProjectedLabel[];
  /** Max labels rendered (de-cluttering); default 24. */
  readonly maxVisible?: number;
}

export interface TourChromeProps {
  /** Called when the user advances/finishes so the app can fly nav to the step. */
  onStepChange(stepIndex: number): void;
  /** Called on exit so the app can stop cinematic playback. */
  onExit(): void;
}
