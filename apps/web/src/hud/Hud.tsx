import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BodyId, BookmarkRecord, StarSystemRecord } from '@cosmos/core-types';
import type { CombinedSource } from '@cosmos/data';
import { useHudStore, useOverlayStore } from '@cosmos/app-state';
import {
  InfoPanel,
  SearchPalette,
  BookmarksPanel,
  Dock,
  FirstRunOverlay,
  OverlayControls,
  TourChrome,
} from '@cosmos/ui';
import type { BodyLookupAdapter } from '@cosmos/ui';
import { liveLabels, subscribeLabelSet, type LiveLabel } from '../glue/overlays';
import { controllerHolder } from '../glue/test-hook';
import { jumpLetterboxHolder } from './JumpHudHost';

interface HudProps {
  readonly source: CombinedSource;
  /** Resolve a system record (Sol/exo packs) — feeds the C3 planet-count badge. */
  getSystem(systemId: BodyId): StarSystemRecord | undefined;
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
  getSystem,
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

  const { firstRunOpen, openHelp, dismissFirstRun } = useFirstRun();

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
      // TASK-068 C3: `bodies` is planets AND moons flat, so count only direct
      // children of the host star — otherwise Sol reads "10 known planets".
      planetCountFor: (systemId) => {
        const system = getSystem(systemId);
        if (system === undefined) return null;
        let count = 0;
        for (const b of system.bodies) if (b.parentId === system.star.id) count++;
        return count;
      },
    }),
    [source, getSystem],
  );

  return (
    <>
      <Dock
        onSyncToNow={onSyncToNow}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenBookmarks={() => setBookmarksOpen(true)}
        onOpenHelp={openHelp}
      />
      <FirstRunOverlay open={firstRunOpen} onDismiss={dismissFirstRun} />
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
 * First-run teaching overlay state (TASK-066 V1). The overlay auto-opens on the very
 * first launch (no localStorage flag), teaching the three movement modes; dismissing
 * persists the flag so it never auto-shows again. The dock's `?` re-opens it any time
 * WITHOUT touching the flag. localStorage access is guarded so a private-mode / disabled
 * storage never breaks the HUD (worst case: the overlay just re-shows each load).
 */
const FIRST_RUN_KEY = 'cosmos.firstrun.v1';

function useFirstRun(): {
  firstRunOpen: boolean;
  openHelp: () => void;
  dismissFirstRun: () => void;
} {
  const [firstRunOpen, setFirstRunOpen] = useState(false);
  useEffect(() => {
    let seen: boolean;
    try {
      seen = window.localStorage.getItem(FIRST_RUN_KEY) !== null;
    } catch {
      seen = false;
    }
    if (!seen) setFirstRunOpen(true);
  }, []);
  const openHelp = useCallback(() => setFirstRunOpen(true), []);
  const dismissFirstRun = useCallback(() => {
    setFirstRunOpen(false);
    try {
      window.localStorage.setItem(FIRST_RUN_KEY, '1');
    } catch {
      /* storage unavailable — overlay simply re-shows next load */
    }
  }, []);
  return { firstRunOpen, openHelp, dismissFirstRun };
}

/** Max labels shown at once (de-clutter); the buffer is pre-sorted by priority. */
const LABEL_MAX_VISIBLE = 24;

/**
 * Imperative screen-space label host (BUG-5 fix). React only ever renders the SET of
 * label nodes — a rare event driven by `subscribeLabelSet` (overlay load / Labels toggle).
 * A per-frame rAF loop (the `SpeedReadout` pattern) reads the shared live-label buffer and
 * writes each node's pixel position + visibility imperatively, so labels track the camera
 * at full frame rate with zero React renders (and never re-render the Canvas, §5.12). The
 * old host pushed 10 Hz-projected pixels through React state, so labels froze between
 * updates and swam relative to their targets while the camera moved.
 */
function LabelLayerHost(): React.JSX.Element {
  const [membership, setMembership] = useState<readonly LiveLabel[]>([]);
  useEffect(() => subscribeLabelSet(setMembership), []);

  const elements = useRef(new Map<string, HTMLSpanElement>());
  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      const buf = liveLabels();
      let shown = 0;
      for (let i = 0; i < buf.length; i++) {
        const ll = buf[i]!;
        const el = elements.current.get(ll.id);
        if (!el) continue;
        if (ll.visible && shown < LABEL_MAX_VISIBLE) {
          el.style.visibility = 'visible';
          el.style.left = `${ll.xPx}px`;
          el.style.top = `${ll.yPx}px`;
          shown++;
        } else {
          el.style.visibility = 'hidden';
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="cosmos-ui-labels" aria-hidden="true" style={{ pointerEvents: 'none' }}>
      {membership.map((ll) => (
        <span
          key={ll.id}
          ref={(el) => {
            if (el) elements.current.set(ll.id, el);
            else elements.current.delete(ll.id);
          }}
          className="cosmos-ui-label"
          style={{ visibility: 'hidden' }}
        >
          {ll.text}
        </span>
      ))}
    </div>
  );
}

/**
 * Cinematic letterbox bars. Shown while `useOverlayStore.cinematic` is on, the
 * controller is playing a `letterbox` spline (`flight.letterboxActive`), OR a
 * large scale jump wants framing (TASK-067 D4, `jumpLetterboxHolder`). All three
 * flags flip only at start/stop events, so a low-rate poll suffices; no
 * per-frame React work.
 */
function Letterbox(): React.JSX.Element {
  const cinematic = useOverlayStore((s) => s.cinematic);
  const [letterboxActive, setLetterboxActive] = useState(false);
  const [jumpLetterbox, setJumpLetterbox] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setLetterboxActive(controllerHolder.current?.letterboxActive ?? false);
      setJumpLetterbox(jumpLetterboxHolder.current);
    }, 150);
    return () => clearInterval(id);
  }, []);
  const active = cinematic || letterboxActive || jumpLetterbox;
  return (
    <div className={`hud-letterbox${active ? ' hud-letterbox--active' : ''}`} aria-hidden="true">
      <span className="hud-letterbox-bar hud-letterbox-bar--top" />
      <span className="hud-letterbox-bar hud-letterbox-bar--bottom" />
    </div>
  );
}
