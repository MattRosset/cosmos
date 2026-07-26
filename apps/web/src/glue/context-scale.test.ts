import { describe, expect, it } from 'vitest';
import { CONTEXT_UNIT_METERS } from '@cosmos/core-types';
import { pcScales } from './context-scale';

/**
 * TASK-081. The galaxy assertions are the bit-identical proof: the shader multiplies
 * gl_Position by uPcToUnits, and multiplying by exactly 1.0 is exact in IEEE-754. If
 * these ever become 0.9999999999999999, every galaxy-context baseline moves silently.
 */
describe('pcScales', () => {
  it('galaxy context is EXACTLY 1 in both directions (do not relax to toBeCloseTo)', () => {
    const s = pcScales('galaxy');
    expect(s.unitsToPc).toBe(1);
    expect(s.pcToUnits).toBe(1);
  });

  it('system context is the AU→pc ratio (~4.8481e-6)', () => {
    const { unitsToPc } = pcScales('system');
    // Exact against the repo's own constants — that is what the shader actually uses.
    expect(unitsToPc).toBe(CONTEXT_UNIT_METERS.system / CONTEXT_UNIT_METERS.galaxy);
    // Cross-check against the textbook AU-per-parsec only to a RELATIVE tolerance:
    // CONTEXT_UNIT_METERS.galaxy is a rounded parsec (3.0857e16 vs 3.0856776e16), so every
    // repo-derived ratio differs from the textbook value in the 6th significant digit.
    // ShaderJitterProbe.tsx:32 hardcodes the textbook 4.84813681e-6 and therefore disagrees
    // with this ratio at that level — harmless there, but do not "reconcile" them by
    // tightening this assertion.
    expect(Math.abs(unitsToPc / 4.84813681e-6 - 1)).toBeLessThan(1e-5);
  });

  it('universe context is exactly 1e6 parsecs per unit', () => {
    expect(pcScales('universe').unitsToPc).toBeCloseTo(1e6, 6);
  });

  it('planet context is the km→pc ratio', () => {
    expect(pcScales('planet').unitsToPc).toBe(
      CONTEXT_UNIT_METERS.planet / CONTEXT_UNIT_METERS.galaxy,
    );
  });

  it('pcToUnits is the reciprocal of unitsToPc in every context', () => {
    for (const ctx of ['universe', 'galaxy', 'system', 'planet'] as const) {
      const { unitsToPc, pcToUnits } = pcScales(ctx);
      expect(pcToUnits * unitsToPc).toBeCloseTo(1, 12);
    }
  });

  it('a system-context star at 1 pc maps to ~206,265 AU (the bug this fixes)', () => {
    // The defect was adding parsec positions to an AU offset. Sanity-check the bridge.
    // Relative tolerance, for the rounded-parsec reason documented above.
    expect(Math.abs(pcScales('system').pcToUnits / 206264.8 - 1)).toBeLessThan(1e-5);
  });
});
