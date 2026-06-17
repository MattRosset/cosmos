// Fragment shader for the far-LOD impostor sprite.
// uOpacity drives cross-fade during LOD transitions (§5.8 caller-controlled).
export const FRAG = /* glsl */ `
uniform sampler2D uSpriteTexture;
uniform float uOpacity;

varying vec2 vUv;

void main() {
  vec4 tex = texture2D(uSpriteTexture, vUv);
  gl_FragColor = vec4(tex.rgb * tex.a, tex.a * uOpacity);
}
`;
