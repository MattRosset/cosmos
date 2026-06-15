import { create } from 'zustand';

export interface SettingsState {
  /** Star-field exposure multiplier, [EXPOSURE_MIN, EXPOSURE_MAX]. Default 25. */
  readonly exposure: number;
  setExposure(exposure: number): void;
}

/**
 * Exposure bounds. The default (25) reveals most of the HYG catalog so the local
 * field reads as a rich night sky rather than a handful of naked-eye stars; the
 * ceiling (200) shows essentially the whole catalog (down to ~mag 10). The UI
 * slider maps logarithmically across this range.
 */
export const EXPOSURE_MIN = 0.1;
export const EXPOSURE_MAX = 200;
export const EXPOSURE_DEFAULT = 25;

export const useSettingsStore = create<SettingsState>()((set) => ({
  exposure: EXPOSURE_DEFAULT,
  setExposure: (exposure) =>
    set({ exposure: Math.min(EXPOSURE_MAX, Math.max(EXPOSURE_MIN, exposure)) }),
}));
