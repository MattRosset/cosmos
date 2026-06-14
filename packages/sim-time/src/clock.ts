import { unixMsToEpochJD } from './jd';

export const J2000_EPOCH_JD = 2451545.0;
export const MAX_TIME_ACCEL = 1e7;
/** Same clamp as scene-host's frame loop (tab-switch protection). */
export const MAX_DT_MS = 100;

export interface SimClockState {
  readonly epochJD: number;
  /** Signed; |accel| ≤ MAX_TIME_ACCEL. 0 is legal (frozen time ≠ paused). */
  readonly accel: number;
  readonly paused: boolean;
}

export interface SimClockOptions {
  /** Default J2000_EPOCH_JD. */
  readonly initialEpochJD?: number;
  /** Default 1. */
  readonly initialAccel?: number;
}

export interface SimClock extends SimClockState {
  /**
   * Advance by a wall-clock delta. dtMs is clamped to [0, MAX_DT_MS] internally.
   * No-op while paused. Called once per frame by the glue — MUST NOT fire
   * onChange (per-frame events are banned).
   */
  advance(dtMs: number): void;
  /** Clamped to [−MAX_TIME_ACCEL, MAX_TIME_ACCEL]; non-finite input is ignored. */
  setAccel(accel: number): void;
  setPaused(paused: boolean): void;
  /** Jump (bookmark restore). Non-finite input is ignored. */
  setEpochJD(epochJD: number): void;
  /** Set epoch to the given wall-clock instant ("now" button). */
  syncToNow(nowUnixMs: number): void;
  /**
   * Fires on setAccel / setPaused / setEpochJD / syncToNow that actually changed
   * state (deduplicated) — NEVER on advance. Returns an unsubscribe function.
   */
  onChange(cb: (state: SimClockState) => void): () => void;
}

export function createSimClock(opts?: SimClockOptions): SimClock {
  let epochJD = opts?.initialEpochJD ?? J2000_EPOCH_JD;
  let accel = opts?.initialAccel ?? 1;
  let paused = false;
  // Kahan/Neumaier compensation term for advance(): carries the low-order bits
  // lost when a small per-frame increment (~0.19 days at 1e6×) is added to a
  // large absolute JD (~2.45e6). Naive accumulation drifts ~316 ms over a
  // simulated century at 1e6×; compensated summation keeps epochJD correctly
  // rounded to ~1 ulp (~7.5 µs), satisfying the §5.4 millisecond-precision gate.
  // Reset to 0 on every absolute jump (setEpochJD / syncToNow).
  let comp = 0;

  const listeners = new Set<(state: SimClockState) => void>();

  function getCurrentState(): SimClockState {
    return { epochJD, accel, paused };
  }

  function emitChange(): void {
    const state = getCurrentState();
    for (const handler of listeners) {
      try {
        handler(state);
      } catch {
        // A throwing handler must not prevent later handlers.
      }
    }
  }

  return {
    get epochJD() {
      return epochJD;
    },
    get accel() {
      return accel;
    },
    get paused() {
      return paused;
    },

    advance(dtMs: number): void {
      if (paused) return;
      const clampedDtMs = Math.max(0, Math.min(dtMs, MAX_DT_MS));
      // Increment in Julian days as f64 (§5.4 advance law), added with Kahan
      // compensation so the low bits aren't rounded away frame-to-frame.
      const inc = (clampedDtMs / 1000) * accel / 86_400;
      const y = inc - comp;
      const t = epochJD + y;
      comp = t - epochJD - y;
      epochJD = t;
    },

    setAccel(newAccel: number): void {
      if (!Number.isFinite(newAccel)) return;
      const clamped = Math.max(-MAX_TIME_ACCEL, Math.min(newAccel, MAX_TIME_ACCEL));
      if (clamped !== accel) {
        accel = clamped;
        emitChange();
      }
    },

    setPaused(newPaused: boolean): void {
      if (newPaused !== paused) {
        paused = newPaused;
        emitChange();
      }
    },

    setEpochJD(newEpochJD: number): void {
      if (!Number.isFinite(newEpochJD)) return;
      if (newEpochJD !== epochJD) {
        epochJD = newEpochJD;
        comp = 0; // discard stale compensation: this is an absolute jump
        emitChange();
      }
    },

    syncToNow(nowUnixMs: number): void {
      const newEpochJD = unixMsToEpochJD(nowUnixMs);
      if (newEpochJD !== epochJD) {
        epochJD = newEpochJD;
        comp = 0; // discard stale compensation: this is an absolute jump
        emitChange();
      }
    },

    onChange(cb: (state: SimClockState) => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

// Re-export conversion helpers for public API
export { epochJDToUnixMs, unixMsToEpochJD, UNIX_EPOCH_JD } from './jd';
