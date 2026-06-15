import { useMemo } from 'react';
import type { BodyId, BookmarkRecord } from '@cosmos/core-types';
import type { CombinedSource } from '@cosmos/data';
import { useHudStore } from '@cosmos/app-state';
import { InfoPanel, SearchPalette, BookmarksPanel, Dock } from '@cosmos/ui';
import type { BodyLookupAdapter } from '@cosmos/ui';

interface HudProps {
  readonly source: CombinedSource;
  /** System the camera is inside (null in galaxy) — drives the InfoPanel action label. */
  readonly currentSystemId: BodyId | null;
  /** Fly out of the current system back to the galaxy (InfoPanel "Exit system"). */
  onExitSystem(): void;
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
export function Hud({
  source,
  currentSystemId,
  onExitSystem,
  onGoTo,
  onSyncToNow,
  onCapture,
  onGoToBookmark,
}: HudProps) {
  const searchOpen = useHudStore((s) => s.searchOpen);
  const setSearchOpen = useHudStore((s) => s.setSearchOpen);
  const bookmarksOpen = useHudStore((s) => s.bookmarksOpen);
  const setBookmarksOpen = useHudStore((s) => s.setBookmarksOpen);

  const adapter = useMemo<BodyLookupAdapter>(
    () => ({
      getBody: (id) => source.getBody(id),
      search: (query, max) => source.search(query, max),
      // A star is "enterable" when it sits exactly on a system's host position.
      hostSystemIdFor: (id) => {
        const body = source.getBody(id);
        if (body === undefined || body.kind !== 'star') return null;
        const [x, y, z] = body.positionPc;
        const hit = source.nearestHostSystem(x, y, z);
        return hit !== null && hit.distancePc < 1e-6 ? hit.systemId : null;
      },
    }),
    [source],
  );

  return (
    <>
      <Dock
        onSyncToNow={onSyncToNow}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenBookmarks={() => setBookmarksOpen(true)}
      />
      <SearchPalette
        adapter={adapter}
        onGoTo={onGoTo}
        open={searchOpen}
        onOpenChange={setSearchOpen}
      />
      <InfoPanel
        adapter={adapter}
        onGoTo={onGoTo}
        currentSystemId={currentSystemId}
        onExitSystem={onExitSystem}
      />
      <BookmarksPanel
        adapter={adapter}
        onCapture={onCapture}
        onGoToBookmark={onGoToBookmark}
        onGoToBody={onGoTo}
        open={bookmarksOpen}
        onOpenChange={setBookmarksOpen}
      />
    </>
  );
}
