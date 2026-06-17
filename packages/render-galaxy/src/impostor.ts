import * as THREE from 'three';
import { VERT } from './shaders/impostor.vert.glsl.js';
import { FRAG } from './shaders/impostor.frag.glsl.js';

export interface GalaxyImpostorOptions {
  readonly spriteTexture: THREE.Texture;
  readonly radiusUnits: number;
}

export interface GalaxyImpostor {
  readonly object: THREE.Object3D;
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setOpacity(a: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createGalaxyImpostor(opts: GalaxyImpostorOptions): GalaxyImpostor {
  const { spriteTexture, radiusUnits } = opts;

  // Unit plane scaled to the impostor radius; billboard expansion in vertex shader.
  const geometry = new THREE.PlaneGeometry(1, 1);

  const uniforms = {
    uRenderOffset: { value: new THREE.Vector3(0, 0, 0) },
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
  // Scale bakes the radius into world space; vertex shader uses position directly.
  mesh.scale.set(radiusUnits, radiusUnits, 1);

  let disposed = false;

  return {
    object: mesh,

    setRenderOffset([x, y, z]: readonly [number, number, number]): void {
      const v = uniforms.uRenderOffset.value;
      v.x = x;
      v.y = y;
      v.z = z;
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
