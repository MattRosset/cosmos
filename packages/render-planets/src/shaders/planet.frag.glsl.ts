// Lit variant — terminator via smoothstep (§5.10).
export const PLANET_FRAG_LIT = /* glsl */ `
uniform sampler2D uAlbedo;
uniform bool uHasAlbedo;
uniform vec3 uBaseColor;
uniform vec3 uStarDir;

varying vec3 vNormalWorld;
varying vec2 vUv;

void main() {
  vec3 base = uHasAlbedo ? texture2D(uAlbedo, vUv).rgb : uBaseColor;
  vec3 N = normalize(vNormalWorld);
  float light = 0.035 + 0.965 * smoothstep(-0.08, 0.12, dot(N, uStarDir));
  gl_FragColor = vec4(base * light, 1.0);
}
`;

// Unlit variant — Sol disc, no terminator.
export const PLANET_FRAG_UNLIT = /* glsl */ `
uniform sampler2D uAlbedo;
uniform bool uHasAlbedo;
uniform vec3 uBaseColor;

varying vec3 vNormalWorld;
varying vec2 vUv;

void main() {
  vec3 base = uHasAlbedo ? texture2D(uAlbedo, vUv).rgb : uBaseColor;
  gl_FragColor = vec4(base, 1.0);
}
`;
