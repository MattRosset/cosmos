import { create } from 'zustand';

export interface SettingsState {
  /** Star-field exposure multiplier, [0.1, 10]. Default 1. */
  readonly exposure: number;
  setExposure(exposure: number): void;
}

const EXPOSURE_MIN = 0.1;
const EXPOSURE_MAX = 10;

export const useSettingsStore = create<SettingsState>()((set) => ({
  exposure: 1,
  setExposure: (exposure) =>
    set({ exposure: Math.min(EXPOSURE_MAX, Math.max(EXPOSURE_MIN, exposure)) }),
}));
