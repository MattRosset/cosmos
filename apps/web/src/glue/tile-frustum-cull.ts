/**
 * Per-tile frustum cull predicate (TASK-093).
 *
 * Pure, DOM/THREE-free — lives under `src/glue/**` so the node-env vitest scope
 * can exercise it directly (same pattern as `procgen-draw-budget.ts`).
 *
 * three.js `frustumCulled` is deliberately false on every octree mount: the
 * vertex shader positions each tile via `uRenderOffset`, so three's bounding
 * sphere reads every tile as at the origin. This predicate uses the
 * camera-relative tile center the render loop already computes, rotated into
 * camera space by the controller orientation's conjugate — the same convention
 * as `StarScene.projectToScreen`.
 */

/**
 * True ⇒ the tile's bounding sphere is ENTIRELY outside the view frustum (safe to skip
 * drawing). Conservative: never returns true for a sphere that touches the frustum, so a
 * tile straddling an edge is kept. Allocation-free (scalar math, no arrays).
 *
 * @param cx,cy,cz  camera-relative tile CENTER in the context frame (parsecs).
 * @param radiusPc  tile bounding-sphere radius (= halfExtentPc * Math.sqrt(3)).
 * @param q         camera orientation quaternion [x,y,z,w] (controller.state.orientation).
 * @param tanX,tanY tan of the HALF horizontal/vertical fov (tanY = tan(fov·π/360),
 *                  tanX = tanY·aspect).
 */
export function tileOutsideFrustum(
  cx: number,
  cy: number,
  cz: number,
  radiusPc: number,
  q: readonly [number, number, number, number],
  tanX: number,
  tanY: number,
): boolean {
  // Rotate (cx,cy,cz) by the conjugate [-qx,-qy,-qz,qw] into camera space.
  // Inline of StarScene's rotateByQuat, writing into locals (no array).
  const qx = -q[0];
  const qy = -q[1];
  const qz = -q[2];
  const qw = q[3];
  const tx = 2 * (qy * cz - qz * cy);
  const ty = 2 * (qz * cx - qx * cz);
  const tz = 2 * (qx * cy - qy * cx);
  const ex = cx + qw * tx + (qy * tz - qz * ty);
  const ey = cy + qw * ty + (qz * tx - qx * tz);
  const ez = cz + qw * tz + (qx * ty - qy * tx);

  // Forward is -Z ⇒ view depth d = -ez.
  const d = -ez;

  // Behind plane: sphere entirely behind the camera.
  if (d < -radiusPc) return true;

  // Side planes — √(1+tan²) are the plane-normal lengths (LOAD-BEARING: dropping
  // them culls too aggressively at edges and can blank a visible tile).
  const sx = Math.sqrt(1 + tanX * tanX);
  const sy = Math.sqrt(1 + tanY * tanY);
  if (ex - radiusPc * sx > d * tanX) return true; // beyond right
  if (-ex - radiusPc * sx > d * tanX) return true; // beyond left
  if (ey - radiusPc * sy > d * tanY) return true; // beyond top
  if (-ey - radiusPc * sy > d * tanY) return true; // beyond bottom
  return false;
}
