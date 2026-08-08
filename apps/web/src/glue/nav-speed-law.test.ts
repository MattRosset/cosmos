import { describe, expect, it } from 'vitest';
import { galaxyFarFieldSurfacePc } from './nav-speed-law';
import type { HygFieldBounds } from './hyg-field';

/**
 * TASK-091. `galaxyFarFieldSurfacePc` is the guard decision that replaces the magic
 * `distFromSolPc > 500` + `streaming.nearestBodyDistanceM` path. Contract:
 *  - outside the cloud (or during goTo) → a large O(1) cruising distance (NOT NaN);
 *  - inside/near the cloud → NaN sentinel (caller runs the HYG grid nearest-star).
 * These are the environment-independent teeth (the e2e park check is CI-toothless on
 * the sample pack — see TASK-091-NOTES).
 */
describe('galaxyFarFieldSurfacePc', () => {
  const bounds: HygFieldBounds = { cx: 0, cy: 0, cz: 0, maxRadiusPc: 990 };
  const MARGIN = 50;
  const MIN = 1e-7;

  it('far outside the cloud → cruising distance, NOT NaN (WASD-unstuck at a Gaia park)', () => {
    // The far Gaia park ~2835 pc from Sol: pre-fix this fed streaming-nearest ≈ 0.
    const s = galaxyFarFieldSurfacePc(2835, 0, 0, bounds, false, MARGIN, MIN);
    expect(Number.isNaN(s)).toBe(false);
    expect(s).toBeCloseTo(2835 - 990, 3); // 1845
    expect(s).toBeGreaterThan(100); // a real cruising scalar, not ~0
  });

  it('inside the cloud → NaN (caller falls through to the HYG grid)', () => {
    const s = galaxyFarFieldSurfacePc(300, 0, 0, bounds, false, MARGIN, MIN);
    expect(Number.isNaN(s)).toBe(true);
  });

  it('inside the cloud but goToActive → non-NaN clamped scalar (TASK-040 preserved)', () => {
    const s = galaxyFarFieldSurfacePc(300, 0, 0, bounds, true, MARGIN, MIN);
    expect(Number.isNaN(s)).toBe(false);
    // distToCloud = 300 - 990 = -690 → clamped to minPc.
    expect(s).toBe(MIN);
  });

  it('the NaN↔non-NaN transition flips at maxRadiusPc + marginPc', () => {
    // Just inside the margin band (distToCloud < margin) → NaN.
    const justInside = galaxyFarFieldSurfacePc(990 + 40, 0, 0, bounds, false, MARGIN, MIN);
    expect(Number.isNaN(justInside)).toBe(true);
    // Just past it (distToCloud > margin) → a real scalar.
    const justOutside = galaxyFarFieldSurfacePc(990 + 60, 0, 0, bounds, false, MARGIN, MIN);
    expect(Number.isNaN(justOutside)).toBe(false);
    expect(justOutside).toBeCloseTo(60, 3);
  });

  it('uses the cloud centre, not the origin (off-centre cloud)', () => {
    const off: HygFieldBounds = { cx: 300, cy: 0, cz: 0, maxRadiusPc: 500 };
    // Camera at (300,0,0) is the centre → deep inside → NaN.
    expect(Number.isNaN(galaxyFarFieldSurfacePc(300, 0, 0, off, false, MARGIN, MIN))).toBe(true);
    // Camera at (1000,0,0): distToCloud = 700 - 500 = 200 > margin → non-NaN ≈ 200.
    const s = galaxyFarFieldSurfacePc(1000, 0, 0, off, false, MARGIN, MIN);
    expect(s).toBeCloseTo(200, 3);
  });
});
