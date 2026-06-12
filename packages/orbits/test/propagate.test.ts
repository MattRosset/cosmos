import { describe, expect, it } from 'vitest';
import { createPrng } from '@cosmos/core-types';
import type { KeplerElements } from '@cosmos/core-types';
import {
  SECONDS_PER_DAY,
  ELEMENTS_STRIDE,
  elementsToPositionAu,
  packElements,
  propagateBatch,
  meanMotionRadPerS,
} from '../src/index.js';

const MU_SUN = 1.32712440018e11; // km³/s² — Sun's standard gravitational parameter
const J2000 = 2451545.0; // Julian Date of J2000.0 epoch

// ─── Reference element set (Earth-like) ──────────────────────────────────────

const EARTH: KeplerElements = {
  semiMajorAxisAu: 1.00000261,
  eccentricity: 0.01671123,
  inclinationRad: 0,
  ascendingNodeLongitudeRad: 0,
  argumentOfPeriapsisRad: 1.7966,
  meanAnomalyAtEpochRad: -0.0433,
  epochJD: J2000,
  muKm3S2: MU_SUN,
};

/** Orbital period in Julian days. */
function periodDays(el: KeplerElements): number {
  const n = meanMotionRadPerS(el.semiMajorAxisAu, el.muKm3S2);
  return (2 * Math.PI / n) / SECONDS_PER_DAY;
}

// ─── Circular sanity — hand-checkable oracle ──────────────────────────────────

describe('elementsToPositionAu — circular orbit sanity', () => {
  const CIRCULAR: KeplerElements = {
    semiMajorAxisAu: 1,
    eccentricity: 0,
    inclinationRad: 0,
    ascendingNodeLongitudeRad: 0,
    argumentOfPeriapsisRad: 0,
    meanAnomalyAtEpochRad: 0,
    epochJD: J2000,
    muKm3S2: MU_SUN,
  };

  const T = periodDays(CIRCULAR);

  it('at epoch position is [1, 0, 0] AU (periapsis)', () => {
    const out: [number, number, number] = [0, 0, 0];
    elementsToPositionAu(CIRCULAR, J2000, out);
    expect(Math.abs(out[0] - 1)).toBeLessThan(1e-6);
    expect(Math.abs(out[1])).toBeLessThan(1e-6);
    expect(Math.abs(out[2])).toBeLessThan(1e-6);
  });

  it('at +period/4 position is [0, 1, 0] AU', () => {
    const out: [number, number, number] = [0, 0, 0];
    elementsToPositionAu(CIRCULAR, J2000 + T / 4, out);
    expect(Math.abs(out[0])).toBeLessThan(1e-6);
    expect(Math.abs(out[1] - 1)).toBeLessThan(1e-6);
    expect(Math.abs(out[2])).toBeLessThan(1e-6);
  });

  it('at +period/2 position is [−1, 0, 0] AU', () => {
    const out: [number, number, number] = [0, 0, 0];
    elementsToPositionAu(CIRCULAR, J2000 + T / 2, out);
    expect(Math.abs(out[0] - -1)).toBeLessThan(1e-6);
    expect(Math.abs(out[1])).toBeLessThan(1e-6);
    expect(Math.abs(out[2])).toBeLessThan(1e-6);
  });
});

// ─── Inclination check ────────────────────────────────────────────────────────

describe('elementsToPositionAu — inclination', () => {
  const INCLINED: KeplerElements = {
    semiMajorAxisAu: 1,
    eccentricity: 0,
    inclinationRad: Math.PI / 2,
    ascendingNodeLongitudeRad: 0,
    argumentOfPeriapsisRad: 0,
    meanAnomalyAtEpochRad: 0,
    epochJD: J2000,
    muKm3S2: MU_SUN,
  };

  const T = periodDays(INCLINED);

  it('at +period/4 position is [0, 0, 1] AU (orbit tilted out of plane)', () => {
    const out: [number, number, number] = [0, 0, 0];
    elementsToPositionAu(INCLINED, J2000 + T / 4, out);
    expect(Math.abs(out[0])).toBeLessThan(1e-6);
    expect(Math.abs(out[1])).toBeLessThan(1e-6);
    expect(Math.abs(out[2] - 1)).toBeLessThan(1e-6);
  });
});

// ─── Geometry invariants (seeded PRNG, ≥ 500 element sets) ───────────────────

