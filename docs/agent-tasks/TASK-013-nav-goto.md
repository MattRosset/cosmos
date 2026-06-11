# Task: `nav` v2 — go-to-target camera animation

**ID:** TASK-013
**Target package:** `packages/nav`
**Size:** M
**Phase:** 1 — lane D (nav)
**Depends on:** TASK-006

## Goal

Double-click-a-star UX foundation (architecture §5.3): `goTo` flies the camera from
anywhere to a target `UniversePosition`, decaying distance exponentially (log-space
ease — constant *perceived* speed across orders of magnitude), turning to face the
target early, never overshooting, cancellable by any user input. This is the sanctioned
Phase-1 thaw of the `nav` public API (additions below only); everything from TASK-005
keeps its exact behavior.

## Frozen Interface (additions to @cosmos/nav — existing API unchanged)

```ts
import type { UniversePosition } from '@cosmos/core-types';

export interface GoToOptions {
  readonly target: UniversePosition;
  /** Stop when camera-to-target distance reaches this, METERS. */
  readonly arrivalDistanceM: number;
  /** Total flight duration target. Default 6000. Clamped to [1000, 20000]. */
  readonly durationMs?: number;
}

export interface FlightController {
  // …existing members from TASK-005 stay byte-identical…
  /** Begin an animated flight. Replaces any in-flight goTo. */
  goTo(opts: GoToOptions): void;
  /** Abort (also triggered internally by any user movement/look input). */
  cancelGoTo(): void;
  /** True while a goTo is animating. */
  readonly goToActive: boolean;
  /** Completion hook: fires with true on arrival, false on cancel. Returns
   *  an unsubscribe function. */
  onGoToEnd(cb: (completed: boolean) => void): () => void;
}
```

## Motion law (fixed — do not redesign)

Within `update(dtMs)` while `goToActive`:

1. Distance: `dM = |toRenderSpace(target)| × CONTEXT_UNIT_METERS[origin.context]`
   (camera-relative length — this is the only sanctioned way to measure it; never
   subtract raw locals across contexts, ADR-001).
2. Exponential decay toward arrival: at goTo start compute
   `k = ln(d0 / arrivalDistanceM) / durationMs`; each frame set the new distance
   `dNext = max(arrivalDistanceM, dM × exp(−k · dtMs))` and move the camera along the
   (camera → target) direction by `dM − dNext` (converted back to context units).
   Movement happens in f64 `UniversePosition` space, as in TASK-005 — never via the
   Three.js camera.
3. Orientation: slerp the quaternion toward "forward = camera→target direction" with
   time constant `durationMs / 5` so the turn substantially completes in the first
   ~20% of the flight. Quaternion stays normalized.
4. Arrival: when `dNext === arrivalDistanceM`, snap goToActive → false, zero residual
   velocity, fire `onGoToEnd(true)`.
5. Cancellation: any translate key, or pointer look-drag beyond the existing 2 px
   deadzone, calls `cancelGoTo()` → `onGoToEnd(false)`; free flight resumes that same
   frame with current damped velocity (no jump).
6. Rebase events returned by `origin.setCameraPosition` are applied exactly as in
   free flight — the animation must be continuous across a rebase.

Animate in the target's frame (§5.3): Phase 1 is single-context (`galaxy`), but step 1
already routes through `toRenderSpace`, which is context-correct — add a test pinning
behavior when `target.context !== origin.context` so Phase 2 context switching lands
on a tested path.

## Inputs / Outputs

- **Inputs:** e.g. camera at `{ context: 'galaxy', local: [0, 0, 0] }`, target Sirius
  `{ context: 'galaxy', local: [-1.82, -1.9, -0.42] }`, `arrivalDistanceM: 1e13`
  (~67 AU — a star comfortably fills the view), `durationMs: 6000`.
- **Outputs:** per-frame `FlightState` as before; terminal state ≈ 1e13 m from target,
  facing it (forward·toTarget > 0.999).

## Constraints & Forbidden Actions

- Do not modify `core-types`, `coords`, or `scene-host`. Only the API additions above
  may change `nav`'s public surface (this file is the thaw approval).
- All existing TASK-005 tests must pass UNMODIFIED — if one breaks, the task is
  `blocked`, not the test edited.
- No allocations in `update()` during goTo (scratch arrays module-scoped; the
  per-goTo state object is created once in `goTo()`, which is fine).
- No `OrbitControls`/drei (§5.3); no promises in the frame path (callback API above).
- Allowed dependencies: unchanged from TASK-005 (nothing new).

## Common Mistakes (architecture §5.3 — copy kept verbatim)

- Linear zoom speed (unusable across 10²⁶ range) — the exponential-decay law IS the
  log-space easing; do not replace it with lerp on position.
- Gimbal lock from Euler accumulation — quaternion-only orientation (slerp, then
  normalize).
- Go-to animations in absolute coordinates breaking across context switches — animate
  via camera-relative `toRenderSpace` distance, never absolute deltas.
- Approach a star from 100 AU — speed decays so user never overshoots through the
  body: `dNext` is clamped at `arrivalDistanceM`, monotonically.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/nav test` — new `test/goto.test.ts` against a real
   `OriginManager` (simulated 16.67 ms frames):
   - Arrival: from d0 ∈ {1 pc, 100 pc} to `arrivalDistanceM = 1e13`, controller
     reaches within 1% of arrival distance by `durationMs × 1.5`, then
     `goToActive === false` and `onGoToEnd(true)` fired exactly once.
   - No overshoot: distance to target never drops below `0.99 × arrivalDistanceM`.
   - Monotonic: after the first 25% of frames, distance is non-increasing.
   - Facing: at arrival, normalized forward·(target direction) > 0.999; quaternion
     norm within 1e-9 of 1 throughout.
   - Cancel: a translate-key input mid-flight → `onGoToEnd(false)`, free flight
     works, position continuous (no jump > one frame's travel).
   - Rebase continuity: target placed so the flight crosses
     `REBASE_THRESHOLD_UNITS`; distance-to-target series stays smooth (no step
     > 2× neighboring frame deltas) and arrival still succeeds.
   - Cross-context pin: `target.context === 'system'` while origin is `galaxy` —
     distance measured via toRenderSpace still decays and arrives (uses the frame
     tree anchors; fixture anchors the system frame 10 pc away).
   - `update()` allocation-free during goTo (same-identity scratch check).
   - All TASK-005 suites green, unmodified.
2. Coverage gate unchanged (whatever `nav` had stays ≥ — do not lower thresholds).
3. `pnpm verify` exits 0.

## Deliverables

- `packages/nav/src/controller.ts` (goTo state machine), `src/goto.ts` (motion law,
  pure helpers), `src/index.ts` (export additions)
- `packages/nav/test/goto.test.ts`
- `packages/nav/README.md` (API additions documented; keep < 150 lines)

## Context Files

- `docs/architecture.md` §5.3 (whole section), §9 (frame-loop rules)
- `docs/decisions/ADR-001-coordinates.md` (rebase + cross-context measurement)
- `packages/nav/src/controller.ts`, `test/controller.test.ts` (current state)
- `packages/coords/README.md` (`toRenderSpace`, `switchContext` semantics)
- `packages/core-types/src/coords.ts` (`CONTEXT_UNIT_METERS`)
