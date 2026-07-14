import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { StarBatch, UniversePosition } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import type { Vec3Tuple } from '@cosmos/coords';
import { createStarPoints } from '@cosmos/render-stars';
import { PRIORITY_RENDER, useFrameContext } from '@cosmos/scene-host';

/**
 * TASK-077 — compiled-shader jitter gate (`?debug=shaderjitter`).
 *
 * The `?debug=jitter` gate (JitterProbe) proves the COORDINATE math with Three's CPU
 * `Vector3.project`. It cannot see a fast-math backend reassociating the GPU hi/lo sum,
 * because the sum never runs on the GPU there. This probe closes that hole: it mounts
 * the REAL render-stars vertex shader on one synthetic star, orbits the camera around
 * it at 1 AU driving the production `setRenderOffset` split, and reads the star's
 * on-screen centroid straight out of the drawing buffer. If the driver folds
 * `(position + Hi) * uGuardOne + Lo` back into `position + (Hi + Lo)`, the star's
 * screen position walks by tens–hundreds of px (research §3) and the gate goes red.
 * See docs/research/jitter-apple-mobile.md.
 *
 * Frozen scenario constants (chosen, not tunable — see TASK-077 "Frozen"): the tile
 * origin sits 8 kpc out; the star is 30 pc tile-local (exactly representable in f32,
 * ≈ the deepest real-octree leaf magnitude — the worst case of the research); the
 * camera orbits the star's absolute position at 1 AU; aAbsMag = 31.6 puts the apparent
 * magnitude ≈ 0 at 1 AU (a ~8 px point, no clamp, crisp centroid). 10 warmup + 300
 * measured frames, matching JitterProbe.
 */

/** 1 AU in parsecs — same constant as JitterProbe. */
const AU_PC = 4.84813681e-6;
const WARMUP_FRAMES = 10;
const MEASURE_FRAMES = 300;
/** Gate threshold (px). The failure mode is coarse (tens–hundreds of px); 1.5 px
 *  absorbs centroid noise with a huge margin either way (TASK-077 "Frozen"). */
const MAX_DEVIATION_PX = 1.5;

/** Readback window (drawing-buffer px), centered — the star renders at screen center. */
const READBACK_SIZE = 96;
/** Luminance below which a pixel is background: no star pixel this frame ⇒ lost frame. */
const LUM_FLOOR = 40;
/** Sentinel deviation for a frame where the star wasn't found (loud, never silent). */
const LOST_DEVIATION_PX = 999;

/** Tile origin: 8 kpc from the galactic center, galaxy-context parsecs (f64). */
const TILE_ORIGIN: UniversePosition = { context: 'galaxy', local: [8000, 0, 0] };
/** Star, tile-local parsecs: 30 pc along +x (exactly representable in f32). */
const STAR_LOCAL: Vec3Tuple = [30, 0, 0];
/** Star, absolute galaxy parsecs = tile origin + tile-local. */
const STAR_ABS: UniversePosition = { context: 'galaxy', local: [8030, 0, 0] };
/** Camera starts 1 AU from the star along +x (θ = 0). */
const INITIAL_CAMERA: UniversePosition = { context: 'galaxy', local: [8030 + AU_PC, 0, 0] };
/** Apparent magnitude ≈ 0 ⇒ ~8 px point, unclamped, crisp centroid. NB: the frozen
 *  TASK-076 shader floors sizing distance at `max(length(viewPos), 0.001)` pc (≈206 AU),
 *  so at the 1 AU orbit the apparent magnitude is evaluated at 0.001 pc — aAbsMag must be
 *  ~20 (not the spec's 31.6, which assumed the true 1 AU distance and overlooked the
 *  floor). The floor affects only size/brightness, not gl_Position, so the jitter it
 *  measures is unchanged. See docs/research/jitter-apple-mobile.md addendum. */
const STAR_ABS_MAG = 20.0;
/** Clip planes bracketing the constant 1 AU distance. */
const NEAR_PC = AU_PC * 1e-2;
const FAR_PC = AU_PC * 1e2;

export interface ShaderJitterResult {
  readonly maxDeviationPx: number;
  readonly frames: number;
  readonly lostFrames: number;
  readonly renderer: string;
}

declare global {
  interface Window {
    __shaderJitterResult?: ShaderJitterResult;
  }
}

/** One synthetic star, tile-local — the input contract of createStarPoints (§5.9). */
function makeSingleStarBatch(): StarBatch {
  return {
    count: 1,
    originPc: [TILE_ORIGIN.local[0], TILE_ORIGIN.local[1], TILE_ORIGIN.local[2]],
    positionsPc: new Float32Array([STAR_LOCAL[0], STAR_LOCAL[1], STAR_LOCAL[2]]),
    absMag: new Float32Array([STAR_ABS_MAG]),
    colorIndexBV: new Float32Array([0.6]),
    catalogIds: new Uint32Array([0]),
    hipIds: new Uint32Array([0]),
    idPrefix: 'shaderjitter',
  };
}

// Module-scoped scratch — no allocation in the frame/readback loops (§9).
const offsetScratch: Vec3Tuple = [0, 0, 0];
const truthScratch: Vec3Tuple = [0, 0, 0];
const screenXs = new Float64Array(MEASURE_FRAMES);
const screenYs = new Float64Array(MEASURE_FRAMES);
const lostMask = new Uint8Array(MEASURE_FRAMES);

