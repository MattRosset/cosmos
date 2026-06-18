import * as THREE from 'three';
import { VERT } from './shaders/dust.vert.glsl.js';
import { FRAG } from './shaders/dust.frag.glsl.js';

export interface DustLanesOptions {
  readonly centersUnits: Float32Array;
  readonly radiiUnits: Float32Array;
  readonly dustTexture: THREE.Texture;
}

export interface DustLanes {
  readonly object: THREE.Object3D;
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setOpacity(a: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createDustLanes(opts: DustLanesOptions): DustLanes {
  const { centersUnits, radiiUnits, dustTexture } = opts;
  const count = radiiUnits.length;

  // Unit quad; billboard expansion happens in the vertex shader.
  const geometry = new THREE.PlaneGeometry(1, 1);
  // Per-instance center and radius — set once, never reallocated.
  geometry.setAttribute('aCenterUnits', new THREE.InstancedBufferAttribute(centersUnits, 3));
  geometry.setAttribute('aRadius', new THREE.InstancedBufferAttribute(radiiUnits, 1));

  const uniforms = {
    uRenderOffset: { value: new THREE.Vector3(0, 0, 0) },
    uDustTexture: { value: dustTexture },
    uOpacity: { value: 1.0 },
  };

  // MultiplyBlending: result = src * dst — darkens the additive star cloud
  // behind the dust (§5.9 doctrine: dust occludes, does not add). Three.js
  // requires premultipliedAlpha for MultiplyBlending (else it emits a per-frame
  // WebGLState error and the blend is undefined).
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.MultiplyBlending,
    premultipliedAlpha: true,
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
      // dustTexture is injected by the caller — never dispose it here.
    },
  };
}
