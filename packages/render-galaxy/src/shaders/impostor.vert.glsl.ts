// Vertex shader for the far-LOD impostor sprite (§5.9).
// uRenderOffset holds the camera-relative galaxy center in PARSECS (the setRenderOffset
// contract, TASK-081); uRadiusPc is the galaxy radius in parsecs. Both are converted to
// active-context units by the single uPcToUnits factor at the projection (TASK-082).
// The unit-plane geometry is expanded in camera space for a billboard effect — the mesh
// transform is NEVER consulted, so the radius must be applied here to reach a pixel.
export const VERT = /* glsl */ `
uniform vec3 uRenderOffset;
uniform float uRadiusPc;
uniform float uPcToUnits;

varying vec2 vUv;

void main() {
  // Camera-relative galaxy center (rotation only — floating origin, ADR-001 §5)
  vec3 camCenter = mat3(viewMatrix) * uRenderOffset;
  // Expand vertex in camera space (billboard always faces camera). PlaneGeometry(1,1)
  // positions are +/-0.5, so x2 puts the quad's half-width exactly at the galaxy radius.
  vec3 viewPos = camCenter + vec3(position.xy * (2.0 * uRadiusPc), 0.0);
  // viewPos is PARSECS; uPcToUnits converts the whole billboard (offset AND radius) to the
  // active context's units in one factor — exactly 1.0 in galaxy context.
  gl_Position = projectionMatrix * vec4(viewPos * uPcToUnits, 1.0);
  vUv = uv;
}
`;
