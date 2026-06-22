/**
 * Guided tour definitions + step→spline (TASK-052, §5.3/§5.12). A committed `Tour`
 * the user can start from the HUD; the app flies `nav` along a cinematic spline to
 * each step's target and (optionally) auto-orbits during the dwell.
 *
 * Splines carry `UniversePosition` keyframes so a path is interpolated in the active
 * context's frame and survives a context switch / floating-origin rebase (nav v5,
 * §5.3). The app resolves each `TourStep.targetId` to a world position and builds the
 * fly-to spline at step-change time.
 */
import type { CameraSpline, Tour, UniversePosition } from '@cosmos/core-types';

/** The committed grand tour: the Sun, its ringed giant, then a famous exoplanet system. */
export const GRAND_TOUR: Tour = {
  id: 'grand-tour',
  name: 'Grand tour: Sol → Saturn → TRAPPIST-1',
  steps: [
    {
      targetId: 'sol',
      title: 'The Sun',
      narration:
        'Our home star — a G-type main-sequence star holding the Solar System together. ' +
        'Every other point of light here is another sun, most far larger or smaller than ours.',
      dwellMs: 6000,
      orbit: true,
    },
    {
      targetId: 'sol:saturn',
      title: 'Saturn',
      narration:
        'The ringed giant: bands of ice and rock a few metres thick but spanning nearly ' +
        'the Earth–Moon distance. We descend into the Solar System to ride alongside it.',
      dwellMs: 7000,
      orbit: true,
    },
    {
      targetId: 'exo:trappist-1',
      title: 'TRAPPIST-1',
      narration:
        'A cool red dwarf 40 light-years away with seven Earth-sized worlds, several in ' +
        'the habitable zone — one of the most compact planetary systems known.',
      dwellMs: 8000,
      orbit: true,
    },
  ],
};

/** Arrival framing: stop this many context units short of the target along the approach. */
const ARRIVAL_FRACTION = 0.15;
/** Minimum stand-off (context units) so a spline to a coincident point still has length. */
const MIN_STANDOFF = 1e-3;

/**
 * Build a fly-to spline from the current camera to a target, framing the target rather
 * than flying through it. Both endpoints are `UniversePosition`s in the same context
 * (the app resolves the target into the current frame), so the path survives a switch.
 */
export function buildFlyToSpline(
  id: string,
  from: UniversePosition,
  target: UniversePosition,
  opts?: { readonly letterbox?: boolean; readonly durationMs?: number },
): CameraSpline {
  const context = from.context;
  const [fx, fy, fz] = from.local;
  const [tx, ty, tz] = target.local;
  const dx = tx - fx;
  const dy = ty - fy;
  const dz = tz - fz;
  const dist = Math.hypot(dx, dy, dz) || 1;
  const standoff = Math.max(dist * ARRIVAL_FRACTION, MIN_STANDOFF);
  const ux = dx / dist;
  const uy = dy / dist;
  const uz = dz / dist;
  // Arrival point: short of the target along the approach direction.
  const ax = tx - ux * standoff;
  const ay = ty - uy * standoff;
  const az = tz - uz * standoff;
  // Midpoint nudged off the straight line so centripetal Catmull-Rom has a real curve.
  const mx = (fx + ax) / 2 - uy * standoff * 1.5;
  const my = (fy + ay) / 2 + ux * standoff * 1.5;
  const mz = (fz + az) / 2;

  const duration = opts?.durationMs ?? 6000;
  const lookAt: UniversePosition = { context, local: [tx, ty, tz] };

  return {
    id,
    letterbox: opts?.letterbox ?? true,
    keyframes: [
      { at: { context, local: [fx, fy, fz] }, lookAt, timeMs: 0 },
      { at: { context, local: [mx, my, mz] }, lookAt, timeMs: duration * 0.5 },
      { at: { context, local: [ax, ay, az] }, lookAt, timeMs: duration },
    ],
  };
}
