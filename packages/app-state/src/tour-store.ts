import type { Tour } from '@cosmos/core-types';
import { create } from 'zustand';

export interface TourState {
  readonly active: Tour | null;
  readonly stepIndex: number;
  readonly playing: boolean;
  start(tour: Tour): void;
  next(): void;
  prev(): void;
  setPlaying(playing: boolean): void;
  stop(): void;
}

export const useTourStore = create<TourState>()((set) => ({
  active: null,
  stepIndex: -1,
  playing: false,
  start: (tour) => set({ active: tour, stepIndex: 0, playing: true }),
  next: () =>
    set((state) => {
      if (!state.active) return state;
      const lastIndex = state.active.steps.length - 1;
      return { stepIndex: Math.min(state.stepIndex + 1, lastIndex) };
    }),
  prev: () =>
    set((state) => ({ stepIndex: Math.max(state.stepIndex - 1, 0) })),
  setPlaying: (playing) => set({ playing }),
  stop: () => set({ active: null, stepIndex: -1, playing: false }),
}));
