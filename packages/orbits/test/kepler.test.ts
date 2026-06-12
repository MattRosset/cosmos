import { describe, expect, it } from 'vitest';
import { createPrng } from '@cosmos/core-types';
import {
  AU_KM,
  SECONDS_PER_DAY,
  meanMotionRadPerS,
  solveKepler,
  _lastIterations,
} from '../src/index.js';

// ─── Bisection oracle (implemented in-test per spec §acceptance) ──────────────

function bisectOracle(meanAnomalyNorm: number, eccentricity: number): number {
  let lo = meanAnomalyNorm - Math.PI;
  let hi = meanAnomalyNorm + Math.PI;
  // ~64 halvings → ~2e-19 accuracy, well past 1e-12
  for (let b = 0; b < 200; b++) {
    const mid = 0.5 * (lo + hi);
    if (mid - eccentricity * Math.sin(mid) - meanAnomalyNorm < 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Normalize to (−π, π] — matches solveKepler's internal normalization. */
function normAngle(rad: number): number {
  const TWO_PI = 2 * Math.PI;
  let a = rad % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a <= -Math.PI) a += TWO_PI;
  return a;
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('AU_KM matches IERS 2012 value', () => {
    expect(AU_KM).toBe(1.495978707e8);
  });

  it('SECONDS_PER_DAY is 86400', () => {
    expect(SECONDS_PER_DAY).toBe(86_400);
  });
});

// ─── meanMotionRadPerS ────────────────────────────────────────────────────────

describe('meanMotionRadPerS', () => {
  it('gives ~365.25-day period for Earth-like orbit', () => {
    const MU_SUN = 1.32712440018e11;
    const n = meanMotionRadPerS(1.0, MU_SUN);
    const periodDays = (2 * Math.PI / n) / SECONDS_PER_DAY;
    expect(Math.abs(periodDays - 365.25)).toBeLessThan(0.01);
  });
});

// ─── solveKepler — e ≥ 1 throws ──────────────────────────────────────────────

describe('solveKepler — invalid eccentricity', () => {
  it('throws RangeError for e = 1', () => {
    expect(() => solveKepler(0.5, 1)).toThrow(RangeError);
  });

  it('throws RangeError for e > 1', () => {
    expect(() => solveKepler(0.5, 1.5)).toThrow(RangeError);
  });
});

// ─── Solver property test (seeded PRNG, ≥ 2000 cases) ────────────────────────

describe('solveKepler — property test', () => {
  it('residual < 1e-10 for ≥ 2000 seeded cases (e ∈ [0, 0.99], M ∈ [−10π, 10π])', () => {
    const rng = createPrng(0xdeadbeef);
    const cases = 2000;

    for (let n = 0; n < cases; n++) {
      const eccentricity = rng.range(0, 0.99);
      const meanAnomalyRad = rng.range(-10 * Math.PI, 10 * Math.PI);

      const eccentricAnomalyRad = solveKepler(meanAnomalyRad, eccentricity);
      const meanAnomalyNorm = normAngle(meanAnomalyRad);
      const residual = Math.abs(
        eccentricAnomalyRad - eccentricity * Math.sin(eccentricAnomalyRad) - meanAnomalyNorm,
      );

      expect(residual, `residual at case ${n}: e=${eccentricity}, M=${meanAnomalyRad}`).toBeLessThan(
        1e-10,
      );
    }
  });

  it('Newton converges in ≤ 12 iterations for every seeded case', () => {
    const rng = createPrng(0xcafebabe);
    const cases = 2000;

    for (let n = 0; n < cases; n++) {
      const eccentricity = rng.range(0, 0.99);
      const meanAnomalyRad = rng.range(-10 * Math.PI, 10 * Math.PI);

      solveKepler(meanAnomalyRad, eccentricity);

      expect(
        _lastIterations,
        `iterations at case ${n}: e=${eccentricity}, M=${meanAnomalyRad}`,
      ).toBeLessThanOrEqual(12);
    }
  });

  it('agrees with bisection oracle to within 1e-9', () => {
    const rng = createPrng(0x1234abcd);
    const cases = 2000;

    for (let n = 0; n < cases; n++) {
      const eccentricity = rng.range(0, 0.99);
      const meanAnomalyRad = rng.range(-10 * Math.PI, 10 * Math.PI);
      const meanAnomalyNorm = normAngle(meanAnomalyRad);

      const newton = solveKepler(meanAnomalyRad, eccentricity);
      const bisect = bisectOracle(meanAnomalyNorm, eccentricity);

      expect(
        Math.abs(newton - bisect),
        `newton vs bisect at case ${n}: e=${eccentricity}, M=${meanAnomalyRad}`,
      ).toBeLessThan(1e-9);
    }
  });
});

// ─── Boundary values ─────────────────────────────────────────────────────────

describe('solveKepler — boundary values', () => {
  it('circular orbit (e = 0): E = M for any M', () => {
    for (const m of [0, 1, -1, Math.PI, -Math.PI / 2, 3.14]) {
      const result = solveKepler(m, 0);
      const norm = normAngle(m);
      expect(Math.abs(result - norm)).toBeLessThan(1e-12);
    }
  });

  it('high eccentricity e = 0.99 converges', () => {
    const result = solveKepler(Math.PI / 2, 0.99);
    const residual = Math.abs(result - 0.99 * Math.sin(result) - Math.PI / 2);
    expect(residual).toBeLessThan(1e-10);
  });

  it('large M values are normalised and solved correctly', () => {
    // M = 100π normalises to 0; solution should be 0 for e=0
    expect(Math.abs(solveKepler(100 * Math.PI, 0))).toBeLessThan(1e-12);
    // M = -10π normalises to 0
    expect(Math.abs(solveKepler(-10 * Math.PI, 0))).toBeLessThan(1e-12);
  });
});
