export const PLANET_VERT = /* glsl */ `
uniform vec3 uRenderOffset;

varying vec3 vNormalWorld;
varying vec2 vUv;

void main() {
  vUv = uv;
  vNormalWorld = normalize(mat3(modelMatrix) * normal);
  vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz + uRenderOffset;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;
