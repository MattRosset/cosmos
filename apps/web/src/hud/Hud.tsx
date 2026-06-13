import '@cosmos/ui/ui.css';
import { useMemo } from 'react';
import type { BodyId, BookmarkRecord } from '@cosmos/core-types';
import type { CombinedSource } from '@cosmos/data';
import { InfoPanel, SearchPalette, TimeControls, BookmarksPanel } from '@cosmos/ui';
import type { BodyLookupAdapter } from '@cosmos/ui';

interface HudProps {
  readonly source: CombinedSource;
  /** Select AND fly: wired to the goto coordinator in App. */
  onGoTo(id: BodyId): void;
  onSyncToNow(): void;
  onCapture(name: string): BookmarkRecord | null;
  onGoToBookmark(bookmark: BookmarkRecord): void;
}

/**
 * Search palette, info panel, time controls, and bookmarks against the combined
 * star + systems catalog. TimeControls/BookmarksPanel live OUTSIDE `<SceneHost>`
 * and must cause zero Canvas re-renders (§5.12) — they subscribe only to the
 * low-frequency app-state stores.
 */
export function Hud({ source, onGoTo, onSyncToNow, onCapture, onGoToBookmark }: HudProps) {
  const adapter = useMemo<BodyLookupAdapter>(
    () => ({
      getBody: (id) => source.getBody(id),
      search: (query, max) => source.search(query, max),
    }),
    [source],
  );

  return (
    <>
      <TimeControls onSyncToNow={onSyncToNow} />
      <SearchPalette adapter={adapter} onGoTo={onGoTo} />
      <InfoPanel adapter={adapter} onGoTo={onGoTo} />
      <BookmarksPanel
        adapter={adapter}
        onCapture={onCapture}
        onGoToBookmark={onGoToBookmark}
        onGoToBody={onGoTo}
      />
    </>
  );
}
