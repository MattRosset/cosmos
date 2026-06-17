import { describe, expect, it, vi } from 'vitest';
import { hashCombine } from '@cosmos/core-types';
import { generateLocalGroup } from '../src/local-group';

describe('generateLocalGroup', () => {
  it('is deterministic — same params produce identical records', () => {
    const a = generateLocalGroup({ seed: 7 });
    const b = generateLocalGroup({ seed: 7 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(12); // default count
  });

  it('different seed produces different records', () => {
    const a = generateLocalGroup({ seed: 7 });
    const b = generateLocalGroup({ seed: 42 });
    expect(a[0]!.positionMpc).not.toEqual(b[0]!.positionMpc);
  });

  it('respects count and radiusMpc params', () => {
    const records = generateLocalGroup({ seed: 1, count: 5, radiusMpc: 2.0 });
    expect(records).toHaveLength(5);
    for (const r of records) {
      const dist = Math.hypot(...r.positionMpc);
      expect(dist).toBeLessThanOrEqual(2.0);
    }
  });

  it('each GalaxyRecord has finite positionMpc and radiusKpc', () => {
    const records = generateLocalGroup({ seed: 7 });
    for (const r of records) {
      expect(r.kind).toBe('galaxy');
      for (const v of r.positionMpc) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(Number.isFinite(r.radiusKpc)).toBe(true);
      expect(r.radiusKpc).toBeGreaterThan(0);
    }
  });

  it('each galaxy seed equals hashCombine(params.seed, index)', () => {
    const SEED = 7;
    const records = generateLocalGroup({ seed: SEED });
    records.forEach((r, i) => {
      expect(r.seed).toBe(hashCombine(SEED, i));
    });
  });

  it('all galaxies fit inside default radiusMpc (1.5 Mpc)', () => {
    const records = generateLocalGroup({ seed: 7 });
    for (const r of records) {
      const dist = Math.hypot(...r.positionMpc);
      expect(dist).toBeLessThanOrEqual(1.5);
    }
  });

  it('does not call Math.random — uses seeded PRNG only', () => {
    const spy = vi.spyOn(Math, 'random');
    generateLocalGroup({ seed: 7 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
