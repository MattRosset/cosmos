import { type JSX } from 'react';
import { TimeControls } from './TimeControls';
import { Icon } from './Icon';
import { STRINGS } from './strings';
import type { DockProps } from './types';

/**
 * Unified bottom control bar: time controls in one glass pill, plus icon
 * triggers for the search palette and bookmarks panel (which the app opens via
 * the HUD store). The inner groups shed their own positioning/chrome when
 * inside `.cosmos-ui-dock` (see ui.css) — the dock provides the surface; the
 * groups are just inline segments. The exposure slider moved to the View
 * drawer (TASK-068 V3).
 */
export function Dock({
  onSyncToNow,
  onOpenSearch,
  onOpenBookmarks,
  onOpenHelp,
}: DockProps): JSX.Element {
  return (
    <div className="cosmos-ui-dock" role="toolbar" aria-label="Controls">
      <TimeControls {...(onSyncToNow ? { onSyncToNow } : {})} />
      <span className="cosmos-ui-dock-sep" aria-hidden="true" />
      <button className="cosmos-ui-dock-btn" aria-label="Search" onClick={onOpenSearch}>
        <Icon name="search" />
      </button>
      <button
        className="cosmos-ui-dock-btn"
        aria-label="Open bookmarks"
        onClick={onOpenBookmarks}
      >
        <Icon name="bookmark" />
      </button>
      {onOpenHelp ? (
        <button
          className="cosmos-ui-dock-btn cosmos-ui-dock-help"
          aria-label={STRINGS.firstRunReopenLabel}
          onClick={onOpenHelp}
        >
          ?
        </button>
      ) : null}
    </div>
  );
}
