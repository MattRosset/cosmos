// Vertex shader for the galaxy particle cloud (§5.9).
// Identical contract to render-stars: positions are tile-local parsecs,
// uRenderOffset is the tile origin's camera-relative position. Only the
// rotational part of viewMatrix is applied (floating origin, ADR-001 §5).
// uOpacity is forwarded to the fragment shader for LOD cross-fades (§5.8).
export const VERT = /* glsl */ `
uniform vec3 uRenderOffset;
uniform float uPcToUnits;
uniform float uBasePointPx;
uniform float uMinPointPx;
uniform float uMaxPointPx;
uniform float uPixelScale;

attribute float aAbsMag;
attribute float aColorBV;

varying float vApparentMag;
varying float vBV;
varying float vRadiusPc;
varying float vPhi;

void main() {
  vec3 viewPos = mat3(viewMatrix) * (position + uRenderOffset);
  vRadiusPc = length(position.xy);
  vPhi = atan(position.y, position.x);
  float dPc = max(length(viewPos), 0.001);
  float m = aAbsMag + 5.0 * (log2(dPc) / log2(10.0) - 1.0);
  gl_PointSize = clamp(
    uBasePointPx * pow(10.0, -0.2 * m),
    uMinPointPx,
    uMaxPointPx
  ) * uPixelScale;
  // viewPos is PARSECS (the setRenderOffset contract); uPcToUnits converts to the active
  // context's render units. Exactly 1.0 in galaxy context ⇒ bit-identical there. TASK-081.
  gl_Position = projectionMatrix * vec4(viewPos * uPcToUnits, 1.0);
  vApparentMag = m;
  vBV = aColorBV;
}
`;
