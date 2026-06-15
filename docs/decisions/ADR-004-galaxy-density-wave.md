# ADR-004: Galaxy Density-Wave Model & Seed-Derivation Hierarchy

**Status:** Accepted
**Date:** 2026-06-15
**Refines:** architecture §5.6 (density-wave spiral arms via rejection sampling; hierarchical seeds)

## Context

The Phase 3 `procgen` galaxy generator (TASK-033) must produce deterministic,
seedable star distributions whose spiral structure reads as a galaxy at a glance,
and whose star colors match a configured initial mass function (the §5.6
"statistical tests" acceptance criterion). Architecture §5.6 fixes the *method*
("density-wave spiral arms via rejection sampling", "mass→temperature→color via
simplified main-sequence relations", "seed derived hierarchically:
`hash(galaxySeed, sectorId, starIndex)`") but leaves the *exact* radial profile,
arm geometry, rejection envelope, IMF, color mapping, and the precise seed-fork
hierarchy unspecified. These are cross-cutting because the same byte-identical
output is asserted three ways: snapshot hashes in `procgen` tests, the
statistical color-distribution test, and (later) parity between main-thread and
worker execution. Pin them once so an executing agent transcribes rather than
invents, and so a seed in a bug report reproduces exactly.

## Decision

### 1. Coordinate model

Galaxy generated in its own **galaxy-context parsecs**, centered at the origin,
disc in the x–y plane, +z = north. Parameters (all in `GalaxyGenParams`, defaults
fixed here):

- `starCount` — stars to emit (e.g. 1e6 for the §5.6 perf gate).
- `discRadiusPc` default `15000`, `discScaleLengthPc` default `3500`
  (exponential disc), `discScaleHeightPc` default `300`.
- `armCount` default `2`, `armPitchRad` default `0.2304` (≈ 13.2°),
  `armWindings` default `1.0`, `armWidthPc` default `1200`
  (cross-arm Gaussian σ), `armContrast` default `2.5` (peak density multiple
  inside an arm vs. inter-arm).
- `bulgeFraction` default `0.18`, `bulgeRadiusPc` default `1500`.

### 2. Radial & vertical profile

Disc surface density `Σ(r) ∝ exp(−r / discScaleLengthPc)` truncated at
`discRadiusPc`. A star's radius is sampled by inverse-CDF of that profile (exact,
no rejection on r). Vertical offset `z = discScaleHeightPc × atanh(2·u − 1) / 2`
(sech² disc approximation via inverse-CDF, `u ∈ (0,1)`). The bulge fraction of
stars instead sample a Plummer-like radius
`r = bulgeRadiusPc · √(u^(−2/3) − 1)`-clamped, spherically distributed.

### 3. Spiral arms via rejection sampling (the fixed law)

For a disc (non-bulge) star at radius `r`, the **log-spiral arm phase** is
`θ_arm(r) = armWindings · ln(r / discScaleLengthPc + 1) / tan(armPitchRad)`. The
angular density modulation for candidate azimuth `φ`:
`m(φ, r) = 1 + (armContrast − 1) · Σ_a exp(−d_a² / (2σ_φ²))` where `a` runs over
`armCount` arms each offset by `2π·a/armCount`, `d_a` is the wrapped angular
distance from `φ` to `(θ_arm(r) + 2π·a/armCount)` measured **as arc length**
`r·Δφ`, and `σ_φ = armWidthPc`. **Rejection sampling:** draw candidate `φ ∈ [0,2π)`
and `u ∈ [0, armContrast)`; accept when `u < m(φ, r)`. Envelope ceiling is
`armContrast` (the analytic max of `m`); cap rejection attempts at 64 and accept
the last candidate on overflow (guarantees termination; documented).

### 4. IMF & mass→color

Stellar mass sampled from a **Kroupa (2001) broken power law** over
`[0.1, 50] M☉` (slopes −1.3 on `[0.1, 0.5)`, −2.3 on `[0.5, 50]`), inverse-CDF.
Mass→temperature via the simplified main-sequence relation
`T_eff = 5772 · (M / M☉)^0.54` K (§5.6 "simplified main-sequence relations").
Temperature→B–V via the inverse Ballesteros (2012) relation (the same relation
`render-stars` uses forward for its LUT — cite it, do not re-derive a different
one). Absolute magnitude via mass–luminosity `L = (M)^3.5 L☉`,
`M_V = 4.83 − 2.5·log10(L/L☉)`. Outputs are exactly the `StarBatch` attribute set
(absMag, colorIndexBV) so `render-stars`/`render-galaxy` consume them unmodified.

### 5. Seed-derivation hierarchy (fixed, uses `core-types` PRNG only)

All randomness flows from `createPrng`/`hashCombine`/`fork` (§5.6 ban on
`Math.random()`). The hierarchy, transcribed not improvised:

```
galaxySeed                       (the GalaxyRecord.seed)
  └ sectorSeed   = hashCombine(galaxySeed, sectorId)        // per spatial sector
      └ starStream = prng(sectorSeed).fork(streamId)        // independent streams:
          stream 0: radius/φ/z placement
          stream 1: mass/IMF
          stream 2: per-star jitter (color scatter, etc.)
```

Stars within a sector are generated in index order; the i-th star draws from the
forked streams in the fixed order above. **No `seed + index`** anywhere (naive
addition overlaps neighbor sequences, §5.6). The same `(galaxySeed, sectorId)`
yields byte-identical output on any platform (PRNG is u32-integer math).

## Alternatives Considered

- **Full N-body / density-wave simulation:** out of scope and non-deterministic
  across platforms; §5.6 explicitly wants a pure function of `(seed, params)`.
- **Texture/curl-noise arms:** cheaper but does not satisfy "density-wave spiral
  arms via rejection sampling" and couples generation to a noise texture; rejected.
- **Salpeter single-slope IMF:** simpler but over-produces massive stars vs. the
  observed field; Kroupa chosen so the statistical color test is physically honest.

## Consequences

- `core-types` (TASK-031) owns the `GalaxyGenParams` type and the defaults table
  above (one source of truth shared by `procgen` and any caller).
- `procgen` (TASK-033) transcribes §2–§5; its snapshot test hashes the output
  buffers, and a statistical test asserts the emitted B–V distribution matches the
  Kroupa+relations expectation within tolerance.
- Main-thread and worker execution are byte-identical because the only entropy is
  the seeded PRNG and the math is integer/IEEE-deterministic.
- If a future task changes any default or relation, output hashes change — treat as
  a new reviewed task, not a silent tweak.
