// Vertex shader for dust-lane billboards (§5.9).
// Each instance stores its center via aCenterUnits (context units relative to
// the batch origin) and its radius via aRadius. The billboard is expanded in
// camera space so it always faces the camera (floating origin, ADR-001 §5).
export const VERT = /* glsl */ `
attribute vec3 aCenterUnits;
attribute float aRadius;

uniform vec3 uRenderOffset;

varying vec2 vUv;

void main() {
  // Camera-relative center of this billboard
  vec3 camCenter = mat3(viewMatrix) * (aCenterUnits + uRenderOffset);
  // Expand the unit-quad vertex in camera space (billboard)
  vec3 viewPos = camCenter + vec3(position.xy * aRadius, 0.0);
  gl_Position = projectionMatrix * vec4(viewPos, 1.0);
  vUv = uv;
}
`;
