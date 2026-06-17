// Fragment shader for the galaxy particle cloud.
// Same pipeline as render-stars with an added uOpacity uniform for
// LOD cross-fades (§5.8 ~0.3 s fades driven by the caller).
export const FRAG = /* glsl */ `
uniform sampler2D uBvLut;
uniform float uExposure;
uniform float uOpacity;

varying float vApparentMag;
varying float vBV;

void main() {
  float alpha = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
  float brightness = clamp(pow(10.0, -0.4 * vApparentMag), 0.0, 1.0) * uExposure;
  float lutU = (vBV + 0.4) / 2.4;
  vec3 color = texture2D(uBvLut, vec2(lutU, 0.5)).rgb;
  gl_FragColor = vec4(color * brightness, alpha * uOpacity);
}
`;
