import { createEventBus } from '@cosmos/core-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindSelectionToBus } from '../src/bridge';
import { useSelectionStore } from '../src/selection';

afterEach(() => {
  useSelectionStore.setState({ selectedId: null });
});

describe('bindSelectionToBus', () => {
  it('emits selection/changed with correct payload on change', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('selection/changed', handler);

    const unsub = bindSelectionToBus(bus);
    useSelectionStore.getState().select('hyg:32263');

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ id: 'hyg:32263' });
    unsub();
  });

  it('deduplicates: same id twice emits once', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('selection/changed', handler);

    const unsub = bindSelectionToBus(bus);
    useSelectionStore.getState().select('hyg:32263');
    useSelectionStore.getState().select('hyg:32263');

    expect(handler).toHaveBeenCalledOnce();
    unsub();
  });

  it('unsubscribe stops emission', () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('selection/changed', handler);

    const unsub = bindSelectionToBus(bus);
    unsub();
    useSelectionStore.getState().select('hyg:99999');

    expect(handler).not.toHaveBeenCalled();
  });

  it('works against real createEventBus', () => {
    const bus = createEventBus();
    const received: Array<{ id: string | null }> = [];
    bus.on('selection/changed', (payload) => received.push(payload));

    const unsub = bindSelectionToBus(bus);
    useSelectionStore.getState().select('hyg:1');
    useSelectionStore.getState().select(null);
    unsub();

    expect(received).toEqual([{ id: 'hyg:1' }, { id: null }]);
  });
});
