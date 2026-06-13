import { describe, expect, it } from 'vitest';
import { formatEpochJD, formatOrbitalPeriod } from '../src/format';

describe('formatEpochJD', () => {
  it('J2000.0 → 2000-01-01 12:00 UTC', () => {
    expect(formatEpochJD(2451545.0)).toBe('2000-01-01 12:00 UTC');
  });

  it('J2000.0 + 0.5 day → 2000-01-02 00:00 UTC', () => {
    expect(formatEpochJD(2451545.5)).toBe('2000-01-02 00:00 UTC');
  });

  it('returns string ending with " UTC"', () => {
    expect(formatEpochJD(2451545.0).endsWith(' UTC')).toBe(true);
  });

  it('matches format YYYY-MM-DD HH:MM UTC', () => {
    const result = formatEpochJD(2451545.0);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
  });
});

describe('formatOrbitalPeriod', () => {
  it('Saturn-like orbit (a=9.5826 AU, μ=1.32712440018e11) renders in years', () => {
    const result = formatOrbitalPeriod(9.5826, 1.32712440018e11);
    expect(result).toMatch(/yr$/);
    // ≈ 29-30 yr
    const num = parseFloat(result);
    expect(num).toBeGreaterThan(28);
    expect(num).toBeLessThan(31);
  });

  it('short orbit (< 1000 days) renders in days', () => {
    // Earth: a=1 AU, μ=1.32712440018e11 → ≈ 365 d
    const result = formatOrbitalPeriod(1, 1.32712440018e11);
    expect(result).toMatch(/d$/);
    const num = parseFloat(result);
    expect(num).toBeGreaterThan(360);
    expect(num).toBeLessThan(370);
  });

  it('uses 3 significant figures', () => {
    // Earth: should format to "365 d" (3 sig figs)
    const result = formatOrbitalPeriod(1, 1.32712440018e11);
    expect(result).toBe('365 d');
  });
});
