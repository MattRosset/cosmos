export const RING_FRAG = /* glsl */ `
uniform sampler2D uRingTex;
uniform bool uHasRingTex;
uniform vec3 uRingNormalWorld;
uniform vec3 uStarDir;

varying vec2 vUv;

void main() {
  vec4 color = uHasRingTex
    ? texture2D(uRingTex, vUv)
    : vec4(0.6, 0.55, 0.45, 0.5);
  float brightness = 0.05 + 0.95 * abs(dot(uRingNormalWorld, uStarDir));
  gl_FragColor = vec4(color.rgb * brightness, color.a);
}
`;
