import { describe, expect, it } from 'vitest';
import { createPrng } from '@cosmos/core-types';
import {
  sampleDiscRadius,
  sampleDiscHeight,
  sampleBulgeRadius,
  armPhase,
  armDensity,
  sampleArmAzimuth,
} from '../src/sampling.js';
import type { ArmParams } from '../src/sampling.js';

const ARM: ArmParams = {
  scaleLengthPc: 3500,
  armCount: 2,
  armPitchRad: 0.2304,
  armWindings: 1.0,
  armWidthPc: 1200,
  armContrast: 2.5,
};

describe('sampleDiscRadius', () => {
  it('stays within [0, radiusPc]', () => {
    for (let i = 0; i <= 1000; i++) {
      const r = sampleDiscRadius(i / 1001, 3500, 15000);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(15000 + 1e-6);
    }
  });

  it('u→0 gives r=0, u→1 gives the truncation radius', () => {
    expect(sampleDiscRadius(0, 3500, 15000)).toBeCloseTo(0, 9);
    expect(sampleDiscRadius(1, 3500, 15000)).toBeCloseTo(15000, 3);
  });

  it('histogram falls off ~exp(−r/L)', () => {
    // Counts in equal-width bins should drop by e per scale length.
    const L = 3500;
    const n = 200000;
    const c1 = countInBand(L, 2 * L, n);
    const c2 = countInBand(2 * L, 3 * L, n);
    // ratio ≈ exp(1) ignoring the (small) truncation effect; allow generous slack.
    expect(c1 / c2).toBeGreaterThan(2);
    expect(c1 / c2).toBeLessThan(3.4);
  });
});

function countInBand(lo: number, hi: number, n: number): number {
  let c = 0;
  for (let i = 0; i < n; i++) {
    const r = sampleDiscRadius((i + 0.5) / n, 3500, 15000);
    if (r >= lo && r < hi) c++;
  }
  return c;
}

describe('sampleDiscHeight', () => {
  it('is finite at the domain edges (u=0, u=1) and zero at u=0.5', () => {
    expect(Number.isFinite(sampleDiscHeight(0, 300))).toBe(true);
    expect(Number.isFinite(sampleDiscHeight(1, 300))).toBe(true);
    expect(sampleDiscHeight(0.5, 300)).toBeCloseTo(0, 9);
  });

  it('is antisymmetric about u=0.5', () => {
    expect(sampleDiscHeight(0.7, 300)).toBeCloseTo(-sampleDiscHeight(0.3, 300), 6);
  });
});

describe('sampleBulgeRadius', () => {
  it('is clamped to maxRadiusPc and non-negative', () => {
    for (let i = 0; i <= 1000; i++) {
      const r = sampleBulgeRadius(i / 1001, 1500, 15000);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(15000);
    }
    expect(sampleBulgeRadius(1e-12, 1500, 15000)).toBe(15000); // tiny u → clamp
  });
});

describe('armDensity', () => {
  it('is bounded by [1, armContrast]', () => {
    const r = 5000;
    for (let i = 0; i < 360; i++) {
      const m = armDensity((i / 360) * 2 * Math.PI, r, ARM);
      expect(m).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(m).toBeLessThanOrEqual(ARM.armContrast + 1e-9);
    }
  });

  it('peaks at the arm centres', () => {
    const r = 5000;
    const center = armPhase(r, ARM);
    const atCenter = armDensity(center, r, ARM);
    const atMid = armDensity(center + Math.PI / 2, r, ARM); // between two arms
    expect(atCenter).toBeGreaterThan(atMid);
    expect(atCenter).toBeCloseTo(ARM.armContrast, 1);
  });
});

describe('sampleArmAzimuth', () => {
  it('returns φ ∈ [0, 2π) and concentrates near arm centres', () => {
    const prng = createPrng(42);
    const r = 5000;
    const center = armPhase(r, ARM);
    let nearArm = 0;
    let minPhi = Infinity;
    let maxPhi = -Infinity;
    const n = 20000;
    // Accumulate the range invariant instead of two expect() calls per iteration:
    // 40k matcher invocations inside this hot loop made the test timing-sensitive
    // and flaky on loaded CI runners (2-core shared) near vitest's 5s cap. Assert
    // the min/max once after the loop — same invariant, ~200x fewer matcher calls.
    for (let i = 0; i < n; i++) {
      const phi = sampleArmAzimuth(prng.next, r, ARM);
      if (phi < minPhi) minPhi = phi;
      if (phi > maxPhi) maxPhi = phi;
      // distance to nearest arm (arms at center, center+π) wrapped to [0, π/2]
      const d = Math.min(
        wrapAbs(phi - center),
        wrapAbs(phi - center - Math.PI),
        wrapAbs(phi - center + Math.PI),
      );
      if (d < 0.4) nearArm++;
    }
    // φ ∈ [0, 2π) over every draw.
    expect(minPhi).toBeGreaterThanOrEqual(0);
    expect(maxPhi).toBeLessThan(2 * Math.PI + 1e-9);
    // Arm-concentrated, not uniform: a ±0.4 rad band around two arms covers
    // ~1.6/2π ≈ 25% of the circle uniformly; observed concentration is clearly
    // higher (density-wave arms are real).
    expect(nearArm / n).toBeGreaterThan(0.34);
  });

  it('terminates via the 64-attempt cap (accept-last) when nothing is accepted', () => {
    // Razor-thin arms ⇒ m ≈ 1 almost everywhere; a stream that always proposes a
    // non-arm φ with u just under the envelope (2.475 < 2.5 but > m≈1) is rejected
    // every attempt, exercising the accept-last fallback.
    const thinArms: ArmParams = { ...ARM, armWidthPc: 1 };
    let k = 0;
    const next = (): number => {
      k++;
      return k % 2 === 1 ? 0.123 : 0.99; // odd → φ candidate, even → high u
    };
    const phi = sampleArmAzimuth(next, 5000, thinArms);
    expect(Number.isFinite(phi)).toBe(true);
    expect(phi).toBeCloseTo(0.123 * 2 * Math.PI, 9); // the last candidate
    expect(k).toBe(128); // 64 attempts × 2 draws each
  });
});

function wrapAbs(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  else if (x < -Math.PI) x += 2 * Math.PI;
  return Math.abs(x);
}
