import * as THREE from 'three';
import type { StarBatch } from '@cosmos/core-types';
import { buildBlackbodyLutData, LUT_SIZE } from './blackbody.js';
import { VERT } from './shaders/stars.vert.glsl.js';
import { FRAG } from './shaders/stars.frag.glsl.js';

export interface StarPointsOptions {
  readonly batch: StarBatch;
  /** Screen-space point size clamp, px. Defaults: min 1, max 64 (§5.9). */
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
  dispose(): void;
}

export function createStarPoints(opts: StarPointsOptions): StarPoints {
  const { batch, minPointPx = 1, maxPointPx = 64, basePointPx = 8 } = opts;

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
    uRenderOffset: { value: new THREE.Vector3(0, 0, 0) },
    uBasePointPx: { value: basePointPx },
    uMinPointPx: { value: minPointPx },
    uMaxPointPx: { value: maxPointPx },
    uPixelScale: { value: 1.0 },
    uExposure: { value: 1.0 },
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
      const v = uniforms.uRenderOffset.value;
      v.x = x;
      v.y = y;
      v.z = z;
    },

    setViewportHeight(px: number): void {
      uniforms.uPixelScale.value = px / 1080;
    },

    setExposure(exposure: number): void {
      uniforms.uExposure.value = exposure;
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
