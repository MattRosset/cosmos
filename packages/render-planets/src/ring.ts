import * as THREE from 'three';

/**
 * Builds a RingGeometry and remaps its UV attribute so that u = 0 at
 * innerRadius and u = 1 at outerRadius (radial strip mapping). Three's
 * default UVs are planar and would smear a 1-D ring texture into a disc.
 */
export function buildRingGeometry(
  innerRadius: number,
  outerRadius: number,
  thetaSegments = 64,
): THREE.RingGeometry {
  const geom = new THREE.RingGeometry(innerRadius, outerRadius, thetaSegments);

  const pos = geom.getAttribute('position') as THREE.BufferAttribute;
  const uv = geom.getAttribute('uv') as THREE.BufferAttribute;
  const count = pos.count;

  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.sqrt(x * x + y * y);
    const u = (r - innerRadius) / (outerRadius - innerRadius);
    uv.setXY(i, u, 0.5);
  }

  uv.needsUpdate = true;
  return geom;
}
