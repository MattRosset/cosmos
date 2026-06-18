import * as THREE from 'three';
import type { StarBatch } from '@cosmos/core-types';
import { PROCGEN_GALAXY_DEFAULTS } from '@cosmos/core-types';
import { buildBlackbodyLutData, LUT_SIZE } from './lut.js';
import { VERT } from './shaders/galaxy.vert.glsl.js';
import { FRAG } from './shaders/galaxy.frag.glsl.js';

export interface GalaxyPointsOptions {
  readonly batch: StarBatch;
  readonly minPointPx?: number;
  readonly maxPointPx?: number;
  readonly basePointPx?: number;
  /** ADR-004 arm geometry for shader-side dust-lane darkening (defaults match procgen). */
  readonly armGeometry?: GalaxyArmGeometry;
}

export interface GalaxyArmGeometry {
  readonly scaleLengthPc: number;
  readonly armCount: number;
  readonly armPitchRad: number;
  readonly armWindings: number;
  readonly armWidthPc: number;
  readonly dustStrength?: number;
}

export interface GalaxyPoints {
  readonly object: THREE.Points;
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setViewportHeight(px: number): void;
  setExposure(v: number): void;
  setOpacity(a: number): void;
  /** Fraction of batch points to draw (0–1). Uses geometry drawRange — no regen. */
  setDrawFraction(f: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createGalaxyPoints(opts: GalaxyPointsOptions): GalaxyPoints {
  const { batch, minPointPx = 1, maxPointPx = 32, basePointPx = 4 } = opts;
  const d = PROCGEN_GALAXY_DEFAULTS;
  const arm = opts.armGeometry ?? {
    scaleLengthPc: d.discScaleLengthPc,
    armCount: d.armCount,
    armPitchRad: d.armPitchRad,
    armWindings: d.armWindings,
    armWidthPc: d.armWidthPc,
    dustStrength: 0.45,
  };

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
    uScaleLengthPc: { value: arm.scaleLengthPc },
    uArmCount: { value: arm.armCount },
    uArmPitchRad: { value: arm.armPitchRad },
    uArmWindings: { value: arm.armWindings },
    uArmWidthPc: { value: arm.armWidthPc },
    uDustStrength: { value: arm.dustStrength ?? 0.45 },
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
  const starCount = batch.count;

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

    setDrawFraction(f: number): void {
      const clamped = Math.max(0, Math.min(1, f));
      geometry.setDrawRange(0, Math.max(1, Math.floor(starCount * clamped)));
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
