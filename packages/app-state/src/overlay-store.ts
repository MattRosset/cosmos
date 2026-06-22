import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createSafeStorage, migrateOverlay } from './persist-util';

export interface OverlayState {
  readonly constellations: boolean;
  readonly labels: boolean;
  readonly cinematic: boolean;
  setConstellations(on: boolean): void;
  setLabels(on: boolean): void;
  setCinematic(on: boolean): void;
}

export const useOverlayStore = create<OverlayState>()(
  persist(
    (set) => ({
      constellations: false,
      labels: false,
      cinematic: false,
      setConstellations: (on) => set({ constellations: on }),
      setLabels: (on) => set({ labels: on }),
      setCinematic: (on) => set({ cinematic: on }),
    }),
    {
      name: 'cosmos.overlay',
      version: 1,
      storage: createJSONStorage(() => createSafeStorage()),
      migrate: (persisted, version) => migrateOverlay(persisted, version),
    }
  )
);
