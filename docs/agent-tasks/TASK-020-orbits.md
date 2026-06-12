# Task: `orbits` v1 — Kepler propagation, batch API, orbit polylines

**ID:** TASK-020
**Target package:** `packages/orbits` (new)
**Size:** M
**Phase:** 2 — lane G (pure math)
**Depends on:** TASK-018

## Goal

Keplerian two-body propagation (architecture §5.5): orbital elements → position at
epoch, a Newton–Raphson Kepler solver with a safe fallback, a typed-array batch API
sized for the future `worker-orbits`, and orbit-line polyline generation for
`render-planets`. **Explicitly NOT n-body.** Pure functions, no Three.js, no DOM.
Positions come out in the PARENT body's frame, in the same axes the elements were
given in (ecliptic-J2000-style for our packs); rotation to galactic axes is the
caller's job via `ECLIPTIC_TO_GALACTIC` (TASK-018) — this package knows nothing
about scale contexts.

## Frozen Interface

```ts
// public API of @cosmos/orbits
import type { KeplerElements } from '@cosmos/core-types';

export const AU_KM = 1.495978707e8;
export const SECONDS_PER_DAY = 86_400;

/** Mean motion n = sqrt(μ / a³) with a converted to km. Radians per second. */
export function meanMotionRadPerS(semiMajorAxisAu: number, muKm3S2: number): number;

/**
 * Solve Kepler's equation E − e·sin E = M for the eccentric anomaly.
 * Newton–Raphson, tolerance |ΔE| < 1e-12, ≤ 12 iterations; falls back to
 * 64-step bisection on non-convergence (never throws for e ∈ [0, 0.99]).
 * meanAnomalyRad may be any finite value (normalized internally).
 */
export function solveKepler(meanAnomalyRad: number, eccentricity: number): number;

/**
 * Position at epoch in the PARENT frame, AU, element axes. Writes into `out`
 * and returns it — zero allocations (frame path, §9).
 */
export function elementsToPositionAu(
  elements: KeplerElements,
  epochJD: number,
  out: [number, number, number],
): [number, number, number];

/** f64 slots per body in a packed batch — KeplerElements declaration order:
 *  [semiMajorAxisAu, eccentricity, inclinationRad, ascendingNodeLongitudeRad,
 *   argumentOfPeriapsisRad, meanAnomalyAtEpochRad, epochJD, muKm3S2]. */
export const ELEMENTS_STRIDE = 8;

export function packElements(list: readonly KeplerElements[]): Float64Array;

/**
 * Batch propagation (§5.5): outPositionsAu receives 3 f64 per body, same order.
 * outPositionsAu.length MUST equal 3 × (packed.length / ELEMENTS_STRIDE) — throw
 * RangeError otherwise. Zero allocations.
 */
export function propagateBatch(
  packed: Float64Array,
  epochJD: number,
  outPositionsAu: Float64Array,
): void;

/**
 * Closed orbit polyline in the parent frame, AU, element axes: (segments + 1)
 * points × 3 floats, sampled uniformly in ECCENTRIC anomaly starting at
 * periapsis; last point === first point. Allocates unless `out` (of exact
 * length) is provided. Build-time/setup use only — not a frame-path API.
 */
export function orbitPolylineAu(
  elements: KeplerElements,
  segments: number,
  out?: Float32Array,
): Float32Array;
```

## Algorithm (fixed — transcribe verbatim, cite in comments per §15)

Source to cite: Curtis, *Orbital Mechanics for Engineering Students*, ch. 3–4 (or
Vallado §2.2) — standard formulation:

1. `n = meanMotionRadPerS(a, μ)`; `t = (epochJD − elements.epochJD) × SECONDS_PER_DAY`
   (f64 seconds; JD subtraction first, then scale).
2. `meanAnomaly = meanAnomalyAtEpochRad + n·t`, normalized to (−π, π].
3. `E = solveKepler(meanAnomaly, e)`. Newton start value: `E₀ = M` if `e < 0.8`,
   else `E₀ = π·sign(M)`. Iterate `E ← E − (E − e·sinE − M)/(1 − e·cosE)`.
4. Perifocal coordinates: `xPf = a(cos E − e)`, `yPf = a·√(1−e²)·sin E`, `zPf = 0`.
5. Rotate perifocal → element axes (Ω = ascendingNodeLongitudeRad,
   ω = argumentOfPeriapsisRad, i = inclinationRad):
   ```
   x = (cosΩ·cosω − sinΩ·sinω·cosi)·xPf + (−cosΩ·sinω − sinΩ·cosω·cosi)·yPf
   y = (sinΩ·cosω + cosΩ·sinω·cosi)·xPf + (−sinΩ·sinω + cosΩ·cosω·cosi)·yPf
   z = (sinω·sini)·xPf + (cosω·sini)·yPf
   ```
6. `orbitPolylineAu`: for k in [0, segments]: `E_k = 2πk/segments`, run steps 4–5.

## Inputs / Outputs