describe('elementsToPositionAu — geometry invariants', () => {
  it('|r| ∈ [a(1−e), a(1+e)] for ≥ 500 seeded element sets', () => {
    const rng = createPrng(0xabcdef01);
    const EPS = 1e-9;

    for (let n = 0; n < 500; n++) {
      const semiMajorAxisAu = rng.range(0.1, 50);
      const eccentricity = rng.range(0, 0.98);
      const el: KeplerElements = {
        semiMajorAxisAu,
        eccentricity,
        inclinationRad: rng.range(0, Math.PI),
        ascendingNodeLongitudeRad: rng.range(0, 2 * Math.PI),
        argumentOfPeriapsisRad: rng.range(0, 2 * Math.PI),
        meanAnomalyAtEpochRad: rng.range(-Math.PI, Math.PI),
        epochJD: J2000,
        muKm3S2: rng.range(1e8, 1e14),
      };

      const out: [number, number, number] = [0, 0, 0];
      elementsToPositionAu(el, J2000, out);
      const r = Math.hypot(out[0], out[1], out[2]);
      const rMin = semiMajorAxisAu * (1 - eccentricity);
      const rMax = semiMajorAxisAu * (1 + eccentricity);

      expect(r, `case ${n}: r=${r}, rMin=${rMin}, rMax=${rMax}`).toBeGreaterThanOrEqual(
        rMin - EPS,
      );
      expect(r, `case ${n}`).toBeLessThanOrEqual(rMax + EPS);
    }
  });

  it('position at epochJD + period equals position at epochJD (periodic) within 1e-9 relative AU', () => {
    const rng = createPrng(0x12345678);

    for (let n = 0; n < 500; n++) {
      const el: KeplerElements = {
        semiMajorAxisAu: rng.range(0.2, 30),
        eccentricity: rng.range(0, 0.95),
        inclinationRad: rng.range(0, Math.PI),
        ascendingNodeLongitudeRad: rng.range(0, 2 * Math.PI),
        argumentOfPeriapsisRad: rng.range(0, 2 * Math.PI),
        meanAnomalyAtEpochRad: rng.range(-Math.PI, Math.PI),
        epochJD: J2000,
        muKm3S2: MU_SUN,
      };

      const T = periodDays(el);
      const pos0: [number, number, number] = [0, 0, 0];
      const posT: [number, number, number] = [0, 0, 0];
      elementsToPositionAu(el, J2000, pos0);
      elementsToPositionAu(el, J2000 + T, posT);

      const r = Math.hypot(pos0[0], pos0[1], pos0[2]);
      const drift = Math.hypot(posT[0] - pos0[0], posT[1] - pos0[1], posT[2] - pos0[2]);

      expect(drift / r, `period drift at case ${n}`).toBeLessThan(1e-9);
    }
  });

  it('mirror symmetry: +Δt and −Δt from periapsis give z-symmetric positions for i=0', () => {
    // For i=0 the rotation matrix row for z has si=0, so z=0 always regardless of Ω/ω.
    // Positions at ±Δt are also equidistant from the focus (same |xPf|, |yPf| magnitude).
    const rng = createPrng(0xfedcba98);

    for (let n = 0; n < 500; n++) {
      const el: KeplerElements = {
        semiMajorAxisAu: rng.range(0.5, 10),
        eccentricity: rng.range(0, 0.9),
        inclinationRad: 0,
        ascendingNodeLongitudeRad: rng.range(0, 2 * Math.PI),
        argumentOfPeriapsisRad: rng.range(0, 2 * Math.PI),
        meanAnomalyAtEpochRad: 0, // start at periapsis
        epochJD: J2000,
        muKm3S2: MU_SUN,
      };

      const T = periodDays(el);
      const dt = T * rng.range(0.05, 0.45);

      const posPlus: [number, number, number] = [0, 0, 0];
      const posMinus: [number, number, number] = [0, 0, 0];
      elementsToPositionAu(el, J2000 + dt, posPlus);
      elementsToPositionAu(el, J2000 - dt, posMinus);

      // z=0 for both (z-symmetric about the orbital plane)
      expect(Math.abs(posPlus[2]), `z≈0 (+Δt) at case ${n}`).toBeLessThan(1e-12);
      expect(Math.abs(posMinus[2]), `z≈0 (−Δt) at case ${n}`).toBeLessThan(1e-12);

      // Same orbital radius at ±Δt (symmetry about the apsidal line)
      const rPlus = Math.hypot(posPlus[0], posPlus[1]);
      const rMinus = Math.hypot(posMinus[0], posMinus[1]);
      expect(Math.abs(rPlus - rMinus), `|r| symmetry at case ${n}`).toBeLessThan(1e-9);
    }
  });

  it('mirror symmetry: perifocal x/y for Ω=ω=0, i=0 — x same, y negated at ±Δt', () => {
    // With Ω=ω=0, element axes align with perifocal axes, so the symmetry is exact.
    const rng = createPrng(0x55aa55aa);

    for (let n = 0; n < 500; n++) {
      const el: KeplerElements = {
        semiMajorAxisAu: rng.range(0.5, 10),
        eccentricity: rng.range(0, 0.9),
        inclinationRad: 0,
        ascendingNodeLongitudeRad: 0,
        argumentOfPeriapsisRad: 0,
        meanAnomalyAtEpochRad: 0,
        epochJD: J2000,
        muKm3S2: MU_SUN,
      };

      const T = periodDays(el);
      const dt = T * rng.range(0.05, 0.45);

      const posPlus: [number, number, number] = [0, 0, 0];
      const posMinus: [number, number, number] = [0, 0, 0];
      elementsToPositionAu(el, J2000 + dt, posPlus);
      elementsToPositionAu(el, J2000 - dt, posMinus);

      expect(Math.abs(posPlus[0] - posMinus[0]), `x-symmetry at case ${n}`).toBeLessThan(1e-9);
      expect(Math.abs(posPlus[1] + posMinus[1]), `y-antisymmetry at case ${n}`).toBeLessThan(1e-9);
    }
  });
});

