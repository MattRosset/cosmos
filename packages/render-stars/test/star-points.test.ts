import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { StarBatch } from '@cosmos/core-types';
import { createStarPoints } from '../src/star-points.js';
import { VERT } from '../src/shaders/stars.vert.glsl.js';
import { FRAG } from '../src/shaders/stars.frag.glsl.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBatch(count: number): StarBatch {
  const positionsPc = new Float32Array(count * 3);
  const absMag = new Float32Array(count);
  const colorIndexBV = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positionsPc[i * 3] = i * 1.5;
    positionsPc[i * 3 + 1] = i * 0.5;
    positionsPc[i * 3 + 2] = i * 2.0;
    absMag[i] = 5;
    colorIndexBV[i] = 0.6;
  }
  return {
    count,
    originPc: [0, 0, 0],
    positionsPc,
    absMag,
    colorIndexBV,
    catalogIds: new Uint32Array(count),
    hipIds: new Uint32Array(count),
    idPrefix: 'test',
  };
}

// ---------------------------------------------------------------------------
// Geometry layout
// ---------------------------------------------------------------------------

describe('geometry layout', () => {
  const batch = makeBatch(100);
  const points = createStarPoints({ batch });
  const geom = points.object.geometry;

  it('position attribute shares the batch buffer (no copy)', () => {
    const attr = geom.getAttribute('position') as THREE.BufferAttribute;
    expect(attr.array).toBe(batch.positionsPc);
  });

  it('position attribute: itemSize = 3, count = batch.count', () => {
    const attr = geom.getAttribute('position') as THREE.BufferAttribute;
    expect(attr.itemSize).toBe(3);
    expect(attr.count).toBe(batch.count);
  });

  it('aAbsMag attribute: itemSize = 1, count = batch.count', () => {
    const attr = geom.getAttribute('aAbsMag') as THREE.BufferAttribute;
    expect(attr.itemSize).toBe(1);
    expect(attr.count).toBe(batch.count);
    expect(attr.array).toBe(batch.absMag);
  });

  it('aColorBV attribute: itemSize = 1, count = batch.count', () => {
    const attr = geom.getAttribute('aColorBV') as THREE.BufferAttribute;
    expect(attr.itemSize).toBe(1);
    expect(attr.count).toBe(batch.count);
    expect(attr.array).toBe(batch.colorIndexBV);
  });
});

// ---------------------------------------------------------------------------
// Shader string guards
// ---------------------------------------------------------------------------

describe('shader strings', () => {
  it('vertex shader contains uRenderOffset', () => {
    expect(VERT).toContain('uRenderOffset');
  });

  it('vertex shader contains the -0.2 size exponent', () => {
    expect(VERT).toContain('-0.2');
  });

  it('vertex shader contains clamp with uMinPointPx and uMaxPointPx', () => {
    expect(VERT).toContain('clamp');
    expect(VERT).toContain('uMinPointPx');
    expect(VERT).toContain('uMaxPointPx');
  });

  it('fragment shader contains the -0.4 brightness exponent', () => {
    expect(FRAG).toContain('-0.4');
  });
});

// ---------------------------------------------------------------------------
// setRenderOffset — zero allocation
// ---------------------------------------------------------------------------

describe('setRenderOffset', () => {
  it('mutates the uniform Vector3 in place (same object identity)', () => {
    const batch = makeBatch(10);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;
    const vecBefore = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;

    points.setRenderOffset([1, 2, 3]);

    const vecAfter = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;
    expect(vecAfter).toBe(vecBefore); // same object
    expect(vecAfter.x).toBe(1);
    expect(vecAfter.y).toBe(2);
    expect(vecAfter.z).toBe(3);
  });

  it('second call still uses the same Vector3 identity', () => {
    const batch = makeBatch(10);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;
    const vec = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;

    points.setRenderOffset([4, 5, 6]);
    points.setRenderOffset([7, 8, 9]);

    expect(mat.uniforms['uRenderOffset']!.value).toBe(vec);
    expect(vec.x).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// setViewportHeight and setExposure
// ---------------------------------------------------------------------------

describe('setViewportHeight', () => {
  it('updates uPixelScale uniform', () => {
    const batch = makeBatch(5);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;

    points.setViewportHeight(2160);
    expect(mat.uniforms['uPixelScale']!.value).toBeCloseTo(2160 / 1080, 8);
  });
});

describe('setExposure', () => {
  it('updates uExposure uniform', () => {
    const batch = makeBatch(5);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;

    points.setExposure(2.5);
    expect(mat.uniforms['uExposure']!.value).toBe(2.5);
  });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe('dispose', () => {
  it('disposes geometry, material, and LUT texture exactly once', () => {
    const batch = makeBatch(5);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;
    const lut = mat.uniforms['uBvLut']!.value as THREE.DataTexture;

    const spyGeom = vi.spyOn(points.object.geometry, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');
    const spyLut = vi.spyOn(lut, 'dispose');

    points.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
    expect(spyLut).toHaveBeenCalledTimes(1);
  });

  it('second dispose call is a no-op (each method still called once total)', () => {
    const batch = makeBatch(5);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;
    const lut = mat.uniforms['uBvLut']!.value as THREE.DataTexture;

    const spyGeom = vi.spyOn(points.object.geometry, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');
    const spyLut = vi.spyOn(lut, 'dispose');

    points.dispose();
    points.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
    expect(spyLut).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Material flags
// ---------------------------------------------------------------------------

describe('material flags', () => {
  it('has transparent = true', () => {
    const batch = makeBatch(5);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;
    expect(mat.transparent).toBe(true);
  });

  it('has depthWrite = false', () => {
    const batch = makeBatch(5);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;
    expect(mat.depthWrite).toBe(false);
  });

  it('uses AdditiveBlending', () => {
    const batch = makeBatch(5);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;
    expect(mat.blending).toBe(THREE.AdditiveBlending);
  });
});
