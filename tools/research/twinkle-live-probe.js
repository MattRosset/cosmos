// Live twinkle probe — paste into the browser console (or run via CDP eval) with
// the cosmos app open, visible, and past the onboarding modal. Confirms C6 of
// docs/research/star-shimmer-on-motion.md.
//
// Method: readPixels a 500×400 center region inside rAF callbacks (scheduled from
// outside the frame loop, so they run AFTER three's render in the same frame turn
// — the drawing buffer is still valid there despite preserveDrawingBuffer:false).
// Phase 1: camera still, track the max luminance of the 80 brightest isolated
// star peaks over 14 frames. Phase 2: synthetic pointer drag (0.6 px/frame look
// rotation), same tracking (peaks are re-centered each frame via a 7×7 argmax
// follow). Twinkle = per-star luminance CV / max-min swing under motion.
//
// Measured 2026-07-14 (galaxy context near Sol, catalog stars, dpr 1):
//   still : medianCV 0%,   medianSwing 1.0,  fracSwing>1.5 = 0.00
//   moving: medianCV 65.6%, p90CV 115%, medianSwing 9.1×, fracSwing>1.5 = 0.90
// (p90CV 115% ≈ the 110.7% CV predicted for 1 px points by point-flux-variation.mjs)
(async () => {
  const canvas = document.querySelector('canvas');
  const gl = canvas.getContext('webgl2');
  const W = 500, H = 400;
  const x0 = Math.floor((gl.drawingBufferWidth - W) / 2);
  const y0 = Math.floor((gl.drawingBufferHeight - H) / 2);
  const buf = new Uint8Array(W * H * 4);
  const lum = new Float32Array(W * H);
  const grab = () => {
    gl.readPixels(x0, y0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = Math.max(buf[p], buf[p + 1], buf[p + 2]);
  };
  const frame = () => new Promise(r => requestAnimationFrame(() => { grab(); r(); }));

  await frame();
  const peaks = [];
  for (let y = 8; y < H - 8; y++) for (let x = 8; x < W - 8; x++) {
    const v = lum[y * W + x];
    if (v < 40) continue;
    let isMax = true;
    for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (lum[(y + dy) * W + x + dx] > v) { isMax = false; break; }
    }
    if (isMax) peaks.push({ x, y, v });
  }
  peaks.sort((a, b) => b.v - a.v);
  const stars = [];
  for (const p of peaks) {
    if (stars.length >= 80) break;
    if (stars.every(s => Math.hypot(s.x - p.x, s.y - p.y) > 6)) stars.push({ x: p.x, y: p.y });
  }
  const winMax = (s) => {
    let best = 0, bx = s.x, by = s.y;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = s.x + dx, yy = s.y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const v = lum[yy * W + xx];
      if (v > best) { best = v; bx = xx; by = yy; }
    }
    s.x = bx; s.y = by;
    return best;
  };
  const run = async (n, drag) => {
    const series = stars.map(() => []);
    const r = canvas.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    let mx = r.left + r.width / 2;
    const ev = (type) => canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: 9, isPrimary: true, clientX: mx, clientY: cy,
      buttons: type === 'pointerup' ? 0 : 1, bubbles: true,
    }));
    if (drag) ev('pointerdown');
    for (let f = 0; f < n; f++) {
      if (drag) { mx += 0.6; ev('pointermove'); }
      await frame();
      stars.forEach((s, i) => series[i].push(winMax(s)));
    }
    if (drag) ev('pointerup');
    const cvs = [], swings = [];
    for (const ser of series) {
      const m = ser.reduce((a, b) => a + b, 0) / ser.length;
      const sd = Math.sqrt(ser.reduce((a, b) => a + (b - m) ** 2, 0) / ser.length);
      cvs.push(sd / Math.max(1, m) * 100);
      swings.push(Math.max(...ser) / Math.max(1, Math.min(...ser)));
    }
    cvs.sort((a, b) => a - b); swings.sort((a, b) => a - b);
    const q = (arr, p) => arr[Math.floor(p * (arr.length - 1))];
    return {
      nStars: cvs.length, frames: series[0]?.length ?? 0,
      medianCVpct: +q(cvs, 0.5).toFixed(1), p90CVpct: +q(cvs, 0.9).toFixed(1),
      medianSwing: +q(swings, 0.5).toFixed(2), p90Swing: +q(swings, 0.9).toFixed(2),
      fracSwingOver1_5: +(swings.filter(s => s > 1.5).length / swings.length).toFixed(2),
    };
  };
  const still = await run(14, false);
  const moving = await run(14, true);
  console.log({ starsTracked: stars.length, still, moving });
  return { starsTracked: stars.length, still, moving };
})();
