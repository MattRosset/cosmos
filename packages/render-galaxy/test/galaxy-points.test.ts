import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { StarBatch } from '@cosmos/core-types';
import { createGalaxyPoints } from '../src/galaxy-points.js';
import { VERT } from '../src/shaders/galaxy.vert.glsl.js';
import { FRAG } from '../src/shaders/galaxy.frag.glsl.js';
import { bvToLinearRgb } from '../src/lut.js';
import { bvToLinearRgb as starsLut } from '@cosmos/render-stars';

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
  const pts = createGalaxyPoints({ batch });
  const geom = pts.object.geometry;

  it('object is a THREE.Points (one draw call per batch)', () => {
    expect(pts.object).toBeInstanceOf(THREE.Points);
  });

  it('position attribute shares the batch buffer (no copy)', () => {
    const attr = geom.getAttribute('position') as THREE.BufferAttribute;
    expect(attr.array).toBe(batch.positionsPc);
  });

  it('position attribute: itemSize = 3, count = batch.count', () => {
    const attr = geom.getAttribute('position') as THREE.BufferAttribute;
    expect(attr.itemSize).toBe(3);
    expect(attr.count).toBe(batch.count);
  });

  it('aAbsMag attribute shares batch buffer, itemSize = 1', () => {
    const attr = geom.getAttribute('aAbsMag') as THREE.BufferAttribute;
    expect(attr.array).toBe(batch.absMag);
    expect(attr.itemSize).toBe(1);
  });

  it('aColorBV attribute shares batch buffer, itemSize = 1', () => {
    const attr = geom.getAttribute('aColorBV') as THREE.BufferAttribute;
    expect(attr.array).toBe(batch.colorIndexBV);
    expect(attr.itemSize).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Shader string guards
// ---------------------------------------------------------------------------

describe('shader strings', () => {
  it('vertex shader contains uRenderOffset', () => {
    expect(VERT).toContain('uRenderOffset');
  });

  it('vertex shader applies camera rotation (mat3(viewMatrix)) to camera-relative positions', () => {
    expect(VERT).toContain('mat3(viewMatrix) * (position + uRenderOffset)');
  });

  it('vertex shader contains clamp with uMinPointPx and uMaxPointPx (screen-space size)', () => {
    expect(VERT).toContain('clamp');
    expect(VERT).toContain('uMinPointPx');
    expect(VERT).toContain('uMaxPointPx');
  });

  it('vertex shader contains -0.2 magnitude-to-size exponent', () => {
    expect(VERT).toContain('-0.2');
  });

  it('fragment shader contains uOpacity', () => {
    expect(FRAG).toContain('uOpacity');
  });

  it('fragment shader contains -0.4 brightness exponent', () => {
    expect(FRAG).toContain('-0.4');
  });
});

// ---------------------------------------------------------------------------
// Material flags
// ---------------------------------------------------------------------------

describe('material flags', () => {
  const batch = makeBatch(5);
  const pts = createGalaxyPoints({ batch });
  const mat = pts.object.material as THREE.ShaderMaterial;

  it('transparent = true', () => {
    expect(mat.transparent).toBe(true);
  });

  it('depthWrite = false', () => {
    expect(mat.depthWrite).toBe(false);
  });

  it('blending = AdditiveBlending', () => {
    expect(mat.blending).toBe(THREE.AdditiveBlending);
  });
});

// ---------------------------------------------------------------------------
// setRenderOffset — zero allocation
// ---------------------------------------------------------------------------

describe('setRenderOffset', () => {
  it('mutates the uniform Vector3 in place (same object identity)', () => {
    const pts = createGalaxyPoints({ batch: makeBatch(10) });
    const mat = pts.object.material as THREE.ShaderMaterial;
    const vecBefore = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;

    pts.setRenderOffset([1, 2, 3]);

    const vecAfter = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;
    expect(vecAfter).toBe(vecBefore);
    expect(vecAfter.x).toBe(1);
    expect(vecAfter.y).toBe(2);
    expect(vecAfter.z).toBe(3);
  });

  it('second call still uses the same Vector3 identity', () => {
    const pts = createGalaxyPoints({ batch: makeBatch(10) });
    const mat = pts.object.material as THREE.ShaderMaterial;
    const vec = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;

    pts.setRenderOffset([4, 5, 6]);
    pts.setRenderOffset([7, 8, 9]);

    expect(mat.uniforms['uRenderOffset']!.value).toBe(vec);
    expect(vec.x).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// setExposure and setOpacity — zero allocation
// ---------------------------------------------------------------------------

describe('setExposure', () => {
  it('mutates uExposure uniform in place', () => {
    const pts = createGalaxyPoints({ batch: makeBatch(5) });
    const mat = pts.object.material as THREE.ShaderMaterial;

    pts.setExposure(2.5);
    expect(mat.uniforms['uExposure']!.value).toBe(2.5);
  });
});

describe('setOpacity', () => {
  it('mutates uOpacity uniform in place', () => {
    const pts = createGalaxyPoints({ batch: makeBatch(5) });
    const mat = pts.object.material as THREE.ShaderMaterial;

    pts.setOpacity(0.4);
    expect(mat.uniforms['uOpacity']!.value).toBeCloseTo(0.4);
  });
});

describe('setViewportHeight', () => {
  it('updates uPixelScale uniform', () => {
    const pts = createGalaxyPoints({ batch: makeBatch(5) });
    const mat = pts.object.material as THREE.ShaderMaterial;

    pts.setViewportHeight(2160);
    expect(mat.uniforms['uPixelScale']!.value).toBeCloseTo(2160 / 1080, 8);
  });
});

// ---------------------------------------------------------------------------
// setVisible
// ---------------------------------------------------------------------------

describe('setVisible', () => {
  it('toggles object.visible', () => {
    const pts = createGalaxyPoints({ batch: makeBatch(5) });
    pts.setVisible(false);
    expect(pts.object.visible).toBe(false);
    pts.setVisible(true);
    expect(pts.object.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe('dispose', () => {
  it('disposes geometry, material, and LUT texture exactly once', () => {
    const pts = createGalaxyPoints({ batch: makeBatch(5) });
    const mat = pts.object.material as THREE.ShaderMaterial;
    const lut = mat.uniforms['uBvLut']!.value as THREE.DataTexture;

    const spyGeom = vi.spyOn(pts.object.geometry, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');
    const spyLut = vi.spyOn(lut, 'dispose');

    pts.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
    expect(spyLut).toHaveBeenCalledTimes(1);
  });

  it('second dispose call is a no-op', () => {
    const pts = createGalaxyPoints({ batch: makeBatch(5) });
    const mat = pts.object.material as THREE.ShaderMaterial;
    const lut = mat.uniforms['uBvLut']!.value as THREE.DataTexture;

    const spyGeom = vi.spyOn(pts.object.geometry, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');
    const spyLut = vi.spyOn(lut, 'dispose');

    pts.dispose();
    pts.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
    expect(spyLut).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Color parity with render-stars
// ---------------------------------------------------------------------------

describe('B-V LUT color parity with render-stars', () => {
  const samples = [-0.3, 0.0, 0.65, 1.5];

  for (const bv of samples) {
    it(`bvToLinearRgb(${bv}) matches render-stars at same bv`, () => {
      const [gr, gg, gb] = bvToLinearRgb(bv);
      const [sr, sg, sb] = starsLut(bv);
      expect(gr).toBeCloseTo(sr, 8);
      expect(gg).toBeCloseTo(sg, 8);
      expect(gb).toBeCloseTo(sb, 8);
    });
  }
});