- **Inputs:** e.g. Earth-like test elements
  `{ semiMajorAxisAu: 1.00000261, eccentricity: 0.01671123, inclinationRad: ~0,
  ascendingNodeLongitudeRad: 0, argumentOfPeriapsisRad: 1.7966, meanAnomalyAtEpochRad:
  −0.0433, epochJD: 2451545.0, muKm3S2: 1.32712440018e11 }`.
- **Outputs:** position at `epochJD = 2451545.0` with `|r| ≈ 0.9833 AU` (perihelion
  season); period from `2π/n ≈ 365.26 days`.

## Constraints & Forbidden Actions

- Dependencies: `@cosmos/core-types` only. Pure functions. No Three.js (§5.5).
- Radians-only internally; no degree value may appear anywhere in `src/`.
- `elementsToPositionAu` and `propagateBatch` are frame-path: zero allocations
  (module-scoped scratch; trig results in locals).
- Do not implement velocity, hyperbolic orbits (e ≥ 1 → throw `RangeError`), or
  universal variables — out of scope until a reviewed task needs them.
- Never name a variable `M`, `E`, or `nu` — `meanAnomalyRad`, `eccentricAnomalyRad`,
  `trueAnomalyRad` (§5.5).
- No `Math.random()` — property tests use `createPrng` from `@cosmos/core-types`.

## Common Mistakes (architecture §5.5 — copy kept verbatim)

- Degrees vs. radians (standardize on radians internally, convert at data-pack
  boundary).
- Wrong anomaly (mean vs. eccentric vs. true) — name variables explicitly
  `meanAnomaly`, never `M`.
- Singularities at e≈0 and i≈0 (use universal-variable or guard formulations) — for
  this task the perifocal formulation above is singularity-free for e ∈ [0, 1);
  guard only the Newton denominator `1 − e·cosE` (fallback to bisection).
- Plus: forgetting to normalize the mean anomaly before solving (Newton diverges for
  |M| ≫ π at high e); computing `t` by converting each JD to seconds separately
  (catastrophic f64 cancellation — subtract JDs first).

## Acceptance Tests

The task is DONE only when these pass in CI. (The §5.5 "published ephemeris values
for the 8 planets at J2000 ± 50 yr" gate lives in TASK-021, where the real element
set exists — this task proves the math machinery.)

1. `pnpm --filter @cosmos/orbits test`:
   - **Solver property test (seeded PRNG, ≥ 2000 cases):** e ∈ [0, 0.99],
     meanAnomalyRad ∈ [−10π, 10π]: result satisfies |E − e·sinE − M_normalized|
     < 1e-10; Newton converges in ≤ 12 iterations for every case (expose an
     internal iteration counter for tests via a `/** @internal */` export);
     compare against a brute-force 1e-12-tolerance bisection oracle implemented
     in the test file — |E_newton − E_bisect| < 1e-9.
   - **Geometry invariants (seeded, ≥ 500 element sets):** |r| ∈
     [a(1−e) − ε, a(1+e) + ε]; position at `epochJD + period` equals position at
     `epochJD` within 1e-9 AU relative (period = 2π/n in days); mirror symmetry —
     propagating +Δt and −Δt from periapsis gives z-symmetric positions for i = 0.
   - **Circular sanity (hand-checkable oracle):** a = 1 AU, e = 0, i = 0, Ω = 0,
     ω = 0, M₀ = 0, μ = 1.32712440018e11 → at `epochJD + period/4` position is
     [0, 1, 0]·AU within 1e-6; at `+period/2` → [−1, 0, 0].
   - **Inclination check:** same orbit with i = π/2, Ω = 0: at `+period/4`
     position is [0, 0, 1] within 1e-6 (orbit tilted out of plane around the
     node line).
   - `propagateBatch` over 50 seeded bodies matches per-body
     `elementsToPositionAu` exactly; length-mismatch throws `RangeError`.
   - `orbitPolylineAu(…, 256)`: 257×3 floats, first == last, every point obeys the
     radius bounds; passing `out` of exact length returns the same reference,
     wrong length throws `RangeError`.
   - Zero-allocation: `elementsToPositionAu`/`propagateBatch` same-identity scratch
     check (pattern from `nav`/`coords` tests).
   - e ≥ 1 → `RangeError` from `elementsToPositionAu` and `solveKepler`.
2. **Coverage gate:** statement coverage ≥ 90% on `src` (§6 Phase 0 doctrine applies
   to `orbits` explicitly).
3. `pnpm verify` exits 0.

## Deliverables

- `packages/orbits/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/orbits/src/kepler.ts` (solver), `src/propagate.ts`, `src/polyline.ts`,
  `src/index.ts`
- `packages/orbits/test/kepler.test.ts`, `test/propagate.test.ts`,
  `test/polyline.test.ts`
- `packages/orbits/README.md` (< 150 lines)

## Context Files

- `docs/architecture.md` §5.5 (whole section), §8.6 (determinism), §15 (citations)
- `packages/core-types/src/orbits.ts` (the binding `KeplerElements` shape)
- `packages/core-types/src/prng.ts` (seeded PRNG for property tests)
- `packages/coords/test/` (zero-allocation test pattern to copy)
