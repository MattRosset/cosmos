// Vertex shader for the far-LOD impostor sprite (§5.9).
// uRenderOffset holds the camera-relative galaxy center (context units).
// The unit-plane geometry is expanded in camera space for a billboard effect.
export const VERT = /* glsl */ `
uniform vec3 uRenderOffset;

varying vec2 vUv;

void main() {
  // Camera-relative galaxy center (rotation only — floating origin, ADR-001 §5)
  vec3 camCenter = mat3(viewMatrix) * uRenderOffset;
  // Expand vertex in camera space (billboard always faces camera)
  vec3 viewPos = camCenter + position;
  gl_Position = projectionMatrix * vec4(viewPos, 1.0);
  vUv = uv;
}
`;
