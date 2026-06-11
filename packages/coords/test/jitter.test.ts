/**
 * TASK-006 — Phase 0 acceptance gate: the jitter test (ADR-001 §Consequences,
 * architecture §5.2). Simulated-projection version: the GPU f32 vertex path is
 * modeled with Math.fround, so the gate is deterministic on every machine.
 *
 * Scenario (FIXED by the gate — do not change the numbers):
 * - Marker: planet 8 kpc from galactic center — `{ context: 'galaxy', local: [8000, 0, 0] }`.
 * - Camera: orbits the marker at 1 AU radius (1 AU = 4.84813681e-6 pc),
 *   300 frames, one full revolution, `setCameraPosition` once per frame first.
 * - PASS: max deviation from the mean screen position < 0.5 px
 *   (fov 60°, 1920×1080, camera looking at the marker).
 * - CONTROL: the naive path — absolute galaxy-frame positions Math.fround-ed
 *   BEFORE camera subtraction — must FAIL the same gate. If the control ever
 *   passes, the test has lost its power: fix the test, never the gate.
 *
 * The projection below is self-contained f64 — no Three.js (coords tests stay
 * pure), no GPU. This numeric gate stays in the suite permanently; a rendered
 * Playwright variant arrives with the Phase 1 E2E harness.
 */
import { describe, expect, it } from 'vitest';
import type { UniversePosition } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '../src/index';
import type { Vec3Tuple } from '../src/index';

/** 1 AU expressed in parsecs — fixed by the task spec. */
const AU_PC = 4.84813681e-6;
const FRAMES = 300;
const VIEWPORT_W = 1920;
const VIEWPORT_H = 1080;
const FOV_DEG = 60; // vertical
const MAX_DEVIATION_PX = 0.5;

const MARKER: UniversePosition = { context: 'galaxy', local: [8000, 0, 0] };

const TAN_HALF_FOV = Math.tan((FOV_DEG * Math.PI) / 360);
const ASPECT = VIEWPORT_W / VIEWPORT_H;

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Plain f64 perspective projection. The camera sits at the render-space origin
 * (toRenderSpace output is camera-relative) looking at `target`; right-handed
 * look-at basis with up = +z — the orbit lies in the XY plane, so the view
 * direction is never parallel to up. Returns null when the point cannot be
 * projected (at or behind the camera) — the naive control can collapse the
 * marker onto the camera, which is exactly the catastrophic failure mode.
 */
function projectToScreen(point: Vec3Tuple, target: Vec3Tuple): ScreenPoint | null {
  const targetLen = Math.hypot(target[0], target[1], target[2]);
  if (targetLen === 0) return null;

  // View z axis points from the target to the eye (eye = origin).
  const zx = -target[0] / targetLen;
  const zy = -target[1] / targetLen;
  const zz = -target[2] / targetLen;

  // x = normalize(up × z), up = [0, 0, 1] → [-zy, zx, 0].
  const xLen = Math.hypot(zy, zx);
  if (xLen === 0) return null; // view direction parallel to up — cannot happen here
  const xx = -zy / xLen;
  const xy = zx / xLen;
  const xz = 0;

  // y = z × x.
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  const vx = point[0] * xx + point[1] * xy + point[2] * xz;
  const vy = point[0] * yx + point[1] * yy + point[2] * yz;
  const vz = point[0] * zx + point[1] * zy + point[2] * zz;
  if (vz >= 0) return null; // at or behind the camera

  const ndcX = vx / -vz / (TAN_HALF_FOV * ASPECT);
  const ndcY = vy / -vz / TAN_HALF_FOV;
  return {
    x: (ndcX + 1) * 0.5 * VIEWPORT_W,
    y: (1 - ndcY) * 0.5 * VIEWPORT_H,
  };
}

/** Mean screen position over the projectable frames. */
function meanScreenPoint(points: ReadonlyArray<ScreenPoint | null>): ScreenPoint {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const p of points) {
    if (p === null) continue;
    sx += p.x;
    sy += p.y;
    n += 1;
  }
  expect(n).toBeGreaterThan(0);
  return { x: sx / n, y: sy / n };
}

