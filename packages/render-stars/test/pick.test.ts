import { describe, expect, it } from 'vitest';
import { createPrng } from '@cosmos/core-types';
import type { StarBatch } from '@cosmos/core-types';
import { pickStar } from '../src/pick.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBatch(count: number, seed: number): StarBatch {
  const rng = createPrng(seed);
  const positionsPc = new Float32Array(count * 3);
  const absMag = new Float32Array(count);
  const colorIndexBV = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positionsPc[i * 3] = rng.range(-100, 100);
    positionsPc[i * 3 + 1] = rng.range(-100, 100);
    positionsPc[i * 3 + 2] = rng.range(-100, 100);
    absMag[i] = rng.range(-5, 15);
    colorIndexBV[i] = rng.range(-0.4, 2.0);
  }
  return {
    count,
    originPc: [0, 0, 0],
    positionsPc,
    absMag,
    colorIndexBV,
    catalogIds: new Uint32Array(count),
    hipIds: new Uint32Array(count),
    idPrefix: 'test',
  };
}

/** Brute-force reference implementation (same algorithm, written independently). */
function brutePickStar(
  batch: StarBatch,
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
  maxAngle: number,
) {
  const [ox, oy, oz] = origin;
  const [dx, dy, dz] = dir;
  let bestIdx = -1;
  let bestAngle = maxAngle;
  let bestDist = Infinity;
  for (let i = 0; i < batch.count; i++) {
    const sx = batch.positionsPc[i * 3]! - ox;
    const sy = batch.positionsPc[i * 3 + 1]! - oy;
    const sz = batch.positionsPc[i * 3 + 2]! - oz;
    const dist = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (dist === 0) continue;
    const cos = (dx * sx + dy * sy + dz * sz) / dist;
    const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (angle < bestAngle || (angle === bestAngle && dist < bestDist)) {
      bestAngle = angle;
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx < 0 ? null : { index: bestIdx, distancePc: bestDist, angleRad: bestAngle };
}

function normalize(v: readonly [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pickStar', () => {
  it('exact-aim at a star returns that star with angleRad ≈ 0', () => {
    const batch = makeBatch(50, 1);
    const targetIdx = 10;
    const sx = batch.positionsPc[targetIdx * 3]!;
    const sy = batch.positionsPc[targetIdx * 3 + 1]!;
    const sz = batch.positionsPc[targetIdx * 3 + 2]!;
    const dir = normalize([sx, sy, sz]);
    const hit = pickStar(batch, [0, 0, 0], dir, Math.PI);
    expect(hit).not.toBeNull();
    expect(hit!.index).toBe(targetIdx);
    expect(hit!.angleRad).toBeCloseTo(0, 10);
  });

  it('two stars 0.5° apart: ray between them chooses smaller-angle star', () => {
    const batch: StarBatch = {
      count: 2,
      originPc: [0, 0, 0],
      positionsPc: new Float32Array([
        0, 0, 100, // star 0 — straight ahead
        1, 0, 100, // star 1 — slightly right
      ]),
      absMag: new Float32Array([5, 5]),
      colorIndexBV: new Float32Array([0.6, 0.6]),
      catalogIds: new Uint32Array(2),
      hipIds: new Uint32Array(2),
      idPrefix: 'test',
    };
    // Ray aimed closer to star 0 (at x=0.3, so closer to 0 than to 1)
    const dir = normalize([0.3, 0, 100]);
    const hit = pickStar(batch, [0, 0, 0], dir, Math.PI);
    expect(hit?.index).toBe(0);
  });

  it('returns null when no star is within maxAngleRad', () => {
    // Single star at [100, 0, 0]; ray aimed at [0, 0, 1] (perpendicular, ~90° away).
    const batch: StarBatch = {
      count: 1,
      originPc: [0, 0, 0],
      positionsPc: new Float32Array([100, 0, 0]),
      absMag: new Float32Array([5]),
      colorIndexBV: new Float32Array([0.6]),
      catalogIds: new Uint32Array(1),
      hipIds: new Uint32Array(1),
      idPrefix: 'test',
    };
    const hit = pickStar(batch, [0, 0, 0], [0, 0, 1], 0.01);
    expect(hit).toBeNull();
  });

  it('tie in angle: nearer star wins', () => {
    // Two stars at the same angle, different distances — nearer should win.
    const batch: StarBatch = {
      count: 2,
      originPc: [0, 0, 0],
      positionsPc: new Float32Array([
        0, 0, 10, // star 0 — 10 pc
        0, 0, 100, // star 1 — 100 pc
      ]),
      absMag: new Float32Array([5, 5]),
      colorIndexBV: new Float32Array([0.6, 0.6]),
      catalogIds: new Uint32Array(2),
      hipIds: new Uint32Array(2),
      idPrefix: 'test',
    };
    // Both stars are exactly on the +z axis, so the ray aimed at [0,0,1] hits both
    // with angle = 0. Nearer (index 0, dist 10) should win.
    const hit = pickStar(batch, [0, 0, 0], [0, 0, 1], Math.PI);
    expect(hit?.index).toBe(0);
    expect(hit?.distancePc).toBeCloseTo(10, 5);
  });

  it('property test: pickStar matches brute force for ≥ 500 random cases', () => {
    const rng = createPrng(42);
    let cases = 0;
    for (let trial = 0; trial < 500; trial++) {
      const count = rng.int(1, 30);
      const batch = makeBatch(count, rng.int(0, 0xffffff));
      const maxAngle = rng.range(0.01, Math.PI);
      // Random ray direction
      const dir = normalize([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)]);
      const origin: [number, number, number] = [0, 0, 0];

      const result = pickStar(batch, origin, dir, maxAngle);
      const ref = brutePickStar(batch, origin, dir, maxAngle);

      if (ref === null) {
        expect(result).toBeNull();
      } else {
        expect(result).not.toBeNull();
        expect(result!.index).toBe(ref.index);
        expect(result!.distancePc).toBeCloseTo(ref.distancePc, 8);
        expect(result!.angleRad).toBeCloseTo(ref.angleRad, 8);
      }
      cases++;
    }
    expect(cases).toBeGreaterThanOrEqual(500);
  });
});
