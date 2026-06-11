import type { BodyId } from '@cosmos/core-types';
import { create } from 'zustand';

export interface SelectionState {
  readonly selectedId: BodyId | null;
  select(id: BodyId | null): void;
}

export const useSelectionStore = create<SelectionState>()((set) => ({
  selectedId: null,
  select: (id) => set({ selectedId: id }),
}));
