/**
 * Pure motion-law helpers for cinematic camera mode (§5.3 / §5.12, TASK-051).
 *
 * Stateless — the playback / auto-orbit state machine lives in `controller.ts`
 * (it needs the controller's camera/orientation closure), mirroring how the
 * `goTo` motion law splits into `goto.ts` (pure) + `controller.ts` (state).
 */

type Vec3 = [number, number, number];
type ReadonlyVec3 = readonly [number, number, number];

/** Default auto-orbit angular rate (rad/s) — a slow, cinematic sweep (§5.3). */
export const DEFAULT_ORBIT_RATE_PER_SEC = 0.1;

// ── Module-scoped scratch (Barry–Goldman pyramid — allocation-free) ───────────
const a1: Vec3 = [0, 0, 0];
const a2: Vec3 = [0, 0, 0];
const a3: Vec3 = [0, 0, 0];
const b1: Vec3 = [0, 0, 0];
const b2: Vec3 = [0, 0, 0];

const KNOT_EPS = 1e-30;

/**
 * Centripetal knot delta `|pb − pa|^0.5` (alpha = 0.5). Centripetal spacing is
 * the choice that avoids the cusps / self-intersections uniform Catmull-Rom
 * produces when keyframes are unevenly spaced — the §5.3 "linear/teleporting
 * spline at scale boundaries" failure. `|d|^0.5 = (|d|²)^0.25`.
 */
function knotDelta(pa: ReadonlyVec3, pb: ReadonlyVec3): number {
  const dx = pb[0] - pa[0];
  const dy = pb[1] - pa[1];
  const dz = pb[2] - pa[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  return Math.pow(d2, 0.25);
}

/**
 * Linear interpolation of pa→pb along the knot axis at `tt`, written into `out`.
 * Degenerate (coincident knots, ta ≈ tb) collapses to `pb` — the standard
 * Barry–Goldman handling for duplicated endpoint control points.
 */
function lerpKnot(
  pa: ReadonlyVec3,
  pb: ReadonlyVec3,
  ta: number,
  tb: number,
  tt: number,
  out: Vec3,
): void {
  const d = tb - ta;
  if (d <= KNOT_EPS) {
    out[0] = pb[0];
    out[1] = pb[1];
    out[2] = pb[2];
    return;
  }
  const w = (tt - ta) / d;
  const w0 = 1 - w;
  out[0] = w0 * pa[0] + w * pb[0];
  out[1] = w0 * pa[1] + w * pb[1];
  out[2] = w0 * pa[2] + w * pb[2];
}

/**
 * Centripetal Catmull-Rom (Barry–Goldman form) through the p1→p2 segment, with
 * p0/p3 supplying the tangents. `u ∈ [0,1]` is the local segment parameter.
 * Writes the interpolated point into `out`. Allocation-free.
 *
 * Endpoints duplicate their neighbour (p0 = p1 at the path start, p3 = p2 at the
 * end) — the knot guards above degrade those segments to a smooth one-sided
 * tangent rather than a cusp.
 */
export function catmullRomCentripetal(
  p0: ReadonlyVec3,
  p1: ReadonlyVec3,
  p2: ReadonlyVec3,
  p3: ReadonlyVec3,
  u: number,
  out: Vec3,
): void {
  const t0 = 0;
  const t1 = t0 + knotDelta(p0, p1);
  const t2 = t1 + knotDelta(p1, p2);
  const t3 = t2 + knotDelta(p2, p3);

  // If the whole control polygon is degenerate (all knots coincident) just
  // return p1 — there is no curve to evaluate.
  if (t2 - t1 <= KNOT_EPS) {
    out[0] = p1[0];
    out[1] = p1[1];
    out[2] = p1[2];
    return;
  }

  const tt = t1 + (t2 - t1) * u;

  lerpKnot(p0, p1, t0, t1, tt, a1);
  lerpKnot(p1, p2, t1, t2, tt, a2);
  lerpKnot(p2, p3, t2, t3, tt, a3);
  lerpKnot(a1, a2, t0, t2, tt, b1);
  lerpKnot(a2, a3, t1, t3, tt, b2);
  lerpKnot(b1, b2, t1, t2, tt, out);
}
