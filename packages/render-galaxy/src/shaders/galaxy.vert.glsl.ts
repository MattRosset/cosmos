// Vertex shader for the galaxy particle cloud (§5.9).
// Identical contract to render-stars: positions are tile-local parsecs,
// uRenderOffset is the tile origin's camera-relative position. Only the
// rotational part of viewMatrix is applied (floating origin, ADR-001 §5).
// uOpacity is forwarded to the fragment shader for LOD cross-fades (§5.8).
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
