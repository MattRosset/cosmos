import * as THREE from 'three';

export interface OrbitLineOptions {
  readonly pointsUnits: Float32Array;
  readonly colorLinear?: readonly [number, number, number];
  readonly opacity?: number;
}

export interface OrbitLine {
  readonly object: THREE.Line;
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createOrbitLine(opts: OrbitLineOptions): OrbitLine {
  const {
    pointsUnits,
    colorLinear = [0.35, 0.45, 0.6],
    opacity = 0.55,
  } = opts;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pointsUnits, 3));

  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(colorLinear[0], colorLinear[1], colorLinear[2]),
    transparent: true,
    opacity,
    depthWrite: false,
  });

  const object = new THREE.Line(geometry, material);

  // Preallocated offset — written in place each frame (zero alloc).
  const _offset = new THREE.Vector3();

  let disposed = false;

  return {
    object,

    setRenderOffset([x, y, z]: readonly [number, number, number]): void {
      _offset.x = x;
      _offset.y = y;
      _offset.z = z;
      object.position.copy(_offset);
    },

    setVisible(visible: boolean): void {
      object.visible = visible;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    },
  };
}
