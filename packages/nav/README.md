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

v1 scope: free flight only. No go-to-target, orbit mode, picking, or context
auto-switching (Phase 1–2).

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

### Input (v1)

| Input | Action |
|---|---|
| `W` / `S` / `A` / `D` | Forward / back / strafe |
| `R` / `F` | Up / down |
| Pointer drag | Look (2 px deadzone) |
| `Shift` | ×10 speed |
| `Ctrl` | ×0.1 speed |

Touch: deferred — see architecture §5.3.

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
