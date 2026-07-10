import { describe, expect, it } from 'vitest';
import { CONTEXT_UNIT_METERS } from '@cosmos/core-types';
import {
  formatEpochJD,
  formatOrbitalPeriod,
  formatSpeedKmS,
  formatLightTravel,
  formatEtaAtC,
  formatCrossingTime,
} from '../src/format';

/** Parse "…9.9×10¹³ km/s" back to a numeric km/s for order-of-magnitude asserts. */
function parseKmS(readout: string): number {
  const m = readout.match(/([\d.]+)(?:×10([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+))?\s*km\/s/);
  if (!m) throw new Error(`no km/s term in "${readout}"`);
  const mantissa = parseFloat(m[1] ?? '');
  if (!m[2]) return mantissa;
  const sup = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const exp = m[2]
    .split('')
    .map((ch) => (ch === '⁻' ? '-' : String(sup.indexOf(ch))))
    .join('');
  return mantissa * 10 ** Number(exp);
}

describe('formatSpeedKmS', () => {
  it('leads with the context unit label, km/s second', () => {
    const s = formatSpeedKmS(3.2, 'galaxy');
    expect(s.indexOf('pc/s')).toBeGreaterThanOrEqual(0);
    expect(s.indexOf('pc/s')).toBeLessThan(s.indexOf('km/s'));
  });

  it('converts galaxy pc/s → km/s by CONTEXT_UNIT_METERS', () => {
    const speed = 3.2;
    const expectedKmS = (speed * CONTEXT_UNIT_METERS.galaxy) / 1000;
    const got = parseKmS(formatSpeedKmS(speed, 'galaxy'));
    // within 1% — formatting rounds the mantissa
    expect(Math.abs(got - expectedKmS) / expectedKmS).toBeLessThan(0.01);
  });

  it('converts system AU/s → km/s by CONTEXT_UNIT_METERS', () => {
    const speed = 5;
    const expectedKmS = (speed * CONTEXT_UNIT_METERS.system) / 1000;
    const got = parseKmS(formatSpeedKmS(speed, 'system'));
    expect(Math.abs(got - expectedKmS) / expectedKmS).toBeLessThan(0.01);
    expect(formatSpeedKmS(speed, 'system')).toContain('AU/s');
  });

  it('drops the redundant km/s term in planet context (unit already km/s)', () => {
    const s = formatSpeedKmS(4, 'planet');
    expect(s).toContain('km/s');
    expect(s).not.toContain('·');
  });
});

describe('formatLightTravel', () => {
  it('≥1 ly reads in years', () => {
    expect(formatLightTravel(4.2)).toMatch(/years$/);
  });

  it('sub-year distance reads in light-<subunit>', () => {
    // Sun ≈ 8.3 light-minutes = 1.58e-5 ly
    expect(formatLightTravel(1.58e-5)).toMatch(/light-minutes$/);
  });

  it('scales monotonically with distance', () => {
    // both land in "years" → strip locale commas before comparing
    expect(pickYears(formatLightTravel(100))).toBeLessThan(pickYears(formatLightTravel(1000)));
  });
});

describe('formatEtaAtC', () => {
  it('prefixes "at c:" and matches light-travel time for years', () => {
    expect(formatEtaAtC(4.2)).toBe('at c: 4.2 years');
  });
});

describe('formatCrossingTime', () => {
  it('returns "—" when stationary', () => {
    expect(formatCrossingTime(0, 'galaxy', 3.0857e20)).toBe('—');
  });

  it('faster speed → shorter crossing time (same span)', () => {
    // Tiny speeds keep both results in "years" so the numeric compare is unit-stable.
    const span = 3.0857e20; // ~10 kpc in meters
    expect(formatCrossingTime(1e-8, 'galaxy', span)).toMatch(/years$/);
    expect(formatCrossingTime(1e-9, 'galaxy', span)).toMatch(/years$/);
    const fast = pickYears(formatCrossingTime(1e-8, 'galaxy', span));
    const slow = pickYears(formatCrossingTime(1e-9, 'galaxy', span));
    expect(fast).toBeLessThan(slow);
  });
});

/** Strip locale commas + unit suffix for a numeric compare (same-unit inputs only). */
function pickYears(s: string): number {
  return parseFloat(s.replace(/,/g, ''));
}

describe('formatter edge cases', () => {
  it('handles sub-unit magnitudes across the speed tiers', () => {
    expect(formatSpeedKmS(0.05, 'galaxy')).toContain('0.05'); // toFixed(2) tier
    expect(formatSpeedKmS(0.001, 'galaxy')).toContain('0.0010'); // toPrecision(2) tier
    expect(formatSpeedKmS(1500, 'universe')).toContain('Mpc/s'); // universe label + locale
  });

  it('renders sub-second light travel and zero-span crossing without NaN', () => {
    expect(formatLightTravel(1e-8)).toMatch(/light-seconds$/);
    expect(formatCrossingTime(1, 'galaxy', 0)).toBe('0 seconds');
  });

  it('degrades gracefully on non-finite inputs', () => {
    expect(formatSpeedKmS(Infinity, 'galaxy')).toContain('∞ km/s');
    expect(formatLightTravel(Infinity)).toContain('∞');
  });
});

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
