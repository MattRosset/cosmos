// Fragment shader for dust-lane billboards.
// Samples the alpha dust texture. Blending mode is MultiplyBlending so the
// dust darkens (occludes) the additive star cloud behind it — not additive.
export const FRAG = /* glsl */ `
uniform sampler2D uDustTexture;
uniform float uOpacity;

varying vec2 vUv;

void main() {
  vec4 tex = texture2D(uDustTexture, vUv);
  gl_FragColor = vec4(tex.rgb, tex.a * uOpacity);
}
`;
