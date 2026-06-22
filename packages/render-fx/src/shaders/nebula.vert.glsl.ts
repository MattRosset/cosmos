// Vertex shader for nebula billboards (§5.11 "billboard volumetric-look").
// One instance per NebulaLayer: aCenterUnits is the layer center (context units
// relative to the field origin) and aRadius its half-size. The unit quad is
// expanded in CAMERA space so every billboard always faces the camera (floating
// origin: rotation only, ADR-001 §5). aSeed drives a per-layer rotation of the
// noise UVs so stacked layers do not visibly repeat.
export const VERT = /* glsl */ `
attribute vec3 aCenterUnits;
attribute float aRadius;
attribute float aSeed;
attribute vec3 aColor;

uniform vec3 uRenderOffset;

varying vec2 vUv;
varying float vSeed;
varying vec3 vColor;

void main() {
  // Camera-relative center of this billboard (rotation only — floating origin)
  vec3 camCenter = mat3(viewMatrix) * (aCenterUnits + uRenderOffset);
  // Expand the unit-quad vertex in camera space so the billboard faces the camera
  vec3 viewPos = camCenter + vec3(position.xy * aRadius, 0.0);
  gl_Position = projectionMatrix * vec4(viewPos, 1.0);
  vUv = uv;
  vSeed = aSeed;
  vColor = aColor;
}
`;
