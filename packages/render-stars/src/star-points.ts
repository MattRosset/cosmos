import * as THREE from 'three';
import type { StarBatch } from '@cosmos/core-types';
import { buildBlackbodyLutData, LUT_SIZE } from './blackbody.js';
import { VERT } from './shaders/stars.vert.glsl.js';
import { FRAG } from './shaders/stars.frag.glsl.js';

export interface StarPointsOptions {
  readonly batch: StarBatch;
  /** Screen-space point size clamp, px. Defaults: min 3, max 64 (§5.9). */
  readonly minPointPx?: number;
  readonly maxPointPx?: number;
  /** Base size factor at apparent magnitude 0, px. Default 8. */
  readonly basePointPx?: number;
}

export interface StarPoints {
  /** Mount into the scene (one THREE.Points, ONE draw call for the whole batch). */
  readonly object: THREE.Points;
  /**
   * Per frame: the batch origin's camera-relative position in galaxy units.
   * Copies into a uniform — ZERO allocations.
   */
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  /** Viewport height in physical px (point-size scaling). Call on resize. */
  setViewportHeight(px: number): void;
  /** Exposure multiplier (UI-controlled later). Default 1. */
  setExposure(exposure: number): void;
  /** Cross-fade alpha in [0,1] (streaming LOD transitions, §5.8). Default 1. */
  setOpacity(opacity: number): void;
  dispose(): void;
}

export function createStarPoints(opts: StarPointsOptions): StarPoints {
  const { batch, minPointPx = 3, maxPointPx = 64, basePointPx = 8 } = opts;

  // Build geometry — position attribute shares the batch buffer directly (no copy).
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(batch.positionsPc, 3));
  geometry.setAttribute('aAbsMag', new THREE.BufferAttribute(batch.absMag, 1));
  geometry.setAttribute('aColorBV', new THREE.BufferAttribute(batch.colorIndexBV, 1));

  // Build the B-V → linear RGB LUT texture (256×1 RGBA, linear space).
  const lutData = buildBlackbodyLutData(LUT_SIZE);
  const lut = new THREE.DataTexture(lutData, LUT_SIZE, 1, THREE.RGBAFormat);
  lut.needsUpdate = true;

  const uniforms = {
    // Emulated-double tile-origin offset (see stars.vert.glsl.ts): Hi = f32 round
    // of the f64 offset, Lo = the residual. Kills sub-AU jitter on close approach.
    uRenderOffsetHi: { value: new THREE.Vector3(0, 0, 0) },
    uRenderOffsetLo: { value: new THREE.Vector3(0, 0, 0) },
    uBasePointPx: { value: basePointPx },
    uMinPointPx: { value: minPointPx },
    uMaxPointPx: { value: maxPointPx },
    uPixelScale: { value: 1.0 },
    uExposure: { value: 1.0 },
    uOpacity: { value: 1.0 },
    uBvLut: { value: lut },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const object = new THREE.Points(geometry, material);

  let disposed = false;

  return {
    object,

    setRenderOffset([x, y, z]: readonly [number, number, number]): void {
      // Split each f64 component into a f32 high part and its f64 residual, then
      // store the residual as its own f32. The shader sums (pos + Hi) + Lo so the
      // per-frame offset no longer re-quantizes to ULP(tile) steps (the jitter).
      const hi = uniforms.uRenderOffsetHi.value;
      const lo = uniforms.uRenderOffsetLo.value;
      const hx = Math.fround(x);
      const hy = Math.fround(y);
      const hz = Math.fround(z);
      hi.x = hx;
      hi.y = hy;
      hi.z = hz;
      lo.x = x - hx;
      lo.y = y - hy;
      lo.z = z - hz;
    },

    setViewportHeight(px: number): void {
      uniforms.uPixelScale.value = px / 1080;
    },

    setExposure(exposure: number): void {
      uniforms.uExposure.value = exposure;
    },

    setOpacity(opacity: number): void {
      uniforms.uOpacity.value = opacity;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
      lut.dispose();
    },
  };
}
