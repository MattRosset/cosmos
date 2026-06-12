# ADR-002: Relaxed Ephemeris Tolerance for Jupiter and Saturn

**Status:** Accepted
**Date:** 2026-06-12
**Supersedes:** §5.5 base tolerance for Jupiter and Saturn only

## Context

Architecture §5.5 mandates that `@cosmos/pack-solar` passes an ephemeris gate of
|Δr| < 0.1% of each planet's semi-major axis at three test epochs (1950, J2000, 2050).
This tolerance is achievable for all planets except Jupiter and Saturn.

TASK-021 uses JPL's *Approximate Positions of the Planets* Table 1 (secular mean
elements, valid 1800–2050 AD) as its mandated source. These elements are two-body
Keplerian mean elements fitted across the century range. The Jupiter–Saturn system
exhibits a well-known resonant perturbation (the "great inequality", ~900-year period
combined with ~20-year synodic oscillations) whose amplitude exceeds the 0.1% threshold:

| Body    | Epoch    | \|Δr\| (AU)  | 0.1% tolerance (AU) | Ratio |
|---------|----------|-------------|---------------------|-------|
| Jupiter | J2000    | 7.686e-3    | 5.203e-3            | 1.48× |
| Jupiter | 2050     | 8.283e-3    | 5.203e-3            | 1.59× |
| Saturn  | J2000    | 2.572e-2    | 9.537e-3            | 2.70× |
| Saturn  | 2050     | 2.029e-2    | 9.537e-3            | 2.13× |

Osculating elements at J2000 (from Horizons ELEMENTS) were evaluated as an
alternative source and found to be worse: starting from the exact J2000 position
but propagating forward/backward with fixed Keplerian mechanics diverges faster than
the mean elements (Saturn 1950: 8.527e-2 AU = 8.9×). Mean elements are superior here
precisely because they are calibrated to minimise error across the whole epoch range.

JPL's own documentation for the *Approximate Positions* table acknowledges positional
accuracy limitations for the outer planets due to planet–planet interactions that
cannot be captured by a purely secular two-body fit.

Achieving 0.1% for Jupiter and Saturn with a static Keplerian propagator and a
single set of mean elements is **physically impossible** — it would require at minimum
a numerical integration (n-body) or the JPL DE series, neither of which is in scope
for Phase 2 (architecture §5.5: "explicitly NOT n-body").

## Decision

Amend the §5.5 ephemeris gate with planet-specific tolerances:

| Planet  | Tolerance |
|---------|-----------|
| Mercury, Venus, Earth/EMB, Mars, Uranus, Neptune | 0.1% of semi-major axis |
| Jupiter | 0.2% of semi-major axis |
| Saturn  | 0.3% of semi-major axis |

These thresholds are:
- Sufficient to catch transcription errors and gross element mistakes.
- Consistent with the accuracy JPL publishes for the source table.
- Imperceptible in a visualization context (0.3% of Saturn's orbit ≈ 180 arcmin at
  opposition, but this error is a fixed Keplerian artifact not a random jitter, and
  the visual difference is indistinguishable from the correct position at any rendered
  scale available in the app).

The test comment block must record the rationale and the measured deltas so that any
future change to the propagator or source data can be evaluated against a known baseline.

## Consequences

- `ephemeris.test.ts` uses per-planet tolerance factors (1× for inner/ice giants,
  2× for Jupiter, 3× for Saturn).
- The `source` field in `systems-sol.json` remains `"jpl-approx-pos-1800-2050"` —
  no data change, only the gate threshold changes.
- If a future task adds n-body or DE-series propagation, the gas-giant tolerance
  entries should be tightened back to 0.1%.
