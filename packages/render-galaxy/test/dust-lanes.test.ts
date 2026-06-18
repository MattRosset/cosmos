import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createDustLanes } from '../src/dust-lanes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTexture(): THREE.Texture {
  return new THREE.Texture();
}

function makeDustOpts(count: number) {
  const centersUnits = new Float32Array(count * 3);
  const radiiUnits = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    centersUnits[i * 3] = i * 10;
    centersUnits[i * 3 + 1] = 0;
    centersUnits[i * 3 + 2] = i * 5;
    radiiUnits[i] = 20 + i;
  }
  return { centersUnits, radiiUnits, dustTexture: makeTexture() };
}

// ---------------------------------------------------------------------------
// InstancedMesh shape
// ---------------------------------------------------------------------------

describe('InstancedMesh shape', () => {
  it('object is an InstancedMesh', () => {
    const lanes = createDustLanes(makeDustOpts(4));
    expect(lanes.object).toBeInstanceOf(THREE.InstancedMesh);
  });

  it('instance count equals radiiUnits.length', () => {
    const count = 7;
    const lanes = createDustLanes(makeDustOpts(count));
    expect((lanes.object as THREE.InstancedMesh).count).toBe(count);
  });

  it('aCenterUnits instanced attribute has itemSize = 3', () => {
    const lanes = createDustLanes(makeDustOpts(3));
    const mesh = lanes.object as THREE.InstancedMesh;
    const attr = mesh.geometry.getAttribute('aCenterUnits') as THREE.InstancedBufferAttribute;
    expect(attr.itemSize).toBe(3);
  });

  it('aRadius instanced attribute has itemSize = 1', () => {
    const lanes = createDustLanes(makeDustOpts(3));
    const mesh = lanes.object as THREE.InstancedMesh;
    const attr = mesh.geometry.getAttribute('aRadius') as THREE.InstancedBufferAttribute;
    expect(attr.itemSize).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Material flags
// ---------------------------------------------------------------------------

describe('material flags', () => {
  const lanes = createDustLanes(makeDustOpts(3));
  const mat = (lanes.object as THREE.InstancedMesh).material as THREE.ShaderMaterial;

  it('depthWrite = false', () => {
    expect(mat.depthWrite).toBe(false);
  });

  it('blending is NOT plain AdditiveBlending (dust must darken)', () => {
    expect(mat.blending).not.toBe(THREE.AdditiveBlending);
  });

  it('blending is MultiplyBlending', () => {
    expect(mat.blending).toBe(THREE.MultiplyBlending);
  });

  it('transparent = true', () => {
    expect(mat.transparent).toBe(true);
  });

  it('premultipliedAlpha = true (required by MultiplyBlending)', () => {
    expect(mat.premultipliedAlpha).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setRenderOffset — zero allocation
// ---------------------------------------------------------------------------

describe('setRenderOffset', () => {
  it('mutates the uniform Vector3 in place (same object identity)', () => {
    const lanes = createDustLanes(makeDustOpts(3));
    const mat = (lanes.object as THREE.InstancedMesh).material as THREE.ShaderMaterial;
    const vecBefore = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;

    lanes.setRenderOffset([10, 20, 30]);

    const vecAfter = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;
    expect(vecAfter).toBe(vecBefore);
    expect(vecAfter.x).toBe(10);
    expect(vecAfter.y).toBe(20);
    expect(vecAfter.z).toBe(30);
  });

  it('second call still uses the same Vector3 identity', () => {
    const lanes = createDustLanes(makeDustOpts(3));
    const mat = (lanes.object as THREE.InstancedMesh).material as THREE.ShaderMaterial;
    const vec = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;

    lanes.setRenderOffset([1, 2, 3]);
    lanes.setRenderOffset([4, 5, 6]);

    expect(mat.uniforms['uRenderOffset']!.value).toBe(vec);
    expect(vec.x).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// setOpacity and setVisible
// ---------------------------------------------------------------------------

describe('setOpacity', () => {
  it('mutates uOpacity uniform in place', () => {
    const lanes = createDustLanes(makeDustOpts(3));
    const mat = (lanes.object as THREE.InstancedMesh).material as THREE.ShaderMaterial;

    lanes.setOpacity(0.7);
    expect(mat.uniforms['uOpacity']!.value).toBeCloseTo(0.7);
  });
});

describe('setVisible', () => {
  it('toggles object.visible', () => {
    const lanes = createDustLanes(makeDustOpts(3));
    lanes.setVisible(false);
    expect(lanes.object.visible).toBe(false);
    lanes.setVisible(true);
    expect(lanes.object.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dispose — injected texture must NOT be disposed
// ---------------------------------------------------------------------------

describe('dispose', () => {
  it('disposes geometry and material exactly once', () => {
    const lanes = createDustLanes(makeDustOpts(3));
    const mesh = lanes.object as THREE.InstancedMesh;
    const mat = mesh.material as THREE.ShaderMaterial;

    const spyGeom = vi.spyOn(mesh.geometry, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');

    lanes.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
  });

  it('injected dustTexture dispose is NOT called', () => {
    const opts = makeDustOpts(3);
    const lanes = createDustLanes(opts);
    const spyTex = vi.spyOn(opts.dustTexture, 'dispose');

    lanes.dispose();
    expect(spyTex).not.toHaveBeenCalled();
  });

  it('second dispose call is a no-op', () => {
    const lanes = createDustLanes(makeDustOpts(3));
    const mesh = lanes.object as THREE.InstancedMesh;
    const mat = mesh.material as THREE.ShaderMaterial;

    const spyGeom = vi.spyOn(mesh.geometry, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');

    lanes.dispose();
    lanes.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
  });
});
