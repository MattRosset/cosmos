import { describe, expect, it } from 'vitest';
import {
  EARTH_RADIUS_KM,
  HABITABLE_ZONE_AU,
  NAKED_EYE_LIMIT_MAG,
  apparentMagnitude,
  habitableZoneHint,
  nakedEyeVisibility,
  orbitInHumanTerms,
  radiusVsEarth,
  spectralPlainLanguage,
  spectralTint,
} from '../src/astro-derive';
import { orbitalPeriodDays } from '../src/format';
import { STRINGS } from '../src/strings';

/** GM of the Sun, km³/s² — the μ every Sol-planet fixture uses. */
const MU_SUN = 1.32712440018e11;

describe('spectralPlainLanguage (C1)', () => {
  it.each([
    [-0.2, STRINGS.spectralPlainB],
    [0.1, STRINGS.spectralPlainA],
    [0.4, STRINGS.spectralPlainF],
    [0.65, STRINGS.spectralPlainG], // Sol-like B−V → "similar to the Sun"
    [1.0, STRINGS.spectralPlainK],
    [1.6, STRINGS.spectralPlainM],
  ])('bv=%f → the fixed class line', (bv, expected) => {
    expect(spectralPlainLanguage(bv)).toBe(expected);
    expect(expected).toContain('Sun');
  });

  it('Sol-like B−V reads "similar to the Sun"', () => {
    expect(spectralPlainLanguage(0.65)).toContain('similar to the Sun');
  });

  it('an explicit spectral class wins over B−V', () => {
    expect(spectralPlainLanguage(1.6, 'G2V')).toBe(STRINGS.spectralPlainG);
  });

  it('unknown class letter falls back to B−V; both missing → null', () => {
    expect(spectralPlainLanguage(0.65, 'X')).toBe(STRINGS.spectralPlainG);
    expect(spectralPlainLanguage(null)).toBeNull();
    expect(spectralPlainLanguage(NaN, 'Z9')).toBeNull();
  });
});

describe('apparentMagnitude (C2 input)', () => {
  it('m = M at exactly 10 pc', () => {
    expect(apparentMagnitude(1.45, 10)).toBeCloseTo(1.45, 10);
  });

  it('Sirius: M=1.45 at 2.65 pc → m ≈ −1.44', () => {
    expect(apparentMagnitude(1.45, 2.65)).toBeCloseTo(-1.43, 1);
  });

  it('null on zero/negative/non-finite distance or magnitude', () => {
    expect(apparentMagnitude(1, 0)).toBeNull();
    expect(apparentMagnitude(1, -3)).toBeNull();
    expect(apparentMagnitude(1, NaN)).toBeNull();
    expect(apparentMagnitude(NaN, 10)).toBeNull();
  });
});

describe('nakedEyeVisibility (C2)', () => {
  it.each([
    [-1.4, STRINGS.visibilityNakedEye], // Sirius
    [NAKED_EYE_LIMIT_MAG, STRINGS.visibilityNakedEye], // boundary inclusive
    [NAKED_EYE_LIMIT_MAG + 0.01, STRINGS.visibilityTelescope],
    [12, STRINGS.visibilityTelescope],
  ])('mag=%f → verdict', (mag, expected) => {
    expect(nakedEyeVisibility(mag)).toBe(expected);
  });

  it('null in → null out', () => {
    expect(nakedEyeVisibility(null)).toBeNull();
    expect(nakedEyeVisibility(NaN)).toBeNull();
  });
});

describe('radiusVsEarth (C4)', () => {
  it('Earth itself → ratio 1, "1× Earth"', () => {
    expect(radiusVsEarth(EARTH_RADIUS_KM)).toEqual({ ratio: 1, label: '1× Earth' });
  });

  it('Saturn (58 232 km) → ratio ≈ 9.14, label "9.14× Earth"', () => {
    const r = radiusVsEarth(58_232);
    expect(r).not.toBeNull();
    expect(r!.ratio).toBeCloseTo(9.14, 2);
    expect(r!.label).toBe('9.14× Earth');
  });

  it('sub-Earth radius keeps significant digits ("0.38× Earth")', () => {
    expect(radiusVsEarth(2439.7)!.label).toBe('0.383× Earth'); // Mercury
  });

  it('null on zero/negative/non-finite radius', () => {
    expect(radiusVsEarth(0)).toBeNull();
    expect(radiusVsEarth(-1)).toBeNull();
    expect(radiusVsEarth(NaN)).toBeNull();
    expect(radiusVsEarth(Infinity)).toBeNull();
  });
});

