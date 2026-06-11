// Vertex shader for the star point-sprite field (§5.9).
// Three.js built-ins used: projectionMatrix (mat4), viewMatrix (mat4).
// Positions are tile-local parsecs; uRenderOffset is the tile origin's
// camera-relative position (also parsecs) — their sum is the star's
// camera-relative position in WORLD axes. The camera's render-space position
// is identically zero (floating origin, ADR-001), so view space is reached by
// applying only the rotational part of viewMatrix.
export const VERT = /* glsl */ `
uniform vec3 uRenderOffset;
uniform float uBasePointPx;
uniform float uMinPointPx;
uniform float uMaxPointPx;
uniform float uPixelScale;

attribute float aAbsMag;
attribute float aColorBV;

varying float vApparentMag;
varying float vBV;

void main() {
  vec3 viewPos = mat3(viewMatrix) * (position + uRenderOffset);
  float dPc = max(length(viewPos), 0.001);
  float m = aAbsMag + 5.0 * (log2(dPc) / log2(10.0) - 1.0);
  gl_PointSize = clamp(
    uBasePointPx * pow(10.0, -0.2 * m),
    uMinPointPx,
    uMaxPointPx
  ) * uPixelScale;
  gl_Position = projectionMatrix * vec4(viewPos, 1.0);
  vApparentMag = m;
  vBV = aColorBV;
}
`;
