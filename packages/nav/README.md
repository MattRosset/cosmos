# @cosmos/nav

Scale-aware free-flight camera controller (architecture §5.3). Replaces orbit-style
controls with WASD + mouse-look where speed scales with distance-to-nearest-surface.

**Public API freezes at the end of Phase 0 (TASK-006).**

## Purpose

The universe spans ~26 orders of magnitude; linear zoom speed is unusable. This
package provides:

- **Log-scaled flight:** `speed = clamp(speedScale × distanceToNearestSurface, min, max)`
- **f64 position tracking** via `UniversePosition` (never reads Three.js camera back)
- **Quaternion-only orientation** (no Euler accumulation / gimbal lock)
- **Transparent rebasing** when `coords` fires a `RebaseEvent`

Phase 1 adds **go-to-target** animated flight (TASK-013). Orbit mode, picking,
and context auto-switching remain Phase 2.

## API

```ts
import { createFlightController, useFlightController } from '@cosmos/nav';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';

const tree = createScaleFrameTree();
const origin = createOriginManager(tree, initialCamera);
const flight = createFlightController({ origin, initial: { position, orientation } });

flight.attach(canvasElement);
flight.setDistanceToNearestSurface(400); // host supplies each frame
flight.update(dtMs);

// React / R3F (inside SceneHost Canvas tree):
useFlightController({ origin, initial: { position, orientation } });
```

### Go-to-target (Phase 1 — TASK-013)

Double-click-a-star UX: exponential-decay flight that decelerates as it
approaches, turns to face early, and never overshoots.

```ts
// Start an animated flight
flight.goTo({
  target: { context: 'galaxy', local: [-1.82, -1.9, -0.42] },
  arrivalDistanceM: 1e13, // ~67 AU — star fills the view
  durationMs: 6000,       // optional, default 6000, clamped [1000, 20000]
});

// Listen for completion (fires once; returns unsubscribe fn)
const unsub = flight.onGoToEnd((completed) => {
  if (completed) console.log('arrived');
  else console.log('cancelled by user input');
});

// Abort manually
flight.cancelGoTo();

// Query
console.log(flight.goToActive); // boolean
```

**Motion law:** distance decays as `d(t) = d0 × exp(−k × t)` where
`k = ln(d0 / arrivalDistanceM) / durationMs` — constant *perceived* speed
across orders of magnitude. Orientation slews to face the target with a time
constant of `durationMs / 5`.

**Cancellation:** any WASD/RF key or pointer drag beyond the 2 px deadzone
cancels the flight automatically and resumes free flight that same frame.

### Input (v1)

| Input | Action |
|---|---|
| `W` / `S` / `A` / `D` | Forward / back / strafe |
| `R` / `F` | Up / down |
| Pointer drag | Look (2 px deadzone) |
| `Shift` | ×10 speed |
| `Ctrl` | ×0.1 speed |

Touch: deferred — see architecture §5.3.

### Context switching (v3 — TASK-027)

Seamless galaxy⇄system zoom (architecture §5.3, ADR-001 §3–§4). When the camera
nears an anchored star system the controller flips the active scale context
`galaxy → system` (and back on leaving), with hysteresis, rescaling velocity to
the new unit, **with zero positional discontinuity** — the camera's absolute
point in space is identical before and after.

```ts
// PRECONDITION — the glue sets the tree anchor FIRST; nav never touches the tree:
tree.setAnchor('system', star.positionPc);          // host star → system origin
flight.setSystemAnchor({ id: 'sol', positionPc: star.positionPc });

flight.contextId;                                    // mirrors origin.context
const unsub = flight.onContextSwitch((e) => {        // fires AFTER a switch
  console.log(e.from, '→', e.to, e.anchorId);        // same frame
});
flight.setSystemAnchor(null);                        // clears → exits next update
```

**Glue contract:**

- The controller **never** calls `tree.setAnchor` — the glue owns the tree and
  must set `'system'` to `positionPc` *before* the camera enters. A dev-only
  guard throws if the host star is not at the system origin after a switch
  (skipped in production builds).
- While `contextId === 'system'`, `setSystemAnchor` with a **different** id is
  ignored — wait for exit before re-anchoring. `null` always clears.
- Hysteresis: `enterSystemAtM` default `7.5e14` (≈5,000 AU), `exitSystemAtM`
  default `1.5e15`. The constructor throws `RangeError` unless
  `exitSystemAtM ≥ 1.5 × enterSystemAtM` (§5.8 anti-flapping).
- Velocity rescales by the unit ratio so physical speed is unchanged; speed
  **caps** stay as configured (context-agnostic units/s — documented asymmetry).
- Orientation is **untouched** by a switch (axes are identical across contexts;
  only the unit changes). An in-flight `goTo` survives the switch unchanged.

## Frame loop

Subscribe via `useFlightController` at `PRIORITY_NAV` (-200). The host must call
`setDistanceToNearestSurface` **before** `update()` each frame — register a
`useFrameContext` callback at `PRIORITY_NAV - 1` in the app.

## Boundaries

- **Core controller** (`createFlightController`): pure math + DOM — no Three.js/React.
- **Hook** (`useFlightController`): the only file that touches the R3F camera.
- Does not modify scene content; selection and picking live elsewhere.

## Testing

`pnpm --filter @cosmos/nav test` — speed law, quaternion stability, rebase
transparency, input dispose, zero-allocation `update()`.
