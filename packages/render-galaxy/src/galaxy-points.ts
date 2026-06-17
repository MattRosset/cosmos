import * as THREE from 'three';
import type { StarBatch } from '@cosmos/core-types';
import { buildBlackbodyLutData, LUT_SIZE } from './lut.js';
import { VERT } from './shaders/galaxy.vert.glsl.js';
import { FRAG } from './shaders/galaxy.frag.glsl.js';

export interface GalaxyPointsOptions {
  readonly batch: StarBatch;
  readonly minPointPx?: number;
  readonly maxPointPx?: number;
  readonly basePointPx?: number;
}

export interface GalaxyPoints {
  readonly object: THREE.Points;
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setViewportHeight(px: number): void;
  setExposure(v: number): void;
  setOpacity(a: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createGalaxyPoints(opts: GalaxyPointsOptions): GalaxyPoints {
  const { batch, minPointPx = 1, maxPointPx = 32, basePointPx = 4 } = opts;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(batch.positionsPc, 3));
  geometry.setAttribute('aAbsMag', new THREE.BufferAttribute(batch.absMag, 1));
  geometry.setAttribute('aColorBV', new THREE.BufferAttribute(batch.colorIndexBV, 1));

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
      const v = uniforms.uRenderOffset.value;
      v.x = x;
      v.y = y;
      v.z = z;
    },

    setViewportHeight(px: number): void {
      uniforms.uPixelScale.value = px / 1080;
    },

    setExposure(v: number): void {
      uniforms.uExposure.value = v;
    },

    setOpacity(a: number): void {
      uniforms.uOpacity.value = a;
    },

    setVisible(visible: boolean): void {
      object.visible = visible;
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
