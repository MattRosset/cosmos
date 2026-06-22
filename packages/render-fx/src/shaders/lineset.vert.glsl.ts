// Vertex shader for the camera-relative line-set (constellation lines, etc.).
// Endpoints are stored in `position` as context units relative to the line-set
// origin; uRenderOffset is the origin's camera-relative position. Rotation only
// (floating origin, ADR-001 §5) — no per-frame geometry rebuild, the offset is a
// uniform. One LineSegments draw call covers every segment.
export const VERT = /* glsl */ `
uniform vec3 uRenderOffset;

void main() {
  vec3 camPos = mat3(viewMatrix) * (position + uRenderOffset);
  gl_Position = projectionMatrix * vec4(camPos, 1.0);
}
`;
