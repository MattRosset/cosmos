// Quantifies per-star flux variation vs gl_PointSize for cosmos' star shader.
// Rasterization per GL spec: a point of size s centered at C produces a fragment
// for every pixel whose center falls in the s×s square around C; that fragment's
// gl_PointCoord is the fragment center's position within the square, in [0,1]^2.
// Alpha per fragment = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5))
// (packages/render-stars/src/shaders/stars.frag.glsl.ts:13). Additive blending →
// a star's on-screen flux ∝ Σ_fragments alpha. We sweep the sub-pixel phase of the
// point center over [0,1)^2 and report the flux min/max/mean/CV for each size.
const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const alphaAt = (u, v) => smoothstep(0.5, 0.1, Math.hypot(u - 0.5, v - 0.5));

function flux(size, cx, cy) {
  // pixel centers at integer+0.5; point square = [cx-size/2, cx+size/2]
  let sum = 0;
  const lo = Math.floor(cx - size / 2), hi = Math.ceil(cx + size / 2);
  const loy = Math.floor(cy - size / 2), hiy = Math.ceil(cy + size / 2);
  for (let px = lo; px <= hi; px++) for (let py = loy; py <= hiy; py++) {
    const fx = px + 0.5, fy = py + 0.5;
    if (Math.abs(fx - cx) < size / 2 && Math.abs(fy - cy) < size / 2) {
      // gl_PointCoord: (fragCenter - squareMin) / size
      sum += alphaAt((fx - (cx - size / 2)) / size, (fy - (cy - size / 2)) / size);
    }
  }
  return sum;
}

const N = 64; // phase sweep resolution
for (const size of [1, 1.5, 2, 3, 5, 8]) {
  const fluxes = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    fluxes.push(flux(size, 100 + i / N, 100 + j / N));
  }
  const mean = fluxes.reduce((a, b) => a + b) / fluxes.length;
  const min = Math.min(...fluxes), max = Math.max(...fluxes);
  const sd = Math.sqrt(fluxes.reduce((a, b) => a + (b - mean) ** 2, 0) / fluxes.length);
  console.log(
    `size=${size}px  flux mean=${mean.toFixed(3)}  min=${min.toFixed(3)}  max=${max.toFixed(3)}` +
    `  max/min=${min > 0 ? (max / min).toFixed(2) : 'inf (drops to 0)'}  CV=${(sd / mean * 100).toFixed(1)}%`
  );
}
