// Atmosphere shell vertex shader (ADR-005 §1–§2, §5).
//
// The shell geometry is built at the atmosphere radius in CONTEXT UNITS, so the
// `position` attribute is already shell-center-relative in context units — exactly
// the space the O'Neil fragment integral works in. Placement uses the floating-origin
// rule (ADR-001 §5): the shell center sits at `uRenderOffset` (camera-relative), the
// camera at the origin, so there is no absolute-position uniform.
export const ATMOSPHERE_VERT = /* glsl */ `
uniform vec3 uRenderOffset;

varying vec3 vShellPos;

void main() {
  // Shell-center-relative position, context units (geometry radius = atmosphere radius).
  vShellPos = position;
  vec3 worldPos = position + uRenderOffset;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;
