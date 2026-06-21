# Task: `nav` v5 — cinematic camera mode (spline playback, auto-orbit, letterbox)

**ID:** TASK-051
**Target package:** `packages/nav`
**Size:** S/M
**Phase:** 4 — lane (nav); additive v5 of `nav`
**Depends on:** TASK-042

## Goal

Add **cinematic camera mode** to the flight controller (architecture §5.3 "cinematic
camera mode (spline paths, letterbox, auto-orbit)"): play back a `CameraSpline`
(Catmull-Rom through `CameraKeyframe`s), an **auto-orbit-a-body** sub-mode, and expose a
letterbox flag for the chrome. Playback obeys the same discipline as `goTo`: pausable,
cancels on user input, and **survives context switches** (keyframes are `UniversePosition`s
so the path animates in the correct frame, §5.3). Additive — the v1–v4 API (`goTo`,
context switching, `generateLocalGroup`, etc.) is unchanged.

## Frozen Interface

Additive members on the existing flight controller (mirror the `goTo` family):

```ts
import type { CameraSpline } from '@cosmos/core-types';

export interface FlightController {
  // ... all existing v1–v4 members unchanged ...

  /** Start cinematic spline playback. Behaves like goTo: damped, cancels on input. */
  playSpline(spline: CameraSpline, opts?: { onEnd?(completed: boolean): void }): void;
  /** Auto-orbit the given world point at a fixed radius/rate (the §5.3 sub-mode). */
  orbitBody(opts: { center: UniversePosition; radiusM: number; ratePerSec?: number }): void;
  pauseCinematic(): void;   // freeze playback (resumable)
  resumeCinematic(): void;
  cancelCinematic(): void;  // stop, return to free flight (like cancelGoTo)
  readonly cinematicActive: boolean;
  /** True while a spline with `letterbox` is playing (the chrome reads this). */
  readonly letterboxActive: boolean;
}
```

## Behavior spec (fixed — mirror the existing goTo motion discipline)

- **Spline playback:** interpolate camera position + look-at along the `CameraSpline`
  keyframes with **Catmull-Rom** (uniform/centripetal — pick centripetal to avoid
  cusps; document it), parameterized by each keyframe's `timeMs`. Orientation slews to the
  interpolated look-at (quaternion-only, no Euler — the existing rule). Positions are
  `UniversePosition`s: interpolate **in the active context's frame**; if a keyframe is in
  a different context, convert via the same mechanism `goTo` uses for cross-context targets
  (animate in the target frame, §5.3) — do not interpolate raw locals across a context
  boundary.
- **Auto-orbit:** circle `center` at `radiusM` (converted to context units) at
  `ratePerSec` (default a slow, cinematic rate, e.g. `0.1 rad/s`), camera always facing
  `center`. Used during a tour's dwell when `TourStep.orbit` is set (TASK-050/052).
- **Cancellation:** any WASD/RF key or pointer drag beyond the existing 2 px deadzone
  cancels cinematic playback and resumes free flight that same frame — identical to
  `goTo`'s cancel path (reuse it).
- **Pause/resume:** `pauseCinematic` freezes the path clock; `resumeCinematic` continues
  from the same parameter. A tour's pause (TASK-049 store) drives these.
- **Rebase/context safety:** like `goTo`, an in-flight cinematic survives a
  `RebaseEvent` and a galaxy⇄system / universe⇄galaxy switch unchanged (orientation
  untouched by a switch; the existing guarantees).
- **Zero allocation** in the per-frame `update()` cinematic path (scratch module-scoped) —
  the existing `update()` zero-alloc test must still pass.

## Inputs / Outputs

- **Inputs:** a `CameraSpline` (the app's tour/cinematic definitions); an `orbitBody`
  request; user input (cancels).
- **Outputs:** camera position/orientation each frame; `cinematicActive`/`letterboxActive`
  flags the app/`ui` read; the `onEnd` callback on completion/cancel.

## Constraints & Forbidden Actions

- **Additive only.** Do not change `goTo`, `cancelGoTo`, `onGoToEnd`, context switching,
  `setSystemAnchor`/`setGalaxyAnchor`, `generateLocalGroup`, or the input map. Existing
  `nav` tests pass unmodified.
- Mutates the camera only — never touches scene content (the existing boundary).
- Quaternion-only orientation (no Euler accumulation / gimbal lock — §5.3).
- No allocations in `update()` (the §9 / §15 frame-loop rule; the existing test enforces).
- No Three.js in the core controller (pure math + DOM); the `useFlightController` hook is
  the only file touching the R3F camera (the existing split). No new dependencies.

## Common Mistakes (architecture §5.3 — copy kept verbatim where it applies)

- Go-to / cinematic animations in absolute coordinates breaking across context switches —
  animate in the target's frame (interpolate per-context; convert at boundaries).
- Gimbal lock from Euler accumulation — quaternion-only orientation.
- Linear/teleporting spline at scale boundaries — interpolate in-frame and slew
  orientation; do not lerp raw cross-context locals.
- Allocating in the frame loop — scratch vectors/quaternions module-scoped.
- Forgetting the input-cancel path — cinematic must yield to the user instantly like
  `goTo` (reuse the deadzone cancel).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/nav test` — new `test/cinematic.test.ts`:
   - `playSpline` with a 3-keyframe spline: after each `timeMs`, the camera position is
     within tolerance of the keyframe; midway it lies on the Catmull-Rom curve (not a
     straight lerp — assert curvature); `cinematicActive` true during, false after;
     `onEnd(true)` fires once at the end.
   - **Cancel on input:** a simulated WASD key/drag mid-playback cancels (`onEnd(false)`,
     `cinematicActive===false`, free flight resumes) — reuse the `goTo` cancel test
     harness.
   - **Pause/resume:** `pauseCinematic` freezes position across `update()`s;
     `resumeCinematic` continues from the same parameter.
   - **orbitBody:** the camera circles `center` at ~`radiusM` (converted) facing it; rate
     matches `ratePerSec`.
   - **Letterbox flag:** a spline with `letterbox:true` sets `letterboxActive` during
     playback, false after.
   - **Context/rebase safety:** an in-flight spline survives a simulated `RebaseEvent`
     and a context switch (reuse the existing rebase-transparency harness); `update()`
     stays zero-allocation (existing test).
   - **Existing `nav` tests pass unmodified.**
2. `pnpm verify` exits 0 (boundary lint unchanged; coverage ≥ existing threshold).

## Deliverables

- `packages/nav/src/cinematic.ts` (spline playback + auto-orbit state machine), wired
  into the existing controller's `update()`; `src/index.ts` (additive exports if any)
- `packages/nav/test/cinematic.test.ts`
- `packages/nav/README.md` (a "Cinematic mode (v5)" section)

## Context Files

- `packages/core-types/src/cinematic.ts` (`CameraSpline`, `CameraKeyframe` — TASK-042),
  `src/coords.ts` (`UniversePosition`)
- `packages/nav/README.md` + `src/` (the `goTo` motion law, cancel-on-input deadzone,
  quaternion slew, rebase transparency, context-switch survival, and the zero-alloc
  `update()` — all the patterns to reuse), `test/` (the goTo + rebase + zero-alloc test
  harnesses to extend)
- `docs/architecture.md` §5.3 (cinematic camera mode + common mistakes + validation)
