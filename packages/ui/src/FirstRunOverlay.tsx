import { useEffect, type JSX } from 'react';
import { STRINGS } from './strings';
import type { FirstRunOverlayProps } from './types';

/**
 * First-run teaching overlay (TASK-066 V1). Shown once on first launch — its whole
 * job is to reveal that cosmos has THREE distinct movement modes (scale jump / free
 * flight / guided tour), the thesis of research §5.1. After dismissal it collapses to
 * a `?` in the dock (the host owns that button + the localStorage flag). Presentational
 * only: open/close and persistence are driven by props, never nav/three imports.
 */
export function FirstRunOverlay({ open, onDismiss }: FirstRunOverlayProps): JSX.Element | null {
  // Esc dismisses, matching the other modal-ish surfaces. Bound only while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onDismiss]);

  if (!open) return null;

  const modes: readonly { title: string; body: string }[] = [
    { title: STRINGS.firstRunJumpTitle, body: STRINGS.firstRunJumpBody },
    { title: STRINGS.firstRunExploreTitle, body: STRINGS.firstRunExploreBody },
    { title: STRINGS.firstRunTourTitle, body: STRINGS.firstRunTourBody },
  ];

  return (
    <div
      className="cosmos-ui-firstrun-backdrop"
      // A backdrop click dismisses; clicks inside the card must not bubble up to it.
      onClick={onDismiss}
    >
      <div
        className="cosmos-ui-firstrun"
        role="dialog"
        aria-modal="true"
        aria-label={STRINGS.firstRunTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="cosmos-ui-firstrun-title">{STRINGS.firstRunTitle}</h2>
        <ul className="cosmos-ui-firstrun-modes">
          {modes.map((m) => (
            <li key={m.title} className="cosmos-ui-firstrun-mode">
              <span className="cosmos-ui-firstrun-mode-title">{m.title}</span>
              <span className="cosmos-ui-firstrun-mode-body">{m.body}</span>
            </li>
          ))}
        </ul>
        <p className="cosmos-ui-firstrun-hint">{STRINGS.firstRunHint}</p>
        <button type="button" className="cosmos-ui-firstrun-dismiss" onClick={onDismiss}>
          {STRINGS.firstRunDismiss}
        </button>
      </div>
    </div>
  );
}
