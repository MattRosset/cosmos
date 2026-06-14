# @cosmos/sim-time

Simulation clock: maintains epoch as Julian Date (f64), time acceleration, pause/resume, and "now" sync.

## Overview

Pure TypeScript module with **zero wall-clock reads**. The caller (scene-host frame loop) provides wall-clock delta in milliseconds; the clock advances the Julian Date epoch, respects time acceleration, and emits change events.

## API

```ts
const clock = createSimClock({
  initialEpochJD: J2000_EPOCH_JD,    // default
  initialAccel: 1,                     // 1× speed
});

// Per-frame advance (called once per render frame)
clock.advance(dtMs);  // No event fired; clamped to [0, 100] ms

// Time control
clock.setAccel(1e6);     // Speed up by 1 million (clamped to ±1e7)
clock.setPaused(true);   // Pause time
clock.setEpochJD(newJD); // Jump to a new epoch
clock.syncToNow(Date.now()); // Set epoch to current wall time

// Change notifications (never fire from advance())
clock.onChange((state) => {
  console.log(`epoch=${state.epochJD}, accel=${state.accel}, paused=${state.paused}`);
});
```

## Key Properties

- **Precision:** Accumulates in Julian Days as f64 with Kahan-compensated summation in `advance()`, keeping `epochJD` correctly rounded to ~1 ulp (~microseconds). Verified by the §5.4 gate: < 1 ms total error over a simulated century at 1e6×. (Naive f64 accumulation drifts ~316 ms here, because a ~0.19-day per-frame increment loses its low bits against the ~2.45e6 absolute JD magnitude; the compensation term carries those bits forward.)
- **Pause/Resume:** Bit-exact — pausing, advancing any number of times, and resuming leaves `epochJD` unchanged.
- **Frame path (advance):** Zero allocations, no events, no I/O.
- **Time control:** All via `setAccel`, `setPaused`, `setEpochJD`, `syncToNow`, which fire `onChange` only if state actually changes.

## Constants

- `J2000_EPOCH_JD = 2451545.0` — J2000 epoch (standard astronomical epoch)
- `UNIX_EPOCH_JD = 2440587.5` — Unix epoch (1970-01-01)
- `MAX_TIME_ACCEL = 1e7` — Maximum time acceleration factor
- `MAX_DT_MS = 100` — Maximum dt clamp per frame (prevents orbit teleports on tab-switch)

## Conversion Helpers

```ts
unixMsToEpochJD(ms)   // Convert Unix milliseconds to Julian Date
epochJDToUnixMs(jd)   // Convert Julian Date to Unix milliseconds
```

## Integration

- **Input:** Scene-host calls `clock.advance(dtMs)` once per frame.
- **Output:** `clock.epochJD` read by frame-loop subscribers; `onChange` snapshots consumed by app-state time store glue.

## References

- Architecture §5.4: Simulation clock design and semantics
- Architecture §8.6: Determinism doctrine (no wall-clock reads in the package)
