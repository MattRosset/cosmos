import type { BodyId } from '@cosmos/core-types';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createSafeStorage, migrateHistory } from './persist-util';

export interface HistoryEntry {
  readonly id: BodyId;
  readonly visitedAtIso: string;
}

export interface HistoryState {
  readonly entries: readonly HistoryEntry[];
  push(id: BodyId, visitedAtIso: string): void;
  clear(): void;
}

const MAX_HISTORY = 50;

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      entries: [],
      push: (id, visitedAtIso) =>
        set((state) => {
          // Consecutive dedupe: no-op if entries[0].id === id.
          if (
            state.entries.length > 0 &&
            state.entries[0] &&
            state.entries[0].id === id
          ) {
            return state;
          }
          const updated = [
            { id, visitedAtIso },
            ...state.entries,
          ].slice(0, MAX_HISTORY);
          return { entries: updated };
        }),
      clear: () => set({ entries: [] }),
    }),
    {
      name: 'cosmos.history',
      version: 1,
      storage: createJSONStorage(() => createSafeStorage()),
      migrate: (persisted, version) => ({
        entries: migrateHistory(persisted, version),
      }),
    }
  )
);
