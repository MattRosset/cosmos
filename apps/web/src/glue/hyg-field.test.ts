import { describe, expect, it } from 'vitest';
import { computeHygFieldBounds } from './hyg-field';

/**
 * TASK-091. The teeth: `maxRadiusPc` must be the TRUE point radius from the cloud
 * centre, NOT the AABB half-diagonal (~√3× larger). The old inline `hygBounds` used
 * the diagonal, which leaves a 990–1715 pc shell where the grid walks empty rings.
 */
describe('computeHygFieldBounds', () => {
  // A ~990 pc-radius sphere of points centred at the origin, built on a lattice so the
  // extreme points sit ON the sphere (axis hits give the true radius; the AABB diagonal
  // would be ~990·√3 ≈ 1715).
  function sphereShell(radiusPc: number): { positions: Float32Array; count: number } {
    const pts: number[] = [];
    // 6 axis extrema at exactly ±radius (these define both the AABB and the true radius)…
    pts.push(radiusPc, 0, 0, -radiusPc, 0, 0);
    pts.push(0, radiusPc, 0, 0, -radiusPc, 0);
    pts.push(0, 0, radiusPc, 0, 0, -radiusPc);
    // …plus genuinely-interior filler (magnitude r ≤ radius, NOT r·√3) so the shell is
    // not a degenerate 6-point set and the true max radius stays the axis extrema.
    const invSqrt3 = 1 / Math.sqrt(3);
    for (let i = 1; i <= 5; i++) {
      const r = ((radiusPc * i) / 6) * invSqrt3;
      pts.push(r, r, r, -r, -r, -r);
    }
    return { positions: new Float32Array(pts), count: pts.length / 3 };
  }

  it('returns the true point radius (~990), NOT the AABB diagonal (~1715)', () => {
    const { positions, count } = sphereShell(990);
    const b = computeHygFieldBounds(positions, [0, 0, 0], count);
    expect(b.cx).toBeCloseTo(0, 6);
    expect(b.cy).toBeCloseTo(0, 6);
    expect(b.cz).toBeCloseTo(0, 6);
    // The fix's teeth: point radius, not diagonal.
    expect(b.maxRadiusPc).toBeCloseTo(990, 3);
    // Guard against a regression to the AABB half-diagonal (990·√3 ≈ 1714.8).
    expect(b.maxRadiusPc).toBeLessThan(1100);
  });

  it('handles an off-centre cloud (centre and radius both from the true centre)', () => {
    // Shell of radius 500 centred at (300, 0, 0).
    const base = sphereShell(500);
    const shifted = new Float32Array(base.positions.length);
    for (let i = 0; i < base.count; i++) {
      shifted[i * 3] = base.positions[i * 3]! + 300;
      shifted[i * 3 + 1] = base.positions[i * 3 + 1]!;
      shifted[i * 3 + 2] = base.positions[i * 3 + 2]!;
    }
    const b = computeHygFieldBounds(shifted, [0, 0, 0], base.count);
    expect(b.cx).toBeCloseTo(300, 3);
    expect(b.cy).toBeCloseTo(0, 6);
    expect(b.cz).toBeCloseTo(0, 6);
    expect(b.maxRadiusPc).toBeCloseTo(500, 3);
  });

  it('respects the tile origin (positions are tile-local, origin lifts to absolute)', () => {
    const { positions, count } = sphereShell(100);
    const b = computeHygFieldBounds(positions, [1000, -2000, 3000], count);
    expect(b.cx).toBeCloseTo(1000, 3);
    expect(b.cy).toBeCloseTo(-2000, 3);
    expect(b.cz).toBeCloseTo(3000, 3);
    expect(b.maxRadiusPc).toBeCloseTo(100, 3);
  });

  it('count === 0 → centre = origin, maxRadiusPc = 0', () => {
    const b = computeHygFieldBounds(new Float32Array(0), [5, 6, 7], 0);
    expect(b).toEqual({ cx: 5, cy: 6, cz: 7, maxRadiusPc: 0 });
  });
});
