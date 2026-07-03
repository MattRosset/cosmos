import { Fragment } from 'react';
import type { CombinedSource } from '@cosmos/data';
import { useSelectionStore } from '@cosmos/app-state';

/**
 * Persistent location breadcrumb: `Galaxy › <System> › <Body>`. Always visible
 * (stays in clean view) so the user knows where they are and can pop back up a
 * level. The "Galaxy" segment is the simple, discoverable exit while inside a
 * system; it mirrors the Esc key. Subscribes to the selection store directly so
 * it never re-renders the Canvas.
 */
export function Breadcrumb({
  systemName,
  combined,
  galaxyNavReady,
  onExit,
  onViewGalaxy,
  onEnterGalaxy,
}: {
  systemName: string | null;
  combined: CombinedSource;
  /** False while the procgen Milky Way worker is still loading (§5.8). */
  galaxyNavReady: boolean;
  onExit(): void;
  onViewGalaxy(): void;
  onEnterGalaxy(): void;
}): React.JSX.Element {
  const selectedId = useSelectionStore((s) => s.selectedId);
  const inSystem = systemName !== null;
  const selectedName =
    selectedId !== null ? combined.getBody(selectedId)?.name ?? selectedId : null;
  const bodyCrumb =
    selectedName !== null && selectedName !== systemName ? selectedName : null;

  const segs: ReadonlyArray<{
    key: string;
    label: string;
    onClick?: () => void;
    title?: string;
  }> = [
    {
      key: 'milkyway',
      label: 'Milky Way',
      onClick: onViewGalaxy,
      title: 'Fly out to see the whole Milky Way',
    },
    {
      key: 'galaxy',
      label: 'Galaxy',
      onClick: inSystem ? onExit : onEnterGalaxy,
      title: inSystem ? 'Exit to the galaxy (Esc)' : 'Descend into the Sol star field',
    },
    ...(inSystem ? [{ key: 'system', label: systemName }] : []),
    ...(bodyCrumb !== null ? [{ key: 'body', label: bodyCrumb }] : []),
  ];

  return (
    <nav className="hud-breadcrumb" aria-label="Location">
      {segs.map((seg, i) => (
        <Fragment key={seg.key}>
          {i > 0 ? (
            <span className="hud-breadcrumb-sep" aria-hidden="true">
              ›
            </span>
          ) : null}
          {seg.onClick ? (
            (() => {
              const scaleNav =
                !galaxyNavReady &&
                (seg.key === 'milkyway' || (seg.key === 'galaxy' && !inSystem));
              return (
            <button
              type="button"
              className="hud-breadcrumb-seg hud-breadcrumb-exit"
              disabled={scaleNav}
              onClick={scaleNav ? undefined : seg.onClick}
              title={
                scaleNav ? 'Preparing Milky Way view…' : (seg.title ?? '')
              }
            >
              ◂ {seg.label}
            </button>
              );
            })()
          ) : (
            <span
              className={`hud-breadcrumb-seg${
                i === segs.length - 1 ? ' hud-breadcrumb-current' : ''
              }`}
            >
              {seg.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
