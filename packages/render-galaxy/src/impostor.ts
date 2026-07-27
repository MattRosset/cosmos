import * as THREE from 'three';
import { VERT } from './shaders/impostor.vert.glsl.js';
import { FRAG } from './shaders/impostor.frag.glsl.js';

export interface GalaxyImpostorOptions {
  readonly spriteTexture: THREE.Texture;
  /** Galaxy radius in PARSECS. Seeds the same uniform `setRadiusPc` writes. */
  readonly radiusPc: number;
}

export interface GalaxyImpostor {
  readonly object: THREE.Object3D;
  /** Camera-relative galaxy center in PARSECS (TASK-081 contract). */
  setRenderOffset(offsetPc: readonly [number, number, number]): void;
  /** Set the impostor's radius in PARSECS. Cheap: writes one float uniform. */
  setRadiusPc(radiusPc: number): void;
  /**
   * Parsecs → active-context units, from `pcScales(ctx).pcToUnits`. Applied in the shader to
   * BOTH the render offset and the radius. Exactly `1` in galaxy context.
   * Same contract as `GalaxyPoints.setContextScale` (TASK-081).
   */
  setContextScale(pcToUnits: number): void;
  setOpacity(a: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createGalaxyImpostor(opts: GalaxyImpostorOptions): GalaxyImpostor {
  const { spriteTexture, radiusPc } = opts;

  // Unit plane; the radius and the billboard expansion are applied in the vertex shader —
  // `mesh.scale` would NOT reach the GPU under that shader (TASK-082,
  // docs/research/galaxy-impostor-scale-is-inert.md).
  const geometry = new THREE.PlaneGeometry(1, 1);

  const uniforms = {
    uRenderOffset: { value: new THREE.Vector3(0, 0, 0) },
    uRadiusPc: { value: radiusPc },
    uPcToUnits: { value: 1.0 },
    uSpriteTexture: { value: spriteTexture },
    uOpacity: { value: 1.0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);

  let disposed = false;

  return {
    object: mesh,

    setRenderOffset([x, y, z]: readonly [number, number, number]): void {
      const v = uniforms.uRenderOffset.value;
      v.x = x;
      v.y = y;
      v.z = z;
    },

    setRadiusPc(radiusPc: number): void {
      uniforms.uRadiusPc.value = radiusPc;
    },

    setContextScale(pcToUnits: number): void {
      uniforms.uPcToUnits.value = pcToUnits;
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
      // spriteTexture is injected by the caller — never dispose it here.
    },
  };
}
