import * as THREE from 'three';
import type { NebulaField } from '@cosmos/core-types';
import { MAX_NEBULA_LAYERS } from '@cosmos/core-types';
import { VERT } from './shaders/nebula.vert.glsl.js';
import { FRAG } from './shaders/nebula.frag.glsl.js';

export interface NebulaOptions {
  readonly field: NebulaField;
  /** Pre-loaded soft noise/sprite texture (alpha). */
  readonly noiseTexture: THREE.Texture;
}

export interface Nebula {
  readonly object: THREE.Object3D;
  /** Per frame: field-origin camera-relative position, CONTEXT UNITS. Zero alloc. */
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setExposure(v: number): void;
  /** Cross-fade alpha in [0,1] for LOD/quality transitions. */
  setOpacity(a: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * §5.11 nebula: a single InstancedMesh of unit quads, one instance per layer,
 * camera-facing in the vertex shader, additive. Layers beyond MAX_NEBULA_LAYERS
 * are dropped to bound overdraw (§5.11 "cap layer count"). No ray marching, no
 * real volumetrics — the layered noise billboards are the whole effect.
 */
export function createNebula(opts: NebulaOptions): Nebula {
  const { field, noiseTexture } = opts;

  // Cap layer count to bound overdraw (§5.11); a field with > 32 layers mounts 32.
  const count = Math.min(field.layers.length, MAX_NEBULA_LAYERS);

  // Per-instance center / radius / seed / tint — set once, never reallocated.
  const centers = new Float32Array(count * 3);
  const radii = new Float32Array(count);
  const seeds = new Float32Array(count);
  // Per-layer tint and opacity bake into the additive contribution; a uniform
  // can't hold per-instance color, so the color rides an instanced attribute and
  // the per-layer opacity pre-multiplies it (additive, so tint·opacity is linear).
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const layer = field.layers[i]!;
    centers[i * 3] = layer.centerUnits[0];
    centers[i * 3 + 1] = layer.centerUnits[1];
    centers[i * 3 + 2] = layer.centerUnits[2];
    radii[i] = layer.radiusUnits;
    // Seed mapped to [0,1) for a stable per-layer UV rotation in the shader.
    seeds[i] = (layer.seed >>> 0) / 4294967296;
    colors[i * 3] = layer.colorLinear[0] * layer.opacity;
    colors[i * 3 + 1] = layer.colorLinear[1] * layer.opacity;
    colors[i * 3 + 2] = layer.colorLinear[2] * layer.opacity;
  }

  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.setAttribute('aCenterUnits', new THREE.InstancedBufferAttribute(centers, 3));
  geometry.setAttribute('aRadius', new THREE.InstancedBufferAttribute(radii, 1));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));

  const uniforms = {
    uRenderOffset: { value: new THREE.Vector3(0, 0, 0) },
    uNoiseTexture: { value: noiseTexture },
    uOpacity: { value: 1.0 },
    uExposure: { value: 1.0 },
  };

  // Additive, depthWrite off, transparent: stacking the capped layers reads as a
  // volumetric nebula without ray marching (§5.11). DoubleSide so the billboard
  // is visible regardless of camera-space winding.
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);

  let disposed = false;

  return {
    object: mesh,

    setRenderOffset([x, y, z]: readonly [number, number, number]): void {
      const v = uniforms.uRenderOffset.value;
      v.x = x;
      v.y = y;
      v.z = z;
    },

    setExposure(v: number): void {
      uniforms.uExposure.value = v;
    },

    setOpacity(a: number): void {
      uniforms.uOpacity.value = a;
    },

    setVisible(visible: boolean): void {
      mesh.visible = visible;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
      // noiseTexture is injected by the caller — never dispose it here.
    },
  };
}
