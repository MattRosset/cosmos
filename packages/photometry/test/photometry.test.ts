import { describe, it, expect } from 'vitest';
import {
  NATURAL_VISIBILITY_PROFILE,
  SURVEY_VISIBILITY_PROFILE,
  STAR_PERCEPTIBILITY_FLOOR,
  STAR_RENDER_DEFAULTS,
  MIN_DISTANCE_PC,
  effectiveStarExposure,
  apparentMagnitude,
  sampleRenderedStar,
  starIsPerceptible,
  type StarExposureLayer,
  type RenderedStarInput,
} from '../src/index';

/**
 * Table-driven conformance for the extracted photometry primitives (TASK-097 step 4).
 *
 * These vectors are the CANONICAL numeric contract — TASK-097 step 8 says numeric CPU
 * vectors live ONLY here, never copied into the render-stars source-guard suite. Each row
 * logs its full input and every measured output so a CI-only failure is triagable from the
 * log alone (CLAUDE.md testing rule 6).
 *
 * All pinned literals below are hand-derived from the frozen shader math (stars.vert /
 * stars.frag) and asserted, NOT recomputed in the test with the production formula — a test
 * that replays the formula would drift with it instead of catching the drift.
 */

describe('effectiveStarExposure — profile × layer multipliers (ADR-007, frozen)', () => {
  const SLIDER = 25;
  // [profile, layer, slider, expected effective exposure]
  const rows: ReadonlyArray<
    readonly [
      profile: typeof NATURAL_VISIBILITY_PROFILE,
      profileName: string,
      layer: StarExposureLayer,
      expected: number,
    ]
  > = [
    [NATURAL_VISIBILITY_PROFILE, 'natural', 'galaxy-octree', 150], // 25 × 6
    [SURVEY_VISIBILITY_PROFILE, 'survey', 'galaxy-octree', 1000], // 25 × 40
    [NATURAL_VISIBILITY_PROFILE, 'natural', 'hyg', 25], // × 1
    [NATURAL_VISIBILITY_PROFILE, 'natural', 'exoplanet', 25], // × 1
    [NATURAL_VISIBILITY_PROFILE, 'natural', 'system', 25], // × 1
    [SURVEY_VISIBILITY_PROFILE, 'survey', 'hyg', 25], // × 1
    [SURVEY_VISIBILITY_PROFILE, 'survey', 'exoplanet', 25], // × 1
    [SURVEY_VISIBILITY_PROFILE, 'survey', 'system', 25], // × 1
  ];

  it.each(rows)('%s %s @ slider 25 → %d', (profile, profileName, layer, expected) => {
    const got = effectiveStarExposure(profile, layer, SLIDER);
    console.log(
      `[effectiveStarExposure] profile=${profileName} layer=${layer} slider=${SLIDER} ` +
        `→ ${got} (expect ${expected})`,
    );
    expect(got).toBe(expected);
  });
});

