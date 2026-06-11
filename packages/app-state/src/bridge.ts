import type { EventBus } from '@cosmos/core-types';
import { useSelectionStore } from './selection';

/**
 * Mirror store → bus: emits 'selection/changed' on every selectedId change
 * (deduplicated — same id twice emits once). Returns an unsubscribe function.
 */
export function bindSelectionToBus(bus: EventBus): () => void {
  let lastId = useSelectionStore.getState().selectedId;

  return useSelectionStore.subscribe((state) => {
    if (state.selectedId !== lastId) {
      lastId = state.selectedId;
      bus.emit('selection/changed', { id: state.selectedId });
    }
  });
}
