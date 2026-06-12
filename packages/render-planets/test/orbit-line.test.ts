import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createOrbitLine } from '../src/orbit-line.js';

function makePoints(n: number): Float32Array {
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = i;
    arr[i * 3 + 1] = i * 0.5;
    arr[i * 3 + 2] = 0;
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

describe('orbit line geometry', () => {
  it('position attribute shares pointsUnits buffer (no copy)', () => {
    const pts = makePoints(10);
    const line = createOrbitLine({ pointsUnits: pts });
    const attr = line.object.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(attr.array).toBe(pts);
  });

  it('object is a THREE.Line', () => {
    const line = createOrbitLine({ pointsUnits: makePoints(5) });
    expect(line.object).toBeInstanceOf(THREE.Line);
  });
});

// ---------------------------------------------------------------------------
// Material flags
// ---------------------------------------------------------------------------

describe('orbit line material', () => {
  it('material is transparent', () => {
    const line = createOrbitLine({ pointsUnits: makePoints(5) });
    const mat = line.object.material as THREE.LineBasicMaterial;
    expect(mat.transparent).toBe(true);
  });

  it('material has depthWrite === false', () => {
    const line = createOrbitLine({ pointsUnits: makePoints(5) });
    const mat = line.object.material as THREE.LineBasicMaterial;
    expect(mat.depthWrite).toBe(false);
  });

  it('default opacity is 0.55', () => {
    const line = createOrbitLine({ pointsUnits: makePoints(5) });
    const mat = line.object.material as THREE.LineBasicMaterial;
    expect(mat.opacity).toBeCloseTo(0.55, 5);
  });

  it('custom opacity is applied', () => {
    const line = createOrbitLine({ pointsUnits: makePoints(5), opacity: 0.8 });
    const mat = line.object.material as THREE.LineBasicMaterial;
    expect(mat.opacity).toBeCloseTo(0.8, 5);
  });
});

// ---------------------------------------------------------------------------
// setRenderOffset — zero allocation
// ---------------------------------------------------------------------------

describe('setRenderOffset', () => {
  it('mutates object.position in place (same object identity)', () => {
    const line = createOrbitLine({ pointsUnits: makePoints(5) });
    const posBefore = line.object.position;
    line.setRenderOffset([1, 2, 3]);
    expect(line.object.position).toBe(posBefore);
    expect(line.object.position.x).toBe(1);
    expect(line.object.position.y).toBe(2);
    expect(line.object.position.z).toBe(3);
  });

  it('second call still uses same position identity', () => {
    const line = createOrbitLine({ pointsUnits: makePoints(5) });
    const pos = line.object.position;
    line.setRenderOffset([4, 5, 6]);
    line.setRenderOffset([7, 8, 9]);
    expect(line.object.position).toBe(pos);
    expect(pos.x).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// setVisible
// ---------------------------------------------------------------------------

describe('setVisible', () => {
  it('sets object.visible', () => {
    const line = createOrbitLine({ pointsUnits: makePoints(5) });
    line.setVisible(false);
    expect(line.object.visible).toBe(false);
    line.setVisible(true);
    expect(line.object.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe('dispose', () => {
  it('disposes geometry and material exactly once', () => {
    const line = createOrbitLine({ pointsUnits: makePoints(5) });
    const spyGeom = vi.spyOn(line.object.geometry, 'dispose');
    const spyMat = vi.spyOn(line.object.material as THREE.LineBasicMaterial, 'dispose');

    line.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
  });

  it('second dispose is a no-op', () => {
    const line = createOrbitLine({ pointsUnits: makePoints(5) });
    const spyGeom = vi.spyOn(line.object.geometry, 'dispose');
    line.dispose();
    line.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
  });
});