export function ShaderJitterProbe(): React.JSX.Element {
  const origin = useMemo(
    () => createOriginManager(createScaleFrameTree(), INITIAL_CAMERA),
    [],
  );
  const points = useMemo(() => {
    const p = createStarPoints({ batch: makeSingleStarBatch() });
    p.object.frustumCulled = false;
    return p;
  }, []);
  useEffect(() => () => points.dispose(), [points]);

  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  // Point size scales with viewport height — set once (constant scenario).
  useEffect(() => {
    points.setViewportHeight(size.height * dpr);
  }, [points, size.height, dpr]);

  // Camera driver — one update per rendered frame, at frame start (JitterProbe mold).
  const camFrameRef = useRef(0);
  useFrameContext(() => {
    const frame = camFrameRef.current;
    if (frame > WARMUP_FRAMES + MEASURE_FRAMES) return;
    camFrameRef.current = frame + 1;

    const measureIndex = frame - WARMUP_FRAMES;
    const theta = measureIndex < 0 ? 0 : (measureIndex / MEASURE_FRAMES) * 2 * Math.PI;
    const camX = 8030 + AU_PC * Math.cos(theta);
    const camY = AU_PC * Math.sin(theta);

    // Exactly one camera update per frame (the coords contract). |cameraLocal| stays
    // within ~2 AU of the origin over the whole orbit, so no rebase fires.
    origin.setCameraPosition({ context: 'galaxy', local: [camX, camY, 0] });

    // Production emulated-double input: the tile origin's camera-relative offset (f64),
    // split hi/lo by setRenderOffset exactly as StarScene does.
    points.setRenderOffset(origin.toRenderSpace(TILE_ORIGIN, offsetScratch));

    // Look at the star's f64 camera-relative truth. If the GPU sum is exact the star
    // sits dead-center every frame; the jitter shows up as the centroid wandering.
    origin.toRenderSpace(STAR_ABS, truthScratch);
    camera.position.set(0, 0, 0);
    camera.up.set(0, 0, 1);
    camera.lookAt(truthScratch[0], truthScratch[1], truthScratch[2]);
    camera.near = NEAR_PC;
    camera.far = FAR_PC;
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }, PRIORITY_RENDER);

  // Readback loop — a self-perpetuating rAF registered outside the three loop, so it
  // runs AFTER three's render in the same turn (drawing buffer still valid despite
  // preserveDrawingBuffer:false; pattern from tools/research/twinkle-live-probe.js).
  useEffect(() => {
    const ctx = gl.getContext();
    const bw = ctx.drawingBufferWidth;
    const bh = ctx.drawingBufferHeight;
    const x0 = Math.floor((bw - READBACK_SIZE) / 2);
    const y0 = Math.floor((bh - READBACK_SIZE) / 2);
    const buf = new Uint8Array(READBACK_SIZE * READBACK_SIZE * 4);

    let rafId = 0;
    let lastCamFrame = -1;
    let published = false;

    const publish = (): void => {
      if (published) return;
      published = true;

      let sx = 0;
      let sy = 0;
      let valid = 0;
      for (let i = 0; i < MEASURE_FRAMES; i++) {
        if (lostMask[i]) continue;
        sx += screenXs[i]!;
        sy += screenYs[i]!;
        valid++;
      }
      const meanX = valid > 0 ? sx / valid : 0;
      const meanY = valid > 0 ? sy / valid : 0;

      let lostFrames = 0;
      let max = 0;
      for (let i = 0; i < MEASURE_FRAMES; i++) {
        if (lostMask[i]) {
          lostFrames++;
          max = Math.max(max, LOST_DEVIATION_PX);
          continue;
        }
        max = Math.max(max, Math.hypot(screenXs[i]! - meanX, screenYs[i]! - meanY));
      }

      const ext = ctx.getExtension('WEBGL_debug_renderer_info');
      const renderer = ext
        ? String(ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL))
        : 'unknown';

      window.__shaderJitterResult = {
        maxDeviationPx: max,
        frames: MEASURE_FRAMES,
        lostFrames,
        renderer,
      };
    };

    const tick = (): void => {
      rafId = requestAnimationFrame(tick);

      // The camera driver set the camera for frame `camFrame - 1` and three rendered it
      // this turn (both happen in three's rAF, atomically). Sample once per camera step.
      const camFrame = camFrameRef.current;
      if (camFrame === lastCamFrame) return;
      lastCamFrame = camFrame;

      const measureIndex = camFrame - 1 - WARMUP_FRAMES;
      if (measureIndex < 0 || measureIndex >= MEASURE_FRAMES) {
        if (measureIndex >= MEASURE_FRAMES) publish();
        return;
      }

      ctx.readPixels(x0, y0, READBACK_SIZE, READBACK_SIZE, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);

      // Luminance-weighted centroid over pixels above the background floor.
      let wsum = 0;
      let wx = 0;
      let wy = 0;
      for (let py = 0, p = 0; py < READBACK_SIZE; py++) {
        for (let px = 0; px < READBACK_SIZE; px++, p += 4) {
          const lum = Math.max(buf[p]!, buf[p + 1]!, buf[p + 2]!);
          if (lum < LUM_FLOOR) continue;
          wsum += lum;
          wx += lum * px;
          wy += lum * py;
        }
      }

      if (wsum === 0) {
        // No star pixel found — loud, triagable, never silent (research §KC / repo rule 6).
        lostMask[measureIndex] = 1;
        screenXs[measureIndex] = 0;
        screenYs[measureIndex] = 0;
      } else {
        lostMask[measureIndex] = 0;
        screenXs[measureIndex] = x0 + wx / wsum;
        screenYs[measureIndex] = y0 + wy / wsum;
      }

      if (measureIndex === MEASURE_FRAMES - 1) publish();
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [gl]);

  return <primitive object={points.object} />;
}

export { MAX_DEVIATION_PX, MEASURE_FRAMES };
