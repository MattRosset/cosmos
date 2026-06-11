import { describe, expect, it } from 'vitest';
import { bvToLinearRgb, buildBlackbodyLutData, LUT_SIZE } from '../src/blackbody.js';

describe('bvToLinearRgb', () => {
  it('hot blue star (bv = -0.3): blue channel > red', () => {
    const [r, , b] = bvToLinearRgb(-0.3);
    expect(b).toBeGreaterThan(r);
  });

  it('cool red star (bv = +1.5): red channel > blue', () => {
    const [r, , b] = bvToLinearRgb(1.5);
    expect(r).toBeGreaterThan(b);
  });

  it('sun-like star (bv = +0.6): all channels within 35% of each other', () => {
    const [r, g, b] = bvToLinearRgb(0.6);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    expect(max - min).toBeLessThanOrEqual(0.35);
  });

  it('all channels are finite and in [0, 1] across the full B-V range', () => {
    const bvValues = [-0.4, -0.3, 0.0, 0.3, 0.6, 1.0, 1.5, 2.0];
    for (const bv of bvValues) {
      const [r, g, b] = bvToLinearRgb(bv);
      for (const c of [r, g, b]) {
        expect(isFinite(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('buildBlackbodyLutData', () => {
  it(`produces ${LUT_SIZE} texels of RGBA (length = ${LUT_SIZE * 4})`, () => {
    const data = buildBlackbodyLutData();
    expect(data.length).toBe(LUT_SIZE * 4);
  });

  it('all byte values in [0, 255]', () => {
    const data = buildBlackbodyLutData();
    for (const v of data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it('alpha channel is always 255', () => {
    const data = buildBlackbodyLutData();
    for (let i = 0; i < LUT_SIZE; i++) {
      expect(data[i * 4 + 3]).toBe(255);
    }
  });

  it('low-index (hot) texel has blue ≥ red', () => {
    // index 0 → bv ≈ -0.4 (hottest)
    const data = buildBlackbodyLutData();
    expect(data[2]!).toBeGreaterThanOrEqual(data[0]!);
  });

  it('high-index (cool) texel has red ≥ blue', () => {
    // index 255 → bv ≈ 2.0 (coolest)
    const data = buildBlackbodyLutData();
    const last = (LUT_SIZE - 1) * 4;
    expect(data[last]!).toBeGreaterThanOrEqual(data[last + 2]!);
  });
});
