# @cosmos/orbits

Keplerian two-body propagation for the Cosmos explorer. Pure functions, no Three.js, no DOM.

## What it does

- **Kepler solver** — Newton–Raphson `solveKepler(M, e)` with 64-step bisection fallback; converges for e ∈ [0, 0.99).
- **Position propagation** — `elementsToPositionAu(elements, epochJD, out)` writes the body's position (AU, parent frame, element axes) into a pre-allocated triple; zero allocations on the frame path (§9).
- **Batch propagation** — `propagateBatch(packed, epochJD, outPositionsAu)` operates on packed `Float64Array` data, sized for future off-thread use in `worker-orbits`.
- **Orbit polylines** — `orbitPolylineAu(elements, segments, out?)` returns a closed `Float32Array` sampled uniformly in eccentric anomaly; for rendering only (not frame-path).

## Algorithm

Standard Keplerian two-body (Curtis, *Orbital Mechanics for Engineering Students*, ch. 3–4):

1. Compute mean motion `n = sqrt(μ / a³)`.
2. Propagate mean anomaly: `M = M₀ + n·t` (JD difference × SECONDS_PER_DAY, then scale).
3. Solve Kepler's equation `E − e·sin E = M` by Newton–Raphson.
4. Perifocal position: `xPf = a(cosE − e)`, `yPf = a√(1−e²)·sinE`.
5. Rotate from perifocal frame to element axes via the standard Ω, ω, i rotation matrix.

Positions are in the **parent body's frame**, in element-axis orientation (ecliptic-J2000-style). Callers are responsible for rotating to galactic axes via `ECLIPTIC_TO_GALACTIC` from `@cosmos/core-types`.

## API

```ts
import {
  AU_KM, SECONDS_PER_DAY,
  meanMotionRadPerS, solveKepler,
  ELEMENTS_STRIDE,
  elementsToPositionAu, packElements, propagateBatch,
  orbitPolylineAu,
} from '@cosmos/orbits';
```

See [`src/index.ts`](src/index.ts) for the full public API with JSDoc.

## Constraints

- Elliptical orbits only (e ∈ [0, 1)); `RangeError` for e ≥ 1.
- All angles are **radians** internally; degrees exist only at the data-pack boundary.
- No velocity, hyperbolic orbits, or universal variables — out of scope.
- `elementsToPositionAu` and `propagateBatch` are frame-path: zero allocations.

## Running tests

```
pnpm --filter @cosmos/orbits test
```
