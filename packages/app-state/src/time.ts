import { create } from 'zustand';

export const ACCEL_STEPS = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7] as const;
const MAX_ACCEL = 1e7;

export interface TimeState {
  readonly paused: boolean;
  readonly accel: number;
  readonly epochJD: number;
  setPaused(paused: boolean): void;
  setAccel(accel: number): void;
  syncEpochJD(epochJD: number): void;
}

export const useTimeStore = create<TimeState>()((set) => ({
  paused: false,
  accel: 1,
  epochJD: 2451545.0, // J2000
  setPaused: (paused) => set({ paused }),
  setAccel: (accel) => {
    if (!Number.isFinite(accel)) return;
    const clamped = Math.max(-MAX_ACCEL, Math.min(MAX_ACCEL, accel));
    set({ accel: clamped });
  },
  syncEpochJD: (epochJD) => set({ epochJD }),
}));
