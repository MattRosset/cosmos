# @cosmos/nav

Scale-aware free-flight camera controller (architecture §5.3). WASD + mouse-look where
speed scales with distance-to-nearest-surface. Pure math + DOM input — **no Three.js,
no React**. The R3F camera-sync hook lives in app glue
(`apps/web/src/glue/useFlightController.tsx`, TASK-060); `@cosmos/nav` exposes
`createFlightController` only.

**Public API freezes at the end of Phase 0 (TASK-006).**

## Purpose

The universe spans ~26 orders of magnitude; linear zoom speed is unusable. This package
provides log-scaled flight
(`speed = clamp(speedScale × distanceToNearestSurface, min, max)`), f64 position tracking
via `UniversePosition` (never reads the Three.js camera back), quaternion-only orientation
(no Euler / gimbal lock), and transparent rebasing when `coords` fires a `RebaseEvent`.

## API

```ts
import { createFlightController } from '@cosmos/nav';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';

const tree = createScaleFrameTree();
const origin = createOriginManager(tree, initialCamera);
const flight = createFlightController({ origin, initial: { position, orientation } });

flight.attach(canvasElement);
flight.setDistanceToNearestSurface(400); // host supplies each frame
flight.update(dtMs);
```

The R3F hook `useFlightController({ origin, initial })` lives in app glue
(`apps/web/src/glue/useFlightController.tsx`) — it is the only place that touches the camera.

### Go-to-target (Phase 1 — TASK-013)

Double-click-a-star UX: exponential-decay flight that decelerates as it approaches, turns
to face early, and never overshoots.

```ts
flight.goTo({
  target: { context: 'galaxy', local: [-1.82, -1.9, -0.42] },
  arrivalDistanceM: 1e13, // ~67 AU — star fills the view
  durationMs: 6000,       // optional, default 6000, clamped [1000, 20000]
});
const unsub = flight.onGoToEnd((completed) => {/* true=arrived, false=cancelled */});
flight.cancelGoTo(); flight.goToActive; // boolean
```

**Motion law:** distance decays as `d(t) = d0 × exp(−k × t)`,
`k = ln(d0 / arrivalDistanceM) / durationMs` — constant *perceived* speed across orders of
magnitude. Orientation slews to face the target (time constant `durationMs / 5`). Any
WASD/RF key or pointer drag past the 2 px deadzone cancels and resumes free flight.

### Input (v1)

| Input | Action |
|---|---|
| `W` / `S` / `A` / `D` | Forward / back / strafe |
| `R` / `F` | Up / down |
| Pointer drag | Look (2 px deadzone) |
| `Shift` / `Ctrl` | ×10 / ×0.1 speed |

Touch: deferred (architecture §5.3).

### Context switching (v3 — TASK-027): galaxy⇄system

Seamless galaxy⇄system zoom (ADR-001 §3–§4). When the camera nears an anchored star
system the controller flips the active scale context `galaxy → system` (and back on
leaving), with hysteresis, velocity rescaling, **and zero positional discontinuity**.

```ts
// PRECONDITION — the glue sets the tree anchor FIRST; nav never touches the tree:
tree.setAnchor('system', star.positionPc);          // host star → system origin
flight.setSystemAnchor({ id: 'sol', positionPc: star.positionPc });
flight.contextId;                                    // mirrors origin.context
const unsub = flight.onContextSwitch((e) => {/* e.from → e.to, e.anchorId; same frame */});
flight.setSystemAnchor(null);                        // clears → exits next update
```

**Glue contract:**

- The controller **never** calls `tree.setAnchor` — the glue owns the tree and must set
  `'system'` to `positionPc` *before* the camera enters. A dev-only guard throws if the
  host star is not at the system origin after a switch (skipped in production).
- While `contextId === 'system'`, `setSystemAnchor` with a **different** id is ignored —
  wait for exit before re-anchoring. `null` always clears.
- Hysteresis: `enterSystemAtM` default `7.5e14` (≈5,000 AU), `exitSystemAtM` default
  `1.5e15`. Constructor throws `RangeError` unless `exitSystemAtM ≥ 1.5 × enterSystemAtM`.
- Velocity rescales by the unit ratio so physical speed is unchanged; speed **caps** stay
  as configured (context-agnostic units/s). Orientation is untouched by a switch; an
  in-flight `goTo` survives it unchanged.

### Context switching (v4 — TASK-037): universe⇄galaxy

The M3 zoom chain extends one level up: nearing a `GalaxyAnchor` switches
`universe → galaxy` (and back), with the same hysteresis / velocity-rescaling /
zero-discontinuity guarantees as galaxy⇄system.

```ts
tree.setAnchor('galaxy', galaxy.positionMpc);   // galaxy → galaxy origin (glue, FIRST)
flight.setGalaxyAnchor({ id: 'proc:milkyway', positionMpc: galaxy.positionMpc });

import { generateLocalGroup } from '@cosmos/nav';
const galaxies = generateLocalGroup({ seed: 7 });   // 12 GalaxyRecords, ≤ 1.5 Mpc, seeded
```

Same glue contract as galaxy⇄system: `tree.setAnchor('galaxy', positionMpc)` before entry
(dev-guard throws otherwise); a **different** id is ignored while `contextId` is `'galaxy'`
or deeper; `null` clears. Hysteresis: `enterGalaxyAtM` default `1.543e21` (≈50 kpc),
`exitGalaxyAtM` default `3.086e21`; constructor throws `RangeError` if exit < 1.5× enter.

### Cinematic mode (v5 — TASK-051)

Spline-driven playback for tours/intros (§5.3 / §5.12). Additive: a cinematic obeys the
**same motion discipline as `goTo`** — pausable, cancels on user input, survives a rebase
and a context switch.

```ts
import type { CameraSpline } from '@cosmos/core-types';

flight.playSpline(spline, { onEnd: (completed) => {/* true=done, false=cancelled */} });
flight.orbitBody({ center: { context: 'system', local: [0, 0, 0] }, radiusM: 1.5e11, ratePerSec: 0.1 });
flight.pauseCinematic(); flight.resumeCinematic(); flight.cancelCinematic();
flight.cinematicActive;   // spline OR orbit playing; flight.letterboxActive → chrome reads
```

**Interpolation:** position and look-at use **centripetal** Catmull-Rom (`alpha = 0.5`,
Barry–Goldman; `catmullRomCentripetal` is exported) — centripetal spacing avoids the cusps
uniform CR produces at uneven keyframes. Control keyframes are reconverted to render space
**every frame** via `origin.toRenderSpace`, so a path crosses a boundary / rebase with no
discontinuity. Orientation slews look-at quaternion-only (200 ms). Any WASD/RF key or drag
past the 2 px deadzone cancels playback that frame; cinematic and `goTo` are mutually
exclusive; the per-frame `update()` is allocation-free (module-scoped scratch).

## Frame loop & boundaries

The glue hook subscribes at `PRIORITY_NAV` (-200). The host must call
`setDistanceToNearestSurface` **before** `update()` each frame — register a
`useFrameContext` callback at `PRIORITY_NAV - 1` in the app. The core controller
(`createFlightController`) is pure math + DOM (no Three.js/React); camera sync is the app
glue hook's job (`apps/web/src/glue/useFlightController.tsx`), the only file that touches the
R3F camera. Nav does not modify scene content; selection and picking live elsewhere.

## Testing

`pnpm --filter @cosmos/nav test` — speed law, quaternion stability, rebase transparency,
input dispose, zero-allocation `update()`.