describe('sampleRenderedStar — frozen shader replay, pinned vectors', () => {
  it('exact floor boundary: brightness === 0.004 is perceptible (equality is visible)', () => {
    // absMag 0 @ 10pc → m=0 → flux=1, sNat=8 (unclamped), sizeDim=1; exposure = the floor.
    const input: RenderedStarInput = { absMag: 0, distancePc: 10, exposure: 0.004 };
    const s = sampleRenderedStar(input);
    console.log(
      `[sampleRenderedStar] floor-boundary in=${JSON.stringify(input)} → ` +
        `m=${s.apparentMagnitude} sNat=${s.naturalPointPx} sRen=${s.renderedPointPx} ` +
        `sizeDim=${s.sizeDim} flux=${s.clampedFlux} bri=${s.brightness} perc=${s.perceptible}`,
    );
    expect(s.apparentMagnitude).toBe(0);
    expect(s.clampedFlux).toBe(1);
    expect(s.naturalPointPx).toBe(8);
    expect(s.renderedPointPx).toBe(8);
    expect(s.sizeDim).toBe(1);
    // 1 * 0.004 * 1: multiply-by-1 is exact in IEEE-754, so this is bit-identical to the floor.
    expect(s.brightness).toBe(STAR_PERCEPTIBILITY_FLOOR);
    expect(s.perceptible).toBe(true);
    expect(starIsPerceptible(input)).toBe(true);
  });

  it('just below the floor is NOT perceptible', () => {
    const input: RenderedStarInput = { absMag: 0, distancePc: 10, exposure: 0.002 };
    const s = sampleRenderedStar(input);
    console.log(
      `[sampleRenderedStar] below-floor in=${JSON.stringify(input)} → ` +
        `bri=${s.brightness} floor=${STAR_PERCEPTIBILITY_FLOOR} perc=${s.perceptible}`,
    );
    expect(s.brightness).toBe(0.002);
    expect(s.perceptible).toBe(false);
    expect(starIsPerceptible(input)).toBe(false);
  });

  it('bright/near star: flux clamps to 1, 64px ceiling, sizeDim capped at 1 (no >1 boost)', () => {
    // absMag -5 @ 1pc → m=-10. flux wants 10^4, sNat wants 800: both clamp.
    const input: RenderedStarInput = { absMag: -5, distancePc: 1, exposure: 150 };
    const s = sampleRenderedStar(input);
    console.log(
      `[sampleRenderedStar] bright-clamp in=${JSON.stringify(input)} → ` +
        `m=${s.apparentMagnitude} sNat=${s.naturalPointPx} sRen=${s.renderedPointPx} ` +
        `sizeDim=${s.sizeDim} flux=${s.clampedFlux} bri=${s.brightness} perc=${s.perceptible}`,
    );
    expect(s.apparentMagnitude).toBe(-10);
    expect(s.clampedFlux).toBe(1); // flux clamp (was 10^4)
    expect(s.naturalPointPx).toBe(800);
    expect(s.renderedPointPx).toBe(STAR_RENDER_DEFAULTS.maxPointPx); // 64 ceiling
    expect(s.sizeDim).toBe(1); // (800/64)^2 = 156.25 → min(1, …) = 1, never >1
    expect(s.brightness).toBe(150); // 1 × 150 × 1
    expect(s.perceptible).toBe(true);
  });

  it('faint star: 3px floor clamp applies area dimming (sizeDim < 1)', () => {
    // absMag 15 @ 100pc → m=20. sNat = 8·10^-4 ≪ 3, so floor clamps up and flux must dim.
    const input: RenderedStarInput = { absMag: 15, distancePc: 100, exposure: 150 };
    const s = sampleRenderedStar(input);
    console.log(
      `[sampleRenderedStar] floor-dim in=${JSON.stringify(input)} → ` +
        `m=${s.apparentMagnitude} sNat=${s.naturalPointPx} sRen=${s.renderedPointPx} ` +
        `sizeDim=${s.sizeDim} flux=${s.clampedFlux} bri=${s.brightness} perc=${s.perceptible}`,
    );
    expect(s.apparentMagnitude).toBe(20);
    expect(s.naturalPointPx).toBeLessThan(STAR_RENDER_DEFAULTS.minPointPx);
    expect(s.renderedPointPx).toBe(STAR_RENDER_DEFAULTS.minPointPx); // 3px floor
    // The load-bearing (sNat/sRen)^2 dimming — dropping it recreates the shimmer bug.
    expect(s.sizeDim).toBeGreaterThan(0);
    expect(s.sizeDim).toBeLessThan(1);
    expect(s.perceptible).toBe(false); // dimmed sub-floor flux stays invisible
  });

  it('starIsPerceptible mirrors sampleRenderedStar.perceptible (thin call, not a 2nd formula)', () => {
    const cases: readonly RenderedStarInput[] = [
      { absMag: 0, distancePc: 10, exposure: 0.004 },
      { absMag: 0, distancePc: 10, exposure: 0.002 },
      { absMag: -5, distancePc: 1, exposure: 150 },
    ];
    for (const input of cases) {
      const viaSample = sampleRenderedStar(input).perceptible;
      const viaThin = starIsPerceptible(input);
      console.log(
        `[starIsPerceptible] in=${JSON.stringify(input)} sample=${viaSample} thin=${viaThin}`,
      );
      expect(viaThin).toBe(viaSample);
    }
  });
});

