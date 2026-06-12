import { describe, expect, it } from 'vitest';
import { createPrng } from '@cosmos/core-types';
import type { KeplerElements } from '@cosmos/core-types';
import { orbitPolylineAu } from '../src/index.js';

const MU_SUN = 1.32712440018e11;
const J2000 = 2451545.0;

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

// ─── Basic shape ──────────────────────────────────────────────────────────────

describe('orbitPolylineAu — basic shape', () => {
  it('returns (segments + 1) × 3 floats for segments = 256', () => {
    const result = orbitPolylineAu(EARTH, 256);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(257 * 3);
  });

  it('last point equals first point (closed orbit)', () => {
    const result = orbitPolylineAu(EARTH, 256);
    const last = result.length - 3;
    expect(result[0]).toBeCloseTo(result[last + 0] as number, 5);
    expect(result[1]).toBeCloseTo(result[last + 1] as number, 5);
    expect(result[2]).toBeCloseTo(result[last + 2] as number, 5);
  });
});

// ─── Radius bounds ────────────────────────────────────────────────────────────

describe('orbitPolylineAu — radius bounds', () => {
  it('every point obeys [a(1−e), a(1+e)] radius bounds', () => {
    const result = orbitPolylineAu(EARTH, 256);
    const a = EARTH.semiMajorAxisAu;
    const e = EARTH.eccentricity;
    const rMin = a * (1 - e);
    const rMax = a * (1 + e);
    const EPS = 1e-5; // Float32 precision

    for (let k = 0; k <= 256; k++) {
      const idx = k * 3;
      const r = Math.hypot(result[idx]!, result[idx + 1]!, result[idx + 2]!);
      expect(r, `radius at k=${k}`).toBeGreaterThanOrEqual(rMin - EPS);
      expect(r, `radius at k=${k}`).toBeLessThanOrEqual(rMax + EPS);
    }
  });
});

// ─── out parameter ────────────────────────────────────────────────────────────

describe('orbitPolylineAu — out parameter', () => {
  it('returns the provided out array with same reference when length is correct', () => {
    const out = new Float32Array(257 * 3);
    const result = orbitPolylineAu(EARTH, 256, out);
    expect(result).toBe(out);
  });

  it('throws RangeError when out has wrong length', () => {
    const badOut = new Float32Array(256 * 3); // missing one point
    expect(() => orbitPolylineAu(EARTH, 256, badOut)).toThrow(RangeError);
  });

  it('throws RangeError when out is too long', () => {
    const badOut = new Float32Array(258 * 3);
    expect(() => orbitPolylineAu(EARTH, 256, badOut)).toThrow(RangeError);
  });

  it('allocates a new Float32Array when out is not provided', () => {
    const r1 = orbitPolylineAu(EARTH, 16);
    const r2 = orbitPolylineAu(EARTH, 16);
    expect(r1).not.toBe(r2);
  });
});

// ─── Seeded property test ─────────────────────────────────────────────────────

describe('orbitPolylineAu — seeded property test', () => {
  it('radius bounds hold for varied element sets', () => {
    const rng = createPrng(0x11223344);
    const EPS = 1e-5;

    for (let n = 0; n < 100; n++) {
      const semiMajorAxisAu = rng.range(0.5, 30);
      const eccentricity = rng.range(0, 0.98);
      const el: KeplerElements = {
        semiMajorAxisAu,
        eccentricity,
        inclinationRad: rng.range(0, Math.PI),
        ascendingNodeLongitudeRad: rng.range(0, 2 * Math.PI),
        argumentOfPeriapsisRad: rng.range(0, 2 * Math.PI),
        meanAnomalyAtEpochRad: rng.range(-Math.PI, Math.PI),
        epochJD: J2000,
        muKm3S2: MU_SUN,
      };

      const result = orbitPolylineAu(el, 64);
      const rMin = semiMajorAxisAu * (1 - eccentricity);
      const rMax = semiMajorAxisAu * (1 + eccentricity);

      for (let k = 0; k <= 64; k++) {
        const idx = k * 3;
        const r = Math.hypot(result[idx]!, result[idx + 1]!, result[idx + 2]!);
        expect(r, `case ${n}, k=${k}`).toBeGreaterThanOrEqual(rMin - EPS);
        expect(r, `case ${n}, k=${k}`).toBeLessThanOrEqual(rMax + EPS);
      }
    }
  });
});
