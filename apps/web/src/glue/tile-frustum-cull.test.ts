import { describe, it, expect } from 'vitest';
import { tileOutsideFrustum } from './tile-frustum-cull';

/** Identity orientation — camera looks down −Z (StarScene convention). */
const IDENTITY: readonly [number, number, number, number] = [0, 0, 0, 1];

/**
 * 90° yaw about +Y: rotates world −Z into world −X (camera that was looking
 * down −Z now looks down −X). Quaternion [0, sin(π/4), 0, cos(π/4)].
 */
const YAW_90: readonly [number, number, number, number] = [
  0,
  Math.SQRT1_2,
  0,
  Math.SQRT1_2,
];

/** 60° vertical FOV, aspect 1 → tanY = tanX = tan(30°). */
const FOV_DEG = 60;
const ASPECT = 1;
const TAN_Y = Math.tan((FOV_DEG * Math.PI) / 360);
const TAN_X = TAN_Y * ASPECT;

describe('tileOutsideFrustum', () => {
  it('keeps a tile centered straight ahead (0,0,-100)', () => {
    const cx = 0;
    const cy = 0;
    const cz = -100;
    const radiusPc = 10;
    const out = tileOutsideFrustum(cx, cy, cz, radiusPc, IDENTITY, TAN_X, TAN_Y);
    console.log(
      `[tile-frustum-cull] ahead: center=(${cx},${cy},${cz}) r=${radiusPc} ` +
        `q=identity fov=${FOV_DEG} aspect=${ASPECT} → outside=${out}`,
    );
    expect(out).toBe(false);
  });

  it('culls a tile directly behind the camera (0,0,+100)', () => {
    const cx = 0;
    const cy = 0;
    const cz = 100;
    const radiusPc = 10;
    const out = tileOutsideFrustum(cx, cy, cz, radiusPc, IDENTITY, TAN_X, TAN_Y);
    console.log(
      `[tile-frustum-cull] behind: center=(${cx},${cy},${cz}) r=${radiusPc} ` +
        `q=identity → outside=${out}`,
    );
    expect(out).toBe(true);
  });

  it('culls a tile far off to the side (1000,0,-100)', () => {
    const cx = 1000;
    const cy = 0;
    const cz = -100;
    const radiusPc = 10;
    const out = tileOutsideFrustum(cx, cy, cz, radiusPc, IDENTITY, TAN_X, TAN_Y);
    console.log(
      `[tile-frustum-cull] lateral: center=(${cx},${cy},${cz}) r=${radiusPc} ` +
        `q=identity tanX=${TAN_X.toFixed(4)} → outside=${out}`,
    );
    expect(out).toBe(true);
  });

  it('KEEPS a tile whose CENTER is past the edge but RADIUS reaches into the frustum', () => {
    // At d=100, half-horizontal extent of the frustum is d*tanX ≈ 57.7.
    // Place center just past the right edge (ex = d*tanX + 5), with radius large
    // enough that the conservative √(1+tan²) sphere test still intersects.
    const d = 100;
    const cx = d * TAN_X + 5;
    const cy = 0;
    const cz = -d;
    const radiusPc = 40;
    const out = tileOutsideFrustum(cx, cy, cz, radiusPc, IDENTITY, TAN_X, TAN_Y);
    console.log(
      `[tile-frustum-cull] straddling-edge (anti-regression): center=(${cx.toFixed(2)},${cy},${cz}) ` +
        `r=${radiusPc} d*tanX=${(d * TAN_X).toFixed(2)} → outside=${out} (expect false/KEPT)`,
    );
    expect(out).toBe(false);
  });

  it('90°-yaw orientation moves the ahead tile to the side and culls it', () => {
    // Under identity, (0,0,-100) is ahead. After 90° yaw about +Y the camera looks
    // down −X, so the same world point sits off to the camera's right — culled.
    const cx = 0;
    const cy = 0;
    const cz = -100;
    const radiusPc = 10;
    const out = tileOutsideFrustum(cx, cy, cz, radiusPc, YAW_90, TAN_X, TAN_Y);
    console.log(
      `[tile-frustum-cull] yaw90: center=(${cx},${cy},${cz}) r=${radiusPc} ` +
        `q=yaw90 → outside=${out}`,
    );
    expect(out).toBe(true);
  });
});
