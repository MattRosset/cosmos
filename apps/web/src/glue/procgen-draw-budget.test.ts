import { describe, it, expect } from 'vitest';
import { computeProcgenDrawFraction } from './procgen-draw-budget';

/**
 * TASK-071 acceptance gate #2: tier→budget→drawFraction is a pure, unit-testable mapping.
 * `high` never caps (Infinity budget must clamp to 1, never NaN); `medium`/`low` cap at
 * their fixed budgets; `count <= 0` must not divide-by-zero or blow up.
 */
describe('computeProcgenDrawFraction', () => {
  it('low tier caps the 1.11M-point Milky Way cloud to ~90k (≈0.081)', () => {
    const frac = computeProcgenDrawFraction('low', 1_110_000);
    expect(frac).toBeCloseTo(90_000 / 1_110_000, 5);
    expect(frac).toBeCloseTo(0.081, 3);
  });

  it('high tier always draws the full cloud (fraction 1), any count', () => {
    expect(computeProcgenDrawFraction('high', 1_000_000)).toBe(1);
    expect(computeProcgenDrawFraction('high', 1)).toBe(1);
    expect(computeProcgenDrawFraction('high', 10_000_000)).toBe(1);
  });

  it('high tier clamps Infinity / count to 1, never NaN, even at count 0', () => {
    const frac = computeProcgenDrawFraction('high', 0);
    expect(frac).toBe(1);
    expect(Number.isNaN(frac)).toBe(false);
  });

  it('medium tier boundary at exactly 250k draws in full', () => {
    expect(computeProcgenDrawFraction('medium', 250_000)).toBe(1);
  });

  it('medium tier caps above the 250k boundary', () => {
    const frac = computeProcgenDrawFraction('medium', 1_000_000);
    expect(frac).toBeCloseTo(250_000 / 1_000_000, 5);
  });

  it('low tier stays exactly 90_000 (shipped bug fix, load-bearing)', () => {
    expect(computeProcgenDrawFraction('low', 1_000_000)).toBeCloseTo(0.09, 5);
    expect(computeProcgenDrawFraction('low', 50_000)).toBe(1);
    expect(computeProcgenDrawFraction('low', 90_000)).toBe(1);
  });

  it('count=0 is safe for capped tiers (no NaN/Infinity, clamps to 1)', () => {
    expect(computeProcgenDrawFraction('low', 0)).toBe(1);
    expect(computeProcgenDrawFraction('medium', 0)).toBe(1);
  });

  it('negative count is safe (treated as a minimal positive count)', () => {
    const frac = computeProcgenDrawFraction('low', -5);
    expect(Number.isNaN(frac)).toBe(false);
    expect(frac).toBe(1);
  });
});
