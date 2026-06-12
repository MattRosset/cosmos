import { describe, expect, it } from 'vitest';
import {
  createSimClock,
  J2000_EPOCH_JD,
  UNIX_EPOCH_JD,
  MAX_TIME_ACCEL,
  MAX_DT_MS,
  unixMsToEpochJD,
  epochJDToUnixMs,
  type SimClockState,
} from '../src/index';

describe('createSimClock', () => {
  it('initializes with J2000 epoch by default', () => {
    const clock = createSimClock();
    expect(clock.epochJD).toBe(J2000_EPOCH_JD);
    expect(clock.accel).toBe(1);
    expect(clock.paused).toBe(false);
  });

  it('accepts custom initial epoch and accel', () => {
    const clock = createSimClock({
      initialEpochJD: 2451546.0,
      initialAccel: 2,
    });
    expect(clock.epochJD).toBe(2451546.0);
    expect(clock.accel).toBe(2);
  });
});

describe('advance()', () => {
  it('advances epoch by (dt * accel) / 86_400', () => {
    const clock = createSimClock();
    // Advance by 86_400_000 ms in chunks of MAX_DT_MS to reach 1 day
    const numFrames = 86_400_000 / MAX_DT_MS;
    for (let i = 0; i < numFrames; i++) {
      clock.advance(MAX_DT_MS);
    }
    expect(clock.epochJD).toBeCloseTo(J2000_EPOCH_JD + 1, 3);
  });

  it('respects time acceleration', () => {
    const clock = createSimClock({ initialAccel: 10 });
    // Advance by 86_400_000 ms in chunks of MAX_DT_MS to reach 10 days
    const numFrames = 86_400_000 / MAX_DT_MS;
    for (let i = 0; i < numFrames; i++) {
      clock.advance(MAX_DT_MS);
    }
    expect(clock.epochJD).toBeCloseTo(J2000_EPOCH_JD + 10, 3);
  });

  it('clamps dt to MAX_DT_MS', () => {
    const clock1 = createSimClock();
    const clock2 = createSimClock();

    clock1.advance(5000); // Should be clamped to 100 ms
    clock2.advance(100); // Should be exactly 100 ms

    expect(clock1.epochJD).toBe(clock2.epochJD);
  });

  it('treats negative dt as 0', () => {
    const clock = createSimClock();
    const before = clock.epochJD;
    clock.advance(-5);
    expect(clock.epochJD).toBe(before);
  });

  it('treats 0 dt as no-op', () => {
    const clock = createSimClock();
    const before = clock.epochJD;
    clock.advance(0);
    expect(clock.epochJD).toBe(before);
  });

  it('is no-op while paused', () => {
    const clock = createSimClock();
    clock.setPaused(true);
    const before = clock.epochJD;
    clock.advance(1000);
    expect(clock.epochJD).toBe(before);
  });

  it('does not fire onChange', () => {
    const clock = createSimClock();
    const changes: SimClockState[] = [];
    clock.onChange((state) => changes.push(state));
    clock.advance(1000);
    expect(changes).toHaveLength(0);
  });

  it('precision test: 1e6× accel for ~100 years < 1% relative error', () => {
    const clock = createSimClock({ initialAccel: 1e6 });
    const start = clock.epochJD;
    const frameDtMs = 16.667;
    // Wall-clock time needed to simulate 100 years at 1e6x: 3.15576e6 ms
    // Wall-clock frames needed
    const wallClockMsFor100Years = 100 * 365.25 * 86_400_000 / 1e6;
    const numFrames = Math.ceil(wallClockMsFor100Years / frameDtMs);

    let exactMs = 0;
    for (let i = 0; i < numFrames; i++) {
      clock.advance(frameDtMs);
      exactMs += frameDtMs;
    }

    // Reconstructed simulated elapsed milliseconds from JD difference
    const actualSimMs = (clock.epochJD - start) * 86_400_000;
    // Expected simulated ms: wall-clock time * acceleration
    const expectedSimMs = exactMs * 1e6;
    // Relative error should be very small (accumulated floating-point error)
    const relativeError = Math.abs(actualSimMs - expectedSimMs) / expectedSimMs;
    expect(relativeError).toBeLessThan(2e-10);
  });

  it('is allocation-free (does not trigger onChange)', () => {
    const clock = createSimClock();
    let changeCount = 0;
    clock.onChange(() => {
      changeCount += 1;
    });

    for (let i = 0; i < 1000; i++) {
      clock.advance(16.667);
    }

    expect(changeCount).toBe(0);
  });
});