describe('apparentMagnitude — distance clamp at 0.001 pc', () => {
  const reference = apparentMagnitude(5, MIN_DISTANCE_PC);
  // Any distance at or below the clamp collapses to the reference magnitude.
  const rows: ReadonlyArray<readonly [label: string, distancePc: number]> = [
    ['exactly clamp', MIN_DISTANCE_PC],
    ['below clamp', 1e-9],
    ['zero', 0],
    ['negative', -100],
  ];

  it.each(rows)('absMag 5 @ %s (d=%p) equals the clamped reference', (label, distancePc) => {
    const got = apparentMagnitude(5, distancePc);
    console.log(
      `[apparentMagnitude] clamp ${label}: absMag=5 d=${distancePc} → m=${got} ` +
        `(reference m@0.001=${reference})`,
    );
    expect(got).toBe(reference);
  });

  it('distance above the clamp is NOT collapsed', () => {
    const near = apparentMagnitude(5, MIN_DISTANCE_PC);
    const far = apparentMagnitude(5, 10);
    console.log(`[apparentMagnitude] d=0.001 → ${near}; d=10 → ${far} (expect different)`);
    expect(far).not.toBe(near);
    expect(far).toBe(5); // 5 + 5·(log10(10) − 1) = 5
  });
});

describe('non-finite outputs are never reported perceptible', () => {
  const base = { absMag: 0, distancePc: 10 };
  // [label, input override, why the brightness/floor is non-finite]
  const rows: ReadonlyArray<readonly [label: string, input: RenderedStarInput]> = [
    ['NaN exposure', { ...base, exposure: NaN }],
    ['Infinite exposure', { ...base, exposure: Infinity }],
    ['NaN floor', { ...base, exposure: 150, perceptibilityFloor: NaN }],
    ['NaN absMag', { absMag: NaN, distancePc: 10, exposure: 150 }],
  ];

  it.each(rows)('%s → perceptible false', (label, input) => {
    const s = sampleRenderedStar(input);
    console.log(
      `[sampleRenderedStar] non-finite ${label}: in=${JSON.stringify(input)} → ` +
        `bri=${s.brightness} floor=${input.perceptibilityFloor ?? STAR_PERCEPTIBILITY_FLOOR} ` +
        `perc=${s.perceptible}`,
    );
    expect(s.perceptible).toBe(false);
  });

  it('−∞ absMag is infinitely bright → perceptible (kept), matching the tile-cull −∞ case', () => {
    // The tile wrapper (apps/web) keeps a −∞ tile via fail-open; here the SAME outcome is
    // emergent — a −∞ magnitude drives flux→1, size→64px, sizeDim→1, so brightness = exposure,
    // a finite value ≥ floor. The wrapper's explicit NaN/−∞ guards are tested in the app suite;
    // this package cannot import app glue (dependency contract), so we pin the primitive here.
    const input: RenderedStarInput = { absMag: Number.NEGATIVE_INFINITY, distancePc: 10, exposure: 150 };
    const s = sampleRenderedStar(input);
    console.log(
      `[sampleRenderedStar] neg-inf-absMag: in=${JSON.stringify(input)} → ` +
        `sNat=${s.naturalPointPx} sRen=${s.renderedPointPx} sizeDim=${s.sizeDim} ` +
        `flux=${s.clampedFlux} bri=${s.brightness} perc=${s.perceptible}`,
    );
    expect(s.renderedPointPx).toBe(STAR_RENDER_DEFAULTS.maxPointPx); // 64
    expect(s.sizeDim).toBe(1);
    expect(s.clampedFlux).toBe(1);
    expect(s.brightness).toBe(150);
    expect(s.perceptible).toBe(true);
  });
});
