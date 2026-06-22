import { useEffect, useMemo, useState } from 'react';
import type { BodyId, BookmarkRecord } from '@cosmos/core-types';
import type { CombinedSource } from '@cosmos/data';
import { useHudStore, useOverlayStore } from '@cosmos/app-state';
import {
  InfoPanel,
  SearchPalette,
  BookmarksPanel,
  Dock,
  OverlayControls,
  LabelLayer,
  TourChrome,
  type ProjectedLabel,
} from '@cosmos/ui';
import type { BodyLookupAdapter } from '@cosmos/ui';
import { subscribeLabels } from '../glue/overlays';
import { controllerHolder } from '../glue/test-hook';

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
  /** Tour step advanced/finished — the app flies nav to the step (TASK-052). */
  onTourStepChange(stepIndex: number): void;
  /** Tour exited — the app cancels cinematic playback. */
  onTourExit(): void;
}

/**
 * Search palette, info panel, time controls, bookmarks, and the Phase-4a overlay /
 * tour chrome against the combined star + systems catalog. Everything here lives
 * OUTSIDE `<SceneHost>` and must cause zero Canvas re-renders (§5.12): the label
 * layer subscribes to the app's ≤ 10 Hz projection pub/sub, the overlay/tour chrome
 * to the app-state stores, and the letterbox polls the controller flag at low rate.
 */
export function Hud({
  source,
  currentSystemId,
  onExitSystem,
  onGoTo,
  onSyncToNow,
  onCapture,
  onGoToBookmark,
  onTourStepChange,
  onTourExit,
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
      <OverlayControls />
      <LabelLayerHost />
      <TourChrome onStepChange={onTourStepChange} onExit={onTourExit} />
      <Letterbox />
    </>
  );
}

/**
 * Renders `<LabelLayer>` from the app's ≤ 10 Hz screen-space projection. Subscribes to
 * the label pub/sub so only this small subtree re-renders on a label update — never
 * the Canvas (§5.12).
 */
function LabelLayerHost(): React.JSX.Element {
  const [labels, setLabels] = useState<readonly ProjectedLabel[]>([]);
  useEffect(() => subscribeLabels(setLabels), []);
  return <LabelLayer labels={labels} />;
}

/**
 * Cinematic letterbox bars. Shown while `useOverlayStore.cinematic` is on OR the
 * controller is playing a `letterbox` spline (`flight.letterboxActive`). The
 * controller flag flips only at cinematic start/stop, so a low-rate poll suffices;
 * no per-frame React work.
 */
function Letterbox(): React.JSX.Element {
  const cinematic = useOverlayStore((s) => s.cinematic);
  const [letterboxActive, setLetterboxActive] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setLetterboxActive(controllerHolder.current?.letterboxActive ?? false);
    }, 150);
    return () => clearInterval(id);
  }, []);
  const active = cinematic || letterboxActive;
  return (
    <div className={`hud-letterbox${active ? ' hud-letterbox--active' : ''}`} aria-hidden="true">
      <span className="hud-letterbox-bar hud-letterbox-bar--top" />
      <span className="hud-letterbox-bar hud-letterbox-bar--bottom" />
    </div>
  );
}
