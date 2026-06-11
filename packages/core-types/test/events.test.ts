import { describe, expect, it } from 'vitest';
import { createEventBus } from '../src/events';
import type { CosmosEventMap } from '../src/events';

describe('createEventBus', () => {
  it('on/emit round-trip delivers payload to subscriber', () => {
    const bus = createEventBus();
    const received: CosmosEventMap['coords/contextChanged'][] = [];

    bus.on('coords/contextChanged', (payload) => {
      received.push(payload);
    });

    const payload = { from: 'universe' as const, to: 'galaxy' as const };
    bus.emit('coords/contextChanged', payload);

    expect(received).toEqual([payload]);
  });

  it('unsubscribe stops delivery', () => {
    const bus = createEventBus();
    let count = 0;

    const unsub = bus.on('selection/changed', () => {
      count += 1;
    });

    bus.emit('selection/changed', { id: 'hyg:1' });
    unsub();
    bus.emit('selection/changed', { id: 'hyg:2' });

    expect(count).toBe(1);
  });

  it('a throwing handler does not block later handlers', () => {
    const bus = createEventBus();
    const order: number[] = [];

    bus.on('time/changed', () => {
      order.push(1);
      throw new Error('handler 1 failed');
    });
    bus.on('time/changed', () => {
      order.push(2);
    });

    bus.emit('time/changed', { epochJD: 2451545.0, accel: 1, paused: false });

    expect(order).toEqual([1, 2]);
  });

  it('enforces payload types at compile time', () => {
    const bus = createEventBus();

    bus.on('coords/rebased', (payload) => {
      expect(payload.context).toBe('system');
      expect(payload.offsetUnits).toEqual([1, 2, 3]);
    });

    bus.emit('coords/rebased', {
      context: 'system',
      offsetUnits: [1, 2, 3],
    });

    // @ts-expect-error wrong context literal
    bus.emit('coords/rebased', { context: 'solar', offsetUnits: [0, 0, 0] });

    // @ts-expect-error missing required field
    bus.emit('coords/contextChanged', { from: 'universe' });

    // @ts-expect-error wrong payload shape for event
    bus.emit('selection/changed', { target: 'galaxy' });

    // @ts-expect-error event name typo
    bus.on('nav/contextSwitch', () => {});

    // @ts-expect-error handler payload mismatch
    bus.on('time/changed', (payload: { epochJD: string }) => {
      void payload;
    });
  });
});
