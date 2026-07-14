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
  it('vertex shader contains the emulated-double render offset (hi/lo)', () => {
    expect(VERT).toContain('uRenderOffsetHi');
    expect(VERT).toContain('uRenderOffsetLo');
  });

  it('vertex shader applies the camera rotation (viewMatrix) to camera-relative positions', () => {
    expect(VERT).toContain('vec3 viewPos = mat3(viewMatrix) * rel;');
  });

  it('vertex shader guards the hi/lo sum against fast-math reassociation (* uGuardOne)', () => {
    // TASK-077: `* uGuardOne` forces the rounded (position + Hi) sum to materialize so
    // a fast-math backend (Metal/mobile) can't reassociate the split away — deleting it
    // reintroduces the approach jitter on those devices with no local test to catch it
    // (docs/research/jitter-apple-mobile.md). The expression is frozen textually.
    expect(VERT).toContain('vec3 rel = (position + uRenderOffsetHi) * uGuardOne + uRenderOffsetLo;');
    // `invariant gl_Position` is the belt: it disables reorder opts on the position
    // chain under ANGLE→Metal.
    expect(VERT).toContain('invariant gl_Position;');
    expect(VERT).toContain('uniform float uGuardOne;');
  });

  it('vertex shader contains the -0.2 size exponent', () => {
    expect(VERT).toContain('-0.2');
  });

  it('vertex shader contains clamp with uMinPointPx and uMaxPointPx', () => {
    expect(VERT).toContain('clamp');
    expect(VERT).toContain('uMinPointPx');
    expect(VERT).toContain('uMaxPointPx');
  });

  it('vertex shader emits the flux-conserving size-dim varying (natural/rendered ratio²)', () => {
    // TASK-076: floor-clamped stars are dimmed by the area ratio to conserve flux.
    expect(VERT).toContain('vSizeDim');
    expect(VERT).toContain('min(1.0, (sNat / sRen) * (sNat / sRen))');
    // Regression guard: the hi/lo jitter fix (commit 6bd7d24, guarded by TASK-077) must
    // survive untouched — the split must reach the GPU whole.
    expect(VERT).toContain('(position + uRenderOffsetHi) * uGuardOne + uRenderOffsetLo');
  });

  it('fragment shader contains the -0.4 brightness exponent', () => {
    expect(FRAG).toContain('-0.4');
  });

  it('fragment shader multiplies brightness by the size-dim varying, falloff untouched', () => {
    // TASK-076: brightness *= vSizeDim; the C2-validated falloff must stay exact.
    expect(FRAG).toContain('vSizeDim');
    expect(FRAG).toContain('smoothstep(0.5, 0.1,');
  });

  it('fragment shader multiplies the output alpha by uOpacity (cross-fade, §5.8)', () => {
    expect(FRAG).toContain('uOpacity');
    expect(FRAG).toContain('alpha * uOpacity');
  });
});

// ---------------------------------------------------------------------------
// Fast-math guard uniform (TASK-077)
// ---------------------------------------------------------------------------

describe('uGuardOne', () => {
  it('initializes to exactly 1.0 (opaque-to-compiler multiplier; no rounding, no setter)', () => {
    const batch = makeBatch(5);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;
    expect(mat.uniforms['uGuardOne']!.value).toBe(1);
  });

  it('has no public setter on the StarPoints API', () => {
    const batch = makeBatch(5);
    const points = createStarPoints({ batch });
    expect('setGuardOne' in points).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Point-size floor (TASK-076)
// ---------------------------------------------------------------------------

describe('minPointPx floor', () => {
  it('defaults uMinPointPx to 3 (flux-conserving twinkle floor)', () => {
    const batch = makeBatch(5);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;
    expect(mat.uniforms['uMinPointPx']!.value).toBe(3);
  });

  it('explicit minPointPx override still lands in the uniform (plumbing unchanged)', () => {
    const batch = makeBatch(5);
    const points = createStarPoints({ batch, minPointPx: 1 });
    const mat = points.object.material as THREE.ShaderMaterial;
    expect(mat.uniforms['uMinPointPx']!.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// setRenderOffset — zero allocation
// ---------------------------------------------------------------------------

describe('setRenderOffset', () => {
  it('mutates the hi/lo uniform Vector3s in place (same object identity)', () => {
    const batch = makeBatch(10);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;
    const hiBefore = mat.uniforms['uRenderOffsetHi']!.value as THREE.Vector3;
    const loBefore = mat.uniforms['uRenderOffsetLo']!.value as THREE.Vector3;

    points.setRenderOffset([1, 2, 3]);

    const hiAfter = mat.uniforms['uRenderOffsetHi']!.value as THREE.Vector3;
    expect(hiAfter).toBe(hiBefore); // same object
    expect(mat.uniforms['uRenderOffsetLo']!.value).toBe(loBefore);
    // Exactly representable f32 inputs ⇒ all weight in hi, zero residual.
    expect(hiAfter.x).toBe(1);
    expect(hiAfter.y).toBe(2);
    expect(hiAfter.z).toBe(3);
    expect(loBefore.x).toBe(0);
  });

  it('hi + lo reconstructs the f64 offset (residual carries the lost bits)', () => {
    const batch = makeBatch(10);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;
    const hi = mat.uniforms['uRenderOffsetHi']!.value as THREE.Vector3;
    const lo = mat.uniforms['uRenderOffsetLo']!.value as THREE.Vector3;

    // A galaxy-scale offset (≈30 pc) whose f64 value is not f32-representable.
    const x = 30.000000123;
    points.setRenderOffset([x, 0, 0]);

    expect(hi.x).toBe(Math.fround(x)); // hi = f32 round
    expect(hi.x + lo.x).toBeCloseTo(x, 12); // hi + lo recovers full precision
    expect(lo.x).not.toBe(0); // residual actually carries the lost bits
  });

  it('second call still uses the same Vector3 identity', () => {
    const batch = makeBatch(10);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;
    const hi = mat.uniforms['uRenderOffsetHi']!.value as THREE.Vector3;

    points.setRenderOffset([4, 5, 6]);
    points.setRenderOffset([7, 8, 9]);

    expect(mat.uniforms['uRenderOffsetHi']!.value).toBe(hi);
    expect(hi.x).toBe(7);
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

describe('setOpacity', () => {
  it('defaults to 1 (unchanged additive output) and updates uOpacity uniform', () => {
    const batch = makeBatch(5);
    const points = createStarPoints({ batch });
    const mat = points.object.material as THREE.ShaderMaterial;

    expect(mat.uniforms['uOpacity']!.value).toBe(1.0);
    points.setOpacity(0.3);
    expect(mat.uniforms['uOpacity']!.value).toBe(0.3);
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
