import type { Tour } from '@cosmos/core-types';
import { afterEach, describe, expect, it } from 'vitest';
import { useTourStore } from '../src/tour-store';

const tour: Tour = {
  id: 't1',
  name: 'Inner planets',
  steps: [
    { targetId: 'mercury', title: 'Mercury', narration: '...', dwellMs: 1000 },
    { targetId: 'venus', title: 'Venus', narration: '...', dwellMs: 1000 },
    { targetId: 'earth', title: 'Earth', narration: '...', dwellMs: 1000 },
  ],
};

afterEach(() => {
  useTourStore.setState({ active: null, stepIndex: -1, playing: false });
});

describe('useTourStore', () => {
  it('starts with no active tour', () => {
    const state = useTourStore.getState();
    expect(state.active).toBeNull();
    expect(state.stepIndex).toBe(-1);
    expect(state.playing).toBe(false);
  });

  it('start sets active, stepIndex 0, playing true', () => {
    useTourStore.getState().start(tour);
    const state = useTourStore.getState();
    expect(state.active).toBe(tour);
    expect(state.stepIndex).toBe(0);
    expect(state.playing).toBe(true);
  });

  it('next advances stepIndex', () => {
    useTourStore.getState().start(tour);
    useTourStore.getState().next();
    expect(useTourStore.getState().stepIndex).toBe(1);
  });

  it('next clamps at the last step', () => {
    useTourStore.getState().start(tour);
    useTourStore.getState().next();
    useTourStore.getState().next();
    useTourStore.getState().next();
    useTourStore.getState().next();
    expect(useTourStore.getState().stepIndex).toBe(2);
  });

  it('prev clamps at 0', () => {
    useTourStore.getState().start(tour);
    useTourStore.getState().prev();
    useTourStore.getState().prev();
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it('setPlaying pauses and resumes', () => {
    useTourStore.getState().start(tour);
    useTourStore.getState().setPlaying(false);
    expect(useTourStore.getState().playing).toBe(false);
    useTourStore.getState().setPlaying(true);
    expect(useTourStore.getState().playing).toBe(true);
  });

  it('stop resets to no active tour', () => {
    useTourStore.getState().start(tour);
    useTourStore.getState().next();
    useTourStore.getState().stop();
    const state = useTourStore.getState();
    expect(state.active).toBeNull();
    expect(state.stepIndex).toBe(-1);
    expect(state.playing).toBe(false);
  });

  it('next is a no-op when no tour is active', () => {
    useTourStore.getState().next();
    expect(useTourStore.getState().stepIndex).toBe(-1);
  });
});
