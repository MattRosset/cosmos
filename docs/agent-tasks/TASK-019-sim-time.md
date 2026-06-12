# Task: `sim-time` v1 — epoch clock + time acceleration

**ID:** TASK-019
**Target package:** `packages/sim-time` (new)
**Size:** S
**Phase:** 2 — lane F (pure time)
**Depends on:** TASK-018

## Goal

The simulation clock (architecture §5.4): maintains the simulation epoch as a Julian
Date (f64), a signed time-acceleration factor (±1×…±10⁷×), pause, and explicit
"sync to now". Pure TypeScript — no DOM, no Three.js, no React, **no wall-clock
reads** (the caller passes `Date.now()` in; determinism doctrine §8.6). The glue
(TASK-029) advances it once per frame via scene-host's `epochProvider` (TASK-028)
and mirrors its state into `app-state`'s time store (TASK-025).

## Frozen Interface

```ts
// public API of @cosmos/sim-time
export const J2000_EPOCH_JD = 2451545.0;
/** JD of the Unix epoch 1970-01-01T00:00:00Z. */
export const UNIX_EPOCH_JD = 2440587.5;
export const MAX_TIME_ACCEL = 1e7;
/** Same clamp as scene-host's frame loop (§5.4 tab-switch protection). */
export const MAX_DT_MS = 100;

export function unixMsToEpochJD(unixMs: number): number; // UNIX_EPOCH_JD + ms/86_400_000
export function epochJDToUnixMs(epochJD: number): number; // inverse

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
   * onChange (per-frame events are banned, §5.12).
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

export function createSimClock(opts?: SimClockOptions): SimClock;
```

## Fixed semantics (transcribe, don't redesign)

- Advance law: `epochJD += (clampedDtMs / 1000) * accel / 86_400` — accumulate in
  Julian DAYS as f64, in one expression. Never accumulate in seconds-as-f32 and never
  keep a separate fractional accumulator (f64 JD already holds ~µs precision at
  epoch ≈ 2.45e6).
- Pause/resume is bit-exact: pausing, advancing any number of times, and resuming
  leaves `epochJD` the identical f64 bit pattern.
- `onChange` payload is a fresh immutable snapshot; handlers that throw must not
  prevent later handlers (same doctrine as `createEventBus`).

## Inputs / Outputs

- **Inputs:** e.g. `createSimClock()` → `epochJD === 2451545.0`. `setAccel(1e6)`,
  then 60 frames of `advance(16.667)` → epoch advanced by
  `(60 × 16.667/1000 × 1e6)/86400 ≈ 11.574` days.
- **Outputs:** `epochJD` consumed per frame by scene-host's `FrameContext`;
  `onChange` snapshots consumed by the `app-state` time store glue.

## Constraints & Forbidden Actions

- Dependencies: `@cosmos/core-types` ONLY (§4: `sim-time` imports only core-types) —
  and nothing from it is actually needed; keep the import list empty if so.
- No `Date.now()`, `performance.now()`, timers, or `Math.random()` anywhere in `src/`.
- No classes; factory + closure like `createEventBus`/`createPrng`.
- `advance` is on the frame path: zero allocations, no event emission.
- Do not modify any other package (scene-host wiring is TASK-028, store is TASK-025).

## Common Mistakes (architecture §5.4 — copy kept verbatim)

- Accumulating epoch in seconds-as-f32 (precision loss within hours).
- Coupling time stepping to frame rate without clamping dt (tab-switch returns cause
  orbit teleports — clamp dt to 100 ms).
- Plus: emitting change events from `advance` (HUD would re-render every frame,
  §5.12); reading the wall clock inside the package (breaks determinism and tests).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/sim-time test` — `test/clock.test.ts`:
   - **Precision (§5.4 gate):** at `accel = 1e6`, advance simulated frames
     (16.667 ms each) until ≥ 100 simulated years have passed; reconstruct elapsed
     simulated milliseconds from `epochJD − start` and compare against the exact sum
     — error < 1 ms total.
   - **Bit-exact pause:** pause → 1000 × `advance(16.667)` → resume: `epochJD`
     strictly unchanged (`Object.is` equality).
   - dt clamp: `advance(5000)` advances exactly as `advance(100)` would.
   - `advance(0)` and negative dt (`advance(-5)` → treated as 0) leave epoch unchanged.
   - Accel clamp: `setAccel(1e9)` → `1e7`; `setAccel(-1e9)` → `-1e7`;
     `setAccel(NaN)` / `setAccel(Infinity)` ignored (state unchanged, no onChange).
   - Negative accel runs time backward (epoch decreases).
   - `onChange`: fires once per actual change with the new snapshot; NOT fired by
     `advance`; deduplicated (`setPaused(true)` twice → one event); unsubscribe works;
     a throwing handler doesn't block the next one.
   - Round-trip: `epochJDToUnixMs(unixMsToEpochJD(x)) === x` for
     x ∈ {0, 1e12, Date.UTC(2026, 0, 1)}; `unixMsToEpochJD(0) === 2440587.5`.
   - `advance` allocation-free (same-identity scratch check pattern from `nav` tests).
2. **Coverage gate:** statement coverage ≥ 90% on `src` (§13: pure packages, high
   coverage).
3. `pnpm verify` exits 0 (boundary lint: no DOM/Three/React imports).

## Deliverables

- `packages/sim-time/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/sim-time/src/clock.ts`, `src/jd.ts` (conversion helpers), `src/index.ts`
- `packages/sim-time/test/clock.test.ts`
- `packages/sim-time/README.md` (< 150 lines)

## Context Files

- `docs/architecture.md` §5.4 (whole section), §8.6 (determinism doctrine)
- `packages/core-types/src/events.ts` (`createEventBus` — error-isolation style)
- `packages/scene-host/src/frame-loop.ts` (the J2000 stub + MAX_DT_MS this replaces
  via TASK-028 — constants must agree)