describe('setAccel()', () => {
  it('changes acceleration', () => {
    const clock = createSimClock();
    clock.setAccel(100);
    expect(clock.accel).toBe(100);
  });

  it('clamps to MAX_TIME_ACCEL', () => {
    const clock = createSimClock();
    clock.setAccel(1e9);
    expect(clock.accel).toBe(MAX_TIME_ACCEL);
  });

  it('clamps negative accel to -MAX_TIME_ACCEL', () => {
    const clock = createSimClock();
    clock.setAccel(-1e9);
    expect(clock.accel).toBe(-MAX_TIME_ACCEL);
  });

  it('ignores non-finite values', () => {
    const clock = createSimClock({ initialAccel: 5 });
    clock.setAccel(NaN);
    expect(clock.accel).toBe(5);
    clock.setAccel(Infinity);
    expect(clock.accel).toBe(5);
    clock.setAccel(-Infinity);
    expect(clock.accel).toBe(5);
  });

  it('supports negative acceleration (time runs backward)', () => {
    const clock = createSimClock({ initialAccel: -1 });
    const before = clock.epochJD;
    // Advance by 86_400_000 ms in chunks of MAX_DT_MS to go back 1 day
    const numFrames = 86_400_000 / MAX_DT_MS;
    for (let i = 0; i < numFrames; i++) {
      clock.advance(MAX_DT_MS);
    }
    expect(clock.epochJD).toBeCloseTo(before - 1, 3);
  });

  it('fires onChange only when state changes', () => {
    const clock = createSimClock();
    const changes: number[] = [];
    clock.onChange((state) => changes.push(state.accel));

    clock.setAccel(5);
    expect(changes).toEqual([5]);

    clock.setAccel(5); // No change
    expect(changes).toEqual([5]);

    clock.setAccel(10);
    expect(changes).toEqual([5, 10]);
  });

  it('does not fire onChange for non-finite values', () => {
    const clock = createSimClock();
    const changes: SimClockState[] = [];
    clock.onChange((state) => changes.push(state));

    clock.setAccel(NaN);
    clock.setAccel(Infinity);

    expect(changes).toHaveLength(0);
  });
});

describe('setPaused()', () => {
  it('pauses time advancement', () => {
    const clock = createSimClock();
    clock.setPaused(true);
    const before = clock.epochJD;
    clock.advance(1000);
    expect(clock.epochJD).toBe(before);
  });

  it('resumes time advancement', () => {
    const clock = createSimClock();
    clock.setPaused(true);
    clock.setPaused(false);
    const before = clock.epochJD;
    // Advance by 86_400_000 ms in chunks of MAX_DT_MS to reach 1 day
    const numFrames = 86_400_000 / MAX_DT_MS;
    for (let i = 0; i < numFrames; i++) {
      clock.advance(MAX_DT_MS);
    }
    expect(clock.epochJD).toBeCloseTo(before + 1, 3);
  });

  it('is bit-exact: pause → advance → resume', () => {
    const clock = createSimClock({ initialEpochJD: 2451545.123456789 });
    const original = clock.epochJD;

    clock.setPaused(true);
    for (let i = 0; i < 1000; i++) {
      clock.advance(16.667);
    }
    clock.setPaused(false);

    expect(Object.is(clock.epochJD, original)).toBe(true);
  });

  it('fires onChange only when state changes', () => {
    const clock = createSimClock();
    const changes: boolean[] = [];
    clock.onChange((state) => changes.push(state.paused));

    clock.setPaused(true);
    expect(changes).toEqual([true]);

    clock.setPaused(true); // No change
    expect(changes).toEqual([true]);

    clock.setPaused(false);
    expect(changes).toEqual([true, false]);
  });
});

describe('setEpochJD()', () => {
  it('sets a new epoch', () => {
    const clock = createSimClock();
    clock.setEpochJD(2451546.0);
    expect(clock.epochJD).toBe(2451546.0);
  });

  it('ignores non-finite values', () => {
    const clock = createSimClock({ initialEpochJD: 2451545.0 });
    clock.setEpochJD(NaN);
    expect(clock.epochJD).toBe(2451545.0);
    clock.setEpochJD(Infinity);
    expect(clock.epochJD).toBe(2451545.0);
  });

  it('fires onChange only when state changes', () => {
    const clock = createSimClock();
    const changes: number[] = [];
    clock.onChange((state) => changes.push(state.epochJD));

    clock.setEpochJD(2451546.0);
    expect(changes).toEqual([2451546.0]);

    clock.setEpochJD(2451546.0); // No change
    expect(changes).toEqual([2451546.0]);

    clock.setEpochJD(2451547.0);
    expect(changes).toEqual([2451546.0, 2451547.0]);
  });

  it('does not fire onChange for non-finite values', () => {
    const clock = createSimClock();
    const changes: SimClockState[] = [];
    clock.onChange((state) => changes.push(state));

    clock.setEpochJD(NaN);
    clock.setEpochJD(Infinity);

    expect(changes).toHaveLength(0);
  });
});

