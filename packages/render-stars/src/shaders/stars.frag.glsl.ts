// Fragment shader for the star point-sprite field.
// Soft circular falloff via gl_PointCoord; brightness from apparent magnitude;
// color from B-V blackbody LUT. Linear output — scene-host owns tone mapping.
export const FRAG = /* glsl */ `
uniform sampler2D uBvLut;
uniform float uExposure;
uniform float uOpacity;

varying float vApparentMag;
varying float vBV;
varying float vSizeDim;

void main() {
  float alpha = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
  float brightness = clamp(pow(10.0, -0.4 * vApparentMag), 0.0, 1.0) * uExposure * vSizeDim;
  float lutU = (vBV + 0.4) / 2.4;
  vec3 color = texture2D(uBvLut, vec2(lutU, 0.5)).rgb;
  gl_FragColor = vec4(color * brightness, alpha * uOpacity);
}
`;
