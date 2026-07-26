// Vertex shader for the camera-relative line-set (constellation lines, etc.).
// Endpoints are stored in `position` as PARSECS relative to the line-set origin;
// uRenderOffset is the origin's camera-relative position, PARSECS too. uPcToUnits
// converts the whole set to ACTIVE-CONTEXT units once, at the projection (TASK-085);
// it is exactly 1 in galaxy context. Rotation only (floating origin, ADR-001 §5) —
// no per-frame geometry rebuild, the offset is a uniform. One LineSegments draw call
// covers every segment.
export const VERT = /* glsl */ `
uniform vec3 uRenderOffset;
uniform float uPcToUnits;

void main() {
  vec3 camPos = mat3(viewMatrix) * (position + uRenderOffset);
  // camPos is PARSECS; uPcToUnits converts to the active context at the projection.
  gl_Position = projectionMatrix * vec4(camPos * uPcToUnits, 1.0);
}
`;