// ─── Zero-allocation: elementsToPositionAu returns same out reference ─────────

describe('elementsToPositionAu — zero allocation', () => {
  it('returns the same out tuple reference (same identity)', () => {
    const out: [number, number, number] = [0, 0, 0];
    const r1 = elementsToPositionAu(EARTH, J2000, out);
    expect(r1).toBe(out);
    const r2 = elementsToPositionAu(EARTH, J2000 + 365, out);
    expect(r2).toBe(out);
  });
});

// ─── e ≥ 1 throws RangeError ─────────────────────────────────────────────────

describe('elementsToPositionAu — invalid eccentricity', () => {
  it('throws RangeError for e = 1', () => {
    const el: KeplerElements = { ...EARTH, eccentricity: 1 };
    expect(() => elementsToPositionAu(el, J2000, [0, 0, 0])).toThrow(RangeError);
  });

  it('throws RangeError for e > 1', () => {
    const el: KeplerElements = { ...EARTH, eccentricity: 1.5 };
    expect(() => elementsToPositionAu(el, J2000, [0, 0, 0])).toThrow(RangeError);
  });
});

// ─── propagateBatch ───────────────────────────────────────────────────────────

describe('propagateBatch', () => {
  it('matches per-body elementsToPositionAu exactly for 50 seeded bodies', () => {
    const rng = createPrng(0x99887766);
    const count = 50;
    const elements: KeplerElements[] = Array.from({ length: count }, () => ({
      semiMajorAxisAu: rng.range(0.3, 20),
      eccentricity: rng.range(0, 0.9),
      inclinationRad: rng.range(0, Math.PI),
      ascendingNodeLongitudeRad: rng.range(0, 2 * Math.PI),
      argumentOfPeriapsisRad: rng.range(0, 2 * Math.PI),
      meanAnomalyAtEpochRad: rng.range(-Math.PI, Math.PI),
      epochJD: J2000,
      muKm3S2: MU_SUN,
    }));

    const packed = packElements(elements);
    const outBatch = new Float64Array(count * 3);
    const testEpoch = J2000 + 100;
    propagateBatch(packed, testEpoch, outBatch);

    for (let i = 0; i < count; i++) {
      const expected: [number, number, number] = [0, 0, 0];
      elementsToPositionAu(elements[i]!, testEpoch, expected);

      expect(outBatch[i * 3 + 0]).toBe(expected[0]);
      expect(outBatch[i * 3 + 1]).toBe(expected[1]);
      expect(outBatch[i * 3 + 2]).toBe(expected[2]);
    }
  });

  it('throws RangeError when outPositionsAu length does not match', () => {
    const packed = packElements([EARTH]);
    expect(() => propagateBatch(packed, J2000, new Float64Array(2))).toThrow(RangeError);
    expect(() => propagateBatch(packed, J2000, new Float64Array(4))).toThrow(RangeError);
  });

  it('ELEMENTS_STRIDE constant equals 8', () => {
    expect(ELEMENTS_STRIDE).toBe(8);
  });
});

// ─── packElements ─────────────────────────────────────────────────────────────

describe('packElements', () => {
  it('packs elements in declaration order', () => {
    const packed = packElements([EARTH]);
    expect(packed[0]).toBe(EARTH.semiMajorAxisAu);
    expect(packed[1]).toBe(EARTH.eccentricity);
    expect(packed[2]).toBe(EARTH.inclinationRad);
    expect(packed[3]).toBe(EARTH.ascendingNodeLongitudeRad);
    expect(packed[4]).toBe(EARTH.argumentOfPeriapsisRad);
    expect(packed[5]).toBe(EARTH.meanAnomalyAtEpochRad);
    expect(packed[6]).toBe(EARTH.epochJD);
    expect(packed[7]).toBe(EARTH.muKm3S2);
  });

  it('packs multiple elements with correct stride', () => {
    const elements = [EARTH, { ...EARTH, semiMajorAxisAu: 5.2 }];
    const packed = packElements(elements);
    expect(packed.length).toBe(2 * ELEMENTS_STRIDE);
    expect(packed[ELEMENTS_STRIDE]).toBe(5.2);
  });
});
