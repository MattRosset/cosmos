import { afterEach, describe, expect, it } from 'vitest';
import { useTimeStore, ACCEL_STEPS } from '../src/time';

afterEach(() => {
  useTimeStore.setState({
    paused: false,
    accel: 1,
    epochJD: 2451545.0,
  });
});

describe('useTimeStore', () => {
  it('starts with paused=false, accel=1, epochJD=J2000', () => {
    const state = useTimeStore.getState();
    expect(state.paused).toBe(false);
    expect(state.accel).toBe(1);
    expect(state.epochJD).toBe(2451545.0);
  });

  it('setPaused toggles pause state', () => {
    useTimeStore.getState().setPaused(true);
    expect(useTimeStore.getState().paused).toBe(true);
    useTimeStore.getState().setPaused(false);
    expect(useTimeStore.getState().paused).toBe(false);
  });

  it('setAccel clamps positive to +1e7', () => {
    useTimeStore.getState().setAccel(1e8);
    expect(useTimeStore.getState().accel).toBe(1e7);
  });

  it('setAccel clamps negative to -1e7', () => {
    useTimeStore.getState().setAccel(-1e8);
    expect(useTimeStore.getState().accel).toBe(-1e7);
  });

  it('setAccel ignores NaN', () => {
    useTimeStore.getState().setAccel(1);
    useTimeStore.getState().setAccel(NaN);
    expect(useTimeStore.getState().accel).toBe(1);
  });

  it('setAccel ignores Infinity', () => {
    useTimeStore.getState().setAccel(1);
    useTimeStore.getState().setAccel(Infinity);
    expect(useTimeStore.getState().accel).toBe(1);
  });

  it('setAccel ignores -Infinity', () => {
    useTimeStore.getState().setAccel(1);
    useTimeStore.getState().setAccel(-Infinity);
    expect(useTimeStore.getState().accel).toBe(1);
  });

  it('setAccel accepts valid values', () => {
    useTimeStore.getState().setAccel(100);
    expect(useTimeStore.getState().accel).toBe(100);
    useTimeStore.getState().setAccel(-500);
    expect(useTimeStore.getState().accel).toBe(-500);
  });

  it('ACCEL_STEPS is exact array', () => {
    expect(ACCEL_STEPS).toEqual([1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7]);
  });

  it('syncEpochJD updates epochJD without touching paused/accel', () => {
    useTimeStore.getState().setPaused(true);
    useTimeStore.getState().setAccel(1000);
    useTimeStore.getState().syncEpochJD(2451550.5);

    const state = useTimeStore.getState();
    expect(state.epochJD).toBe(2451550.5);
    expect(state.paused).toBe(true);
    expect(state.accel).toBe(1000);
  });
});
