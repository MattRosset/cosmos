import { describe, expect, it } from 'vitest';
import {
  PROCGEN_GALAXY_DEFAULTS,
  PROCGEN_STREAM_JITTER,
  PROCGEN_STREAM_MASS,
  PROCGEN_STREAM_PLACEMENT,
} from '../src/procgen';
import { QUALITY_TIERS } from '../src/quality';

describe('PROCGEN_GALAXY_DEFAULTS', () => {
  it('matches ADR-004 §1 exactly', () => {
    expect(PROCGEN_GALAXY_DEFAULTS.discRadiusPc).toBe(15000);
    expect(PROCGEN_GALAXY_DEFAULTS.discScaleLengthPc).toBe(3500);
    expect(PROCGEN_GALAXY_DEFAULTS.discScaleHeightPc).toBe(300);
    expect(PROCGEN_GALAXY_DEFAULTS.armCount).toBe(2);
    expect(PROCGEN_GALAXY_DEFAULTS.armPitchRad).toBe(0.2304);
    expect(PROCGEN_GALAXY_DEFAULTS.armWindings).toBe(1.0);
    expect(PROCGEN_GALAXY_DEFAULTS.armWidthPc).toBe(1200);
    expect(PROCGEN_GALAXY_DEFAULTS.armContrast).toBe(2.5);
    expect(PROCGEN_GALAXY_DEFAULTS.bulgeFraction).toBe(0.18);
    expect(PROCGEN_GALAXY_DEFAULTS.bulgeRadiusPc).toBe(1500);
  });
});

describe('PROCGEN stream ids', () => {
  it('has fixed values 0, 1, 2', () => {
    expect(PROCGEN_STREAM_PLACEMENT).toBe(0);
    expect(PROCGEN_STREAM_MASS).toBe(1);
    expect(PROCGEN_STREAM_JITTER).toBe(2);
  });
});

describe('QUALITY_TIERS', () => {
  it('high tier has correct values', () => {
    expect(QUALITY_TIERS.high.tier).toBe('high');
    expect(QUALITY_TIERS.high.maxRenderedPoints).toBe(2_000_000);
    expect(QUALITY_TIERS.high.bloomEnabled).toBe(true);
    expect(QUALITY_TIERS.high.atmosphereEnabled).toBe(true);
    expect(QUALITY_TIERS.high.resolutionScale).toBe(1);
  });

  it('low tier has bloom and atmosphere disabled', () => {
    expect(QUALITY_TIERS.low.bloomEnabled).toBe(false);
    expect(QUALITY_TIERS.low.atmosphereEnabled).toBe(false);
  });

  it('tiers are ordered high ≥ medium ≥ low on maxRenderedPoints', () => {
    expect(QUALITY_TIERS.high.maxRenderedPoints).toBeGreaterThanOrEqual(
      QUALITY_TIERS.medium.maxRenderedPoints,
    );
    expect(QUALITY_TIERS.medium.maxRenderedPoints).toBeGreaterThanOrEqual(
      QUALITY_TIERS.low.maxRenderedPoints,
    );
  });

  it('tiers are ordered high ≥ medium ≥ low on resolutionScale', () => {
    expect(QUALITY_TIERS.high.resolutionScale).toBeGreaterThanOrEqual(
      QUALITY_TIERS.medium.resolutionScale,
    );
    expect(QUALITY_TIERS.medium.resolutionScale).toBeGreaterThanOrEqual(
      QUALITY_TIERS.low.resolutionScale,
    );
  });

  it('all resolutionScale values are in (0, 1]', () => {
    for (const tier of Object.values(QUALITY_TIERS)) {
      expect(tier.resolutionScale).toBeGreaterThan(0);
      expect(tier.resolutionScale).toBeLessThanOrEqual(1);
    }
  });
});