describe('syncToNow()', () => {
  it('sets epoch to Unix timestamp', () => {
    const clock = createSimClock();
    const unixMs = 0; // 1970-01-01T00:00:00Z
    clock.syncToNow(unixMs);
    expect(clock.epochJD).toBe(UNIX_EPOCH_JD);
  });

  it('fires onChange', () => {
    const clock = createSimClock();
    const changes: number[] = [];
    clock.onChange((state) => changes.push(state.epochJD));

    clock.syncToNow(0);
    expect(changes).toEqual([UNIX_EPOCH_JD]);
  });

  it('deduplicates: syncToNow to same epoch fires once', () => {
    const clock = createSimClock({ initialEpochJD: UNIX_EPOCH_JD });
    const changes: SimClockState[] = [];
    clock.onChange((state) => changes.push(state));

    clock.syncToNow(0);
    expect(changes).toHaveLength(0);
  });
});

describe('onChange()', () => {
  it('returns an unsubscribe function', () => {
    const clock = createSimClock();
    const changes: SimClockState[] = [];
    const unsub = clock.onChange((state) => changes.push(state));

    clock.setAccel(5);
    expect(changes).toHaveLength(1);

    unsub();
    clock.setAccel(10);
    expect(changes).toHaveLength(1);
  });

  it('delivers fresh immutable snapshot', () => {
    const clock = createSimClock();
    const snapshots: SimClockState[] = [];
    clock.onChange((state) => snapshots.push(state));

    clock.setAccel(5);
    clock.setAccel(10);

    expect(snapshots[0]).toEqual({ epochJD: J2000_EPOCH_JD, accel: 5, paused: false });
    expect(snapshots[1]).toEqual({ epochJD: J2000_EPOCH_JD, accel: 10, paused: false });
  });

  it('throwing handler does not block later handlers', () => {
    const clock = createSimClock();
    const order: number[] = [];

    clock.onChange(() => {
      order.push(1);
      throw new Error('handler 1 failed');
    });
    clock.onChange(() => {
      order.push(2);
    });

    clock.setAccel(5);
    expect(order).toEqual([1, 2]);
  });

  it('multiple subscribers all fire', () => {
    const clock = createSimClock();
    const changes1: number[] = [];
    const changes2: number[] = [];

    clock.onChange((state) => changes1.push(state.accel));
    clock.onChange((state) => changes2.push(state.accel));

    clock.setAccel(5);
    expect(changes1).toEqual([5]);
    expect(changes2).toEqual([5]);
  });
});

describe('unixMsToEpochJD() / epochJDToUnixMs()', () => {
  it('round-trip: unixMs → JD → unixMs', () => {
    const testValues = [0, 1e12, new Date('2026-01-01T00:00:00Z').getTime()];

    for (const unixMs of testValues) {
      const jd = unixMsToEpochJD(unixMs);
      const back = epochJDToUnixMs(jd);
      // Allow for floating-point rounding errors (relative error is small)
      const relativeError = Math.abs(back - unixMs) / (Math.abs(unixMs) + 1);
      expect(relativeError).toBeLessThan(1e-12);
    }
  });

  it('unixMsToEpochJD(0) === UNIX_EPOCH_JD', () => {
    expect(unixMsToEpochJD(0)).toBe(UNIX_EPOCH_JD);
  });

  it('unixMsToEpochJD(UNIX_EPOCH_JD) is inverse of epochJDToUnixMs(0)', () => {
    const jd = unixMsToEpochJD(0);
    const unixMs = epochJDToUnixMs(jd);
    expect(unixMs).toBe(0);
  });
});

describe('constants', () => {
  it('J2000_EPOCH_JD is correct', () => {
    expect(J2000_EPOCH_JD).toBe(2451545.0);
  });

  it('UNIX_EPOCH_JD is correct', () => {
    expect(UNIX_EPOCH_JD).toBe(2440587.5);
  });

  it('MAX_TIME_ACCEL is 1e7', () => {
    expect(MAX_TIME_ACCEL).toBe(1e7);
  });

  it('MAX_DT_MS is 100', () => {
    expect(MAX_DT_MS).toBe(100);
  });
});
