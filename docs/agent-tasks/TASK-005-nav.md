# Task: `nav` v1 — free flight with log-scaled speed

**ID:** TASK-005
**Target package:** `packages/nav` (new) + `apps/web` (consumer changes only)
**Size:** M
**Phase:** 0
**Depends on:** TASK-004

## Goal

A custom flight controller replaces the placeholder `OrbitControls`: WASD + mouse-look
free flight where speed is proportional to distance-to-nearest-surface, position is
tracked in f64 `UniversePosition` (never raw Three.js camera position), orientation is
quaternion-only, and rebases from `coords` are applied transparently. After this task a
user can fly from "inside a starfield" out to where it is a dot, smoothly, with no
precision artifacts.

v1 scope ONLY: free flight. No go-to-target animation, no orbit mode, no picking, no
context auto-switching (those are Phase 1–2 tasks).

## Frozen Interface

```ts
// public API of @cosmos/nav
import type { UniversePosition } from '@cosmos/core-types';
import type { OriginManager, RebaseEvent } from '@cosmos/coords';

export interface FlightState {
  /** Camera position, f64, in the OriginManager's current context. */
  readonly position: UniversePosition;
  /** Orientation quaternion [x, y, z, w]. Euler accumulation is banned (§5.3). */
  readonly orientation: readonly [number, number, number, number];
  /** Current speed, context units/second (for the debug HUD). */
  readonly speedUnitsPerS: number;
}

export interface FlightControllerOptions {
  readonly origin: OriginManager;
  readonly initial: Pick<FlightState, 'position' | 'orientation'>;
  /** speed = clamp(speedScale × distanceToNearestSurface, min, max) — §5.3. */
  readonly speedScale?: number;        // default 1.0 /s
  readonly minSpeedUnitsPerS?: number; // default 1e-7
  readonly maxSpeedUnitsPerS?: number; // default 1e7
  /** Exponential damping half-life for velocity, ms. Default 90. */
  readonly dampingHalfLifeMs?: number;
}

export interface FlightController {
  readonly state: FlightState;
  /** Bind pointer/keyboard listeners. Returns a dispose function. */
  attach(el: HTMLElement): () => void;
  /** Fed per frame by the host (Phase 0: debug scene supplies it; later: streaming). */
  setDistanceToNearestSurface(units: number): void;
  /**
   * Advance one frame: integrate input → velocity → position (f64), call
   * origin.setCameraPosition, and apply any returned RebaseEvent to internal state.
   * Must run at PRIORITY_NAV in the scene-host frame loop.
   */
  update(dtMs: number): void;
  /** Exposed for tests; update() calls this internally on rebase. */
  applyRebase(event: RebaseEvent): void;
}

export function createFlightController(opts: FlightControllerOptions): FlightController;

/** React glue for apps/web: creates the controller, subscribes at PRIORITY_NAV,
 *  copies state into the R3F camera each frame (the ONLY place that touches camera). */
export function useFlightController(
  opts: Omit<FlightControllerOptions, 'origin'> & { origin: OriginManager },
): FlightController;
```

Input mapping v1 (fixed): `W/A/S/D` translate, `R/F` up/down, pointer-drag to look
(pointer lock optional), `Shift` ×10 speed, `Ctrl` ×0.1 speed. Touch: deferred, leave a
TODO referencing §5.3.

## Inputs / Outputs

- **Inputs:** DOM events; distance-to-nearest-surface scalar (e.g. `400` while inside
  the placeholder starfield sphere).
- **Outputs:** `FlightState` per frame; camera mutation via the hook; rebase-corrected
  positions. Example: at `distanceToNearestSurface = 1e4` units and default scale,
  holding `W` for 1 s moves ≈ 1e4 units (damped ramp ⇒ slightly less).

## Constraints & Forbidden Actions

- Do not modify `core-types`, `coords`, or `scene-host` (their APIs are frozen).
- Do NOT use `OrbitControls` or drei controls as the base (§5.3 — they cannot do
  scale-adaptive flight). Delete the `OrbitControls` usage from `apps/web`.
- Core controller (`createFlightController`) must be Three.js-free and React-free
  (pure math + DOM events) so it is unit-testable; only the `useFlightController` hook
  file may import React/R3F/Three.
- Position math in f64 via `UniversePosition` — never read position back from the
  Three.js camera object.
- No allocations in `update()` (scratch quaternion/vector arrays module-scoped).
- Allowed dependencies: `@cosmos/core-types`, `@cosmos/coords`, `@cosmos/scene-host`,
  `react`, `@react-three/fiber`, `three` (hook file only).

## Common Mistakes (architecture §5.3 — copy kept verbatim)

- Linear zoom speed (unusable across 10²⁶ range) — speed must scale with proximity.
- Gimbal lock from Euler accumulation — quaternion-only orientation.
- Go-to animations in absolute coordinates breaking across context switches — animate
  in *target's* frame. (v1 has no go-to — keep it that way.)
- No input deadzone/touch handling considered too late. (Deadzone for pointer drag:
  2 px before look engages.)

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/nav test` — unit tests against a real `OriginManager`:
   - Speed law: speed after long `W` hold ≈ `clamp(speedScale × d, min, max)` for
     d ∈ {1e-3, 1, 1e4, 1e12} (relative error < 1%).
   - Quaternion stays normalized (|q| − 1 < 1e-9) after 10k random look inputs
     (seeded PRNG); pitch beyond ±90° is clamped (no flip).
   - Rebase transparency: fly past `REBASE_THRESHOLD_UNITS`; `state.position`
     (converted to meters) is continuous across the rebase (< 1e-6 m jump), and
     velocity direction is preserved.
   - `attach()` dispose removes all listeners (no input effect after dispose).
   - `update()` allocation-free (same-identity scratch check, as in TASK-003).
2. `apps/web`: `OrbitControls` import gone; HUD hint text updated to the new controls.
3. `pnpm verify` exits 0.
4. Manual smoke (note in PR): fly through the starfield and out until it shrinks to a
   point — no stutter, no snapping, speed feels proportional everywhere.

## Deliverables

- `packages/nav/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/nav/src/controller.ts`, `src/input.ts`, `src/useFlightController.tsx`,
  `src/index.ts`
- `packages/nav/test/controller.test.ts`
- `packages/nav/README.md` (< 150 lines)
- `apps/web/src/App.tsx` (swap OrbitControls → useFlightController),
  `apps/web/package.json`

## Context Files

- `docs/architecture.md` §3, §5.3 (whole section), §9
- `docs/decisions/ADR-001-coordinates.md` (rebase rules nav must respect)
- `packages/coords/README.md`, `packages/scene-host/README.md`
- `packages/core-types/src/coords.ts`
