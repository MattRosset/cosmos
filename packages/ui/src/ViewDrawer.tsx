import { type JSX, useState } from 'react';
import { useOverlayStore } from '@cosmos/app-state';
import { ExposureControl } from './ExposureControl';
import { STRINGS } from './strings';

export interface ViewDrawerProps {
  /**
   * V2 auto-hide chrome preference. There is no store for it (it is app-local
   * idle state), so the drawer takes it as controlled props; the app persists it.
   */
  readonly autoHide: boolean;
  onAutoHideChange(autoHide: boolean): void;
}

/**
 * TASK-068 V3 — the unified View drawer: exposure (useSettingsStore via
 * ExposureControl), constellations/labels/cinematic (useOverlayStore), and the
 * app-controlled auto-hide preference, one surface replacing the previously
 * scattered OverlayControls + dock exposure mounts. Store-driven only — zero
 * per-frame work (§5.12).
 */
export function ViewDrawer({ autoHide, onAutoHideChange }: ViewDrawerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const constellations = useOverlayStore((s) => s.constellations);
  const labels = useOverlayStore((s) => s.labels);
  const cinematic = useOverlayStore((s) => s.cinematic);
  const setConstellations = useOverlayStore((s) => s.setConstellations);
  const setLabels = useOverlayStore((s) => s.setLabels);
  const setCinematic = useOverlayStore((s) => s.setCinematic);

  return (
    /* Sits above the cinematic letterbox bars (z-index 101 > 90) so the
     * Cinematic toggle is always reachable while the bars are in — otherwise
     * cinematic can't be exited (BUG-3, inherited from OverlayControls). */
    <div className="cosmos-ui-view">
      <button
        className="cosmos-ui-view-toggle"
        aria-label={STRINGS.viewDrawerLabel}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {STRINGS.viewDrawerTitle}
      </button>
      {open && (
        <div className="cosmos-ui-view-drawer" role="group" aria-label={STRINGS.viewDrawerLabel}>
          <ExposureControl />
          <div className="cosmos-ui-view-toggles">
            <button
              aria-pressed={constellations}
              onClick={() => setConstellations(!constellations)}
            >
              {STRINGS.viewConstellations}
            </button>
            <button aria-pressed={labels} onClick={() => setLabels(!labels)}>
              {STRINGS.viewLabels}
            </button>
            <button aria-pressed={cinematic} onClick={() => setCinematic(!cinematic)}>
              {STRINGS.viewCinematic}
            </button>
            <button aria-pressed={autoHide} onClick={() => onAutoHideChange(!autoHide)}>
              {STRINGS.viewAutoHide}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
