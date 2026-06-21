import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_DEFAULTS } from '../src/atmosphere';
import type { AtmosphereParams } from '../src/atmosphere';

describe('ATMOSPHERE_DEFAULTS (ADR-005 §3)', () => {
  it('matches the fixed Earth-like default table exactly', () => {
    expect(ATMOSPHERE_DEFAULTS.atmosphereRadiusScale).toBe(1.025);
    expect(ATMOSPHERE_DEFAULTS.betaMie).toBe(21e-3);
    expect(ATMOSPHERE_DEFAULTS.rayleighScaleHeight).toBe(0.25);
    expect(ATMOSPHERE_DEFAULTS.mieG).toBe(-0.758);
    expect(ATMOSPHERE_DEFAULTS.sunIntensity).toBe(20.0);
  });

  it('has the three canonical Rayleigh channels', () => {
    expect(ATMOSPHERE_DEFAULTS.betaRayleigh[0]).toBe(5.8e-3);
    expect(ATMOSPHERE_DEFAULTS.betaRayleigh[1]).toBe(13.5e-3);
    expect(ATMOSPHERE_DEFAULTS.betaRayleigh[2]).toBe(33.1e-3);
  });
});

describe('AtmosphereParams shape', () => {
  it('type-checks with only betaRayleigh set (every field optional)', () => {
    const params: AtmosphereParams = { betaRayleigh: [1, 2, 3] };
    expect(params.betaRayleigh).toEqual([1, 2, 3]);
  });

  it('type-checks as an empty literal (all defaults)', () => {
    const params: AtmosphereParams = {};
    expect(params).toEqual({});
  });

  it('rejects mutation of readonly fields (compile-time only)', () => {
    const params: AtmosphereParams = { mieG: -0.5 };
    // @ts-expect-error — readonly field cannot be reassigned
    params.mieG = 0.1;
    expect(params).toBeDefined();
  });
});
