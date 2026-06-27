// Fragment shader for nebula billboards (§5.11). AdditiveBlending: each layer
// ADDS soft tinted light, so stacking the capped set of layers reads as a
// volumetric nebula WITHOUT ray marching (the §5.11 billboards-over-volumetrics
// doctrine). The injected noise texture's alpha is the soft falloff; it is
// sampled with a per-layer rotation (vSeed) so layers do not visibly repeat.
// uOpacity (cross-fade) and uExposure (tone) both reach the alpha term, which is
// what AdditiveBlending scales the contribution by (result = dst + rgb · a).
export const FRAG = /* glsl */ `
uniform sampler2D uNoiseTexture;
uniform float uOpacity;
uniform float uExposure;

varying vec2 vUv;
varying float vSeed;
varying vec3 vColor;

void main() {
  // Per-layer UV rotation AND scale keyed by the layer seed (deterministic, §8.6) so
  // stacked layers sample different parts of the shared sprite and do not visibly
  // repeat. Scaling is about the centre (0.5) so the soft radial vignette stays
  // centred. Zoom-OUT only (scl >= 1): the quad edges then always map past the
  // sprite's 0-alpha margin (ClampToEdge → transparent), so no square edge shows.
  // (Zoom-in would sample the bright interior at the quad border → visible squares.)
  float a = vSeed * 6.2831853;
  float s = sin(a);
  float c = cos(a);
  float scl = 1.0 + 0.6 * fract(vSeed * 2.137);
  vec2 centered = (vUv - 0.5) * scl;
  vec2 rotated = vec2(c * centered.x - s * centered.y, s * centered.x + c * centered.y) + 0.5;
  float coverage = texture2D(uNoiseTexture, rotated).a;
  // vColor already carries the layer tint pre-multiplied by per-layer opacity.
  gl_FragColor = vec4(vColor, coverage * uOpacity * uExposure);
}
`;
