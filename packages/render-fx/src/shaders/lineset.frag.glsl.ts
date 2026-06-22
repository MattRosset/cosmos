// Fragment shader for the camera-relative line-set. uColor is LINEAR RGB; uOpacity
// rides in the alpha term so AdditiveBlending fades the lines cleanly (overlay
// order, §10). Flat color — the lines are a thin overlay, no shading.
export const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;

void main() {
  gl_FragColor = vec4(uColor, uOpacity);
}
`;