/** Max deviation from the mean; an unprojectable frame is an infinite deviation. */
function maxDeviationPx(points: ReadonlyArray<ScreenPoint | null>): number {
  const mean = meanScreenPoint(points);
  let max = 0;
  for (const p of points) {
    if (p === null) return Number.POSITIVE_INFINITY;
    max = Math.max(max, Math.hypot(p.x - mean.x, p.y - mean.y));
  }
  return max;
}

/**
 * Runs the fixed orbit once, recording BOTH paths against the same camera
 * sequence and the same f64 look-at:
 * - proper: f64 camera-relative subtraction via toRenderSpace, THEN fround
 *   (models the real pipeline: subtraction before downcast).
 * - naive:  absolute galaxy-frame positions frounded BEFORE the subtraction
 *   (models storing absolute positions in f32 anywhere — the banned bug class).
 */
function runOrbit(): {
  proper: Array<ScreenPoint | null>;
  naive: Array<ScreenPoint | null>;
} {
  const tree = createScaleFrameTree();
  const origin = createOriginManager(tree, {
    context: 'galaxy',
    local: [8000 + AU_PC, 0, 0],
  });

  const out: Vec3Tuple = [0, 0, 0];
  const proper: Array<ScreenPoint | null> = [];
  const naive: Array<ScreenPoint | null> = [];

  for (let frame = 0; frame < FRAMES; frame++) {
    const theta = (frame / FRAMES) * 2 * Math.PI;
    const camX = 8000 + AU_PC * Math.cos(theta);
    const camY = AU_PC * Math.sin(theta);

    // Frame start: exactly one camera update, like the real loop (rebases
    // are handled inside — none fire on a 1 AU orbit, by construction).
    origin.setCameraPosition({ context: 'galaxy', local: [camX, camY, 0] });

    // f64 camera-relative truth: the camera looks exactly at this point.
    origin.toRenderSpace(MARKER, out);
    const target: Vec3Tuple = [out[0], out[1], out[2]];

    // GPU f32 vertex path: downcast AFTER the f64 subtraction.
    const properF32: Vec3Tuple = [
      Math.fround(out[0]),
      Math.fround(out[1]),
      Math.fround(out[2]),
    ];
    proper.push(projectToScreen(properF32, target));

    // Naive control: absolute positions live in f32, subtraction in f32.
    const naiveF32: Vec3Tuple = [
      Math.fround(Math.fround(MARKER.local[0]) - Math.fround(camX)),
      Math.fround(Math.fround(MARKER.local[1]) - Math.fround(camY)),
      Math.fround(Math.fround(MARKER.local[2]) - Math.fround(0)),
    ];
    naive.push(projectToScreen(naiveF32, target));
  }

  return { proper, naive };
}

describe('jitter gate — camera orbits 1 AU around a marker 8 kpc out (TASK-006)', () => {
  const { proper, naive } = runOrbit();

  it('camera-relative f32 path is sub-pixel stable across 300 frames (< 0.5 px)', () => {
    // Every frame must project — the marker never leaves the view.
    for (const p of proper) expect(p).not.toBeNull();
    expect(maxDeviationPx(proper)).toBeLessThan(MAX_DEVIATION_PX);
  });

  it('keeps the marker at the screen center (look-at sanity)', () => {
    const mean = meanScreenPoint(proper);
    expect(Math.abs(mean.x - VIEWPORT_W / 2)).toBeLessThan(1);
    expect(Math.abs(mean.y - VIEWPORT_H / 2)).toBeLessThan(1);
  });

  it('CONTROL: naive absolute-f32 path FAILS the same gate (> 0.5 px) — test has power', () => {
    // If this assertion ever fails, the test lost its power to detect the
    // absolute-position-in-f32 bug class. Fix the test, not the gate.
    expect(maxDeviationPx(naive)).toBeGreaterThan(MAX_DEVIATION_PX);
  });
});
