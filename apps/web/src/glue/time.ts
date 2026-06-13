import { createSimClock, type SimClock } from '@cosmos/sim-time';
import { createEventBus, type EventBus } from '@cosmos/core-types';
import { useTimeStore } from '@cosmos/app-state';
import type { EpochProvider } from '@cosmos/scene-host';
import { controllerHolder, mirrorControllerState, testHook } from './test-hook';

/**
 * Module-scoped simulation clock (TASK-029 fixed wiring). One instance for the
 * whole app; the SceneHost frame loop drives it through {@link epochProvider}.
 */
export const clock: SimClock = createSimClock();

/** App-wide typed event bus (selection/changed, time/changed). */
export const bus: EventBus = createEventBus();

/**
 * Stable epoch provider handed to SceneHost: advances the clock with the clamped
 * wall delta and returns the new epoch for `FrameContext.epochJD`. Referentially
 * stable so changing it never remounts the Canvas (§5.1).
 */
export const epochProvider: EpochProvider = (dtMs) => {
  clock.advance(dtMs);
  return clock.epochJD;
};

let installed = false;

/**
 * Wire the time store ⇄ clock (plain module, not React — never per-frame):
 *  - `useTimeStore` paused/accel → `clock.setPaused` / `clock.setAccel`
 *  - `clock.onChange` → `useTimeStore.syncEpochJD` + bus `time/changed`
 *  - a 250 ms timer mirrors `clock.epochJD` into `syncEpochJD` while unpaused
 *    (the ≤ 4 Hz display throttle) and mirrors low-frequency controller state
 *    into the test hook.
 *
 * Idempotent: only the first call installs. The store↔clock loop terminates
 * because the clock deduplicates `onChange` (unchanged accel/paused is a no-op).
 */
export function installTimeGlue(): void {
  if (installed) return;
  installed = true;

  const applyStoreToClock = (s: { paused: boolean; accel: number }): void => {
    clock.setPaused(s.paused);
    clock.setAccel(s.accel);
  };
  applyStoreToClock(useTimeStore.getState());
  useTimeStore.subscribe(applyStoreToClock);

  clock.onChange((state) => {
    useTimeStore.getState().syncEpochJD(state.epochJD);
    testHook.epochJD = state.epochJD;
    bus.emit('time/changed', state);
  });

  setInterval(() => {
    if (!useTimeStore.getState().paused) {
      useTimeStore.getState().syncEpochJD(clock.epochJD);
    }
    testHook.epochJD = clock.epochJD;
    if (controllerHolder.current) mirrorControllerState();
  }, 250);
}

/** "Sync to now" button handler — jump the clock to the current wall instant. */
export function syncClockToNow(): void {
  clock.syncToNow(Date.now());
}