describe('orbitInHumanTerms (C5) — fed by format.ts orbitalPeriodDays', () => {
  it('Mercury (a=0.387 AU) → "88-day year", self-comparison suppressed', () => {
    const days = orbitalPeriodDays(0.387, MU_SUN);
    expect(days).toBeGreaterThan(85);
    expect(days).toBeLessThan(91);
    const line = orbitInHumanTerms(days, 0.387);
    expect(line).toContain('-day year');
    expect(line).toMatch(/^8[78](\.\d+)?-day year$/);
    expect(line).not.toContain('like Mercury');
  });

  it('an exoplanet with a Mercury-like period gets the comparison tail', () => {
    // 85-day year around a lighter star (different a) → not "self".
    expect(orbitInHumanTerms(85, 0.3)).toBe(`85${STRINGS.orbitDayYearSuffix}${STRINGS.orbitLikeMercury}`);
  });

  it('Saturn (a=9.5826 AU) → "-year orbit", self-comparison suppressed', () => {
    const days = orbitalPeriodDays(9.5826, MU_SUN);
    const line = orbitInHumanTerms(days, 9.5826);
    expect(line).toMatch(/^29\.\d+-year orbit$/);
    expect(line).not.toContain('like Saturn');
  });

  it('a period near no anchor gets no tail', () => {
    expect(orbitInHumanTerms(1600, 2.6)).toBe(`4.38${STRINGS.orbitYearOrbitSuffix}`);
  });

  it('null on zero/negative/non-finite period', () => {
    expect(orbitInHumanTerms(0, 1)).toBeNull();
    expect(orbitInHumanTerms(-5, 1)).toBeNull();
    expect(orbitInHumanTerms(NaN, 1)).toBeNull();
  });
});

describe('habitableZoneHint (C5)', () => {
  it('Earth (a=1, Sun-like bv) → the hint', () => {
    expect(habitableZoneHint(1, 0.65)).toBe(STRINGS.hzHint);
  });

  it.each([
    [0.387, 0.65], // Mercury: too close
    [9.58, 0.65], // Saturn: too far
    [1, -0.2], // B star: class omitted from the table
    [1, null], // no parent B−V
    [NaN, 0.65],
    [0, 0.65],
  ])('a=%s, bv=%s → null', (a, bv) => {
    expect(habitableZoneHint(a as number, bv as number | null)).toBeNull();
  });

  it('zone bounds are inclusive', () => {
    const [inner, outer] = HABITABLE_ZONE_AU.G!;
    expect(habitableZoneHint(inner, 0.65)).toBe(STRINGS.hzHint);
    expect(habitableZoneHint(outer, 0.65)).toBe(STRINGS.hzHint);
  });
});

describe('spectralTint (C7)', () => {
  it('returns a CSS hex color per class, warm for M, cool for B', () => {
    const g = spectralTint(0.65);
    const b = spectralTint(-0.2);
    const m = spectralTint(1.8);
    for (const c of [g, b, m]) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    expect(b).not.toBe(m);
  });

  it('null on missing/non-finite B−V', () => {
    expect(spectralTint(null)).toBeNull();
    expect(spectralTint(NaN)).toBeNull();
  });
});

describe('total-function invariant — never the strings "NaN"/"undefined"/"null"', () => {
  const GARBAGE = [NaN, Infinity, -Infinity, 0, -1, 1e300, null] as const;

  it('every derivation returns null or clean copy for every garbage input', () => {
    const outputs: (string | number | { label: string } | null)[] = [];
    for (const a of GARBAGE) {
      for (const b of GARBAGE) {
        const an = a as number;
        const bn = b as number;
        outputs.push(
          spectralPlainLanguage(a as number | null, b === null ? null : String(b)),
          apparentMagnitude(an, bn),
          nakedEyeVisibility(a as number | null),
          radiusVsEarth(an),
          orbitInHumanTerms(an, bn),
          habitableZoneHint(an, b as number | null),
          spectralTint(a as number | null),
        );
      }
    }
    for (const out of outputs) {
      if (out === null) continue;
      const text = typeof out === 'object' ? out.label : String(out);
      expect(text).not.toContain('NaN');
      expect(text).not.toContain('undefined');
      expect(text).not.toContain('null');
      if (typeof out === 'number') expect(Number.isFinite(out)).toBe(true);
    }
  });
});
