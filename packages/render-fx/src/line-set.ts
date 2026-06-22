import * as THREE from 'three';
import { VERT } from './shaders/lineset.vert.glsl.js';
import { FRAG } from './shaders/lineset.frag.glsl.js';

export interface LineSetOptions {
  /** Segment endpoints, CONTEXT UNITS relative to `originUnits`: 6×N f32
   *  [ax,ay,az, bx,by,bz, …]. The caller rebases data's absolute f64 to this. */
  readonly segments: Float32Array;
  readonly colorLinear?: readonly [number, number, number]; // default [0.4,0.55,0.8]
  readonly opacity?: number; // default 0.5
  /** Constant screen-space line width in px where supported (else 1). */
  readonly widthPx?: number; // default 1
}

export interface LineSet {
  readonly object: THREE.Object3D;
  /** Per frame: origin camera-relative position, CONTEXT UNITS. Zero alloc. */
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setOpacity(a: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/**
 * Generic camera-relative line-segment renderer in ONE draw call (§9). One
 * THREE.LineSegments holds every segment; the origin is a camera-relative offset
 * uniform (floating origin, ADR-001 §5) so panning never rebuilds geometry.
 *
 * widthPx > 1 would need three-stdlib's Line2 (a separate dependency / geometry
 * model); to keep the package's allowed deps to `three` + `core-types` we draw at
 * the GL-native 1px LineSegments and ignore wider requests. Swap to Line2 here if
 * thick lines become a requirement.
 */
export function createLineSet(opts: LineSetOptions): LineSet {
  const { segments, colorLinear = [0.4, 0.55, 0.8], opacity = 0.5 } = opts;

  // Preallocated position buffer — setRenderOffset mutates a uniform, never this.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(segments, 3));

  const uniforms = {
    uRenderOffset: { value: new THREE.Vector3(0, 0, 0) },
    uColor: { value: new THREE.Vector3(colorLinear[0], colorLinear[1], colorLinear[2]) },
    uOpacity: { value: opacity },
  };

  // Additive + depthWrite off + transparent: a thin overlay that brightens the
  // sky without occluding stars behind it (overlay layer order, §10).
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const lines = new THREE.LineSegments(geometry, material);

  let disposed = false;

  return {
    object: lines,

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
      lines.visible = visible;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    },
  };
}
