import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createLineSet } from '../src/line-set.js';
import { VERT as LINE_VERT } from '../src/shaders/lineset.vert.glsl.js';

// N segments → 6×N f32 endpoints → 2×N vertices.
function makeSegments(n: number): Float32Array {
  const seg = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    seg[o] = i; seg[o + 1] = 0; seg[o + 2] = 0; // a
    seg[o + 3] = i; seg[o + 4] = 10; seg[o + 5] = 0; // b
  }
  return seg;
}

// ---------------------------------------------------------------------------
// Geometry shape — one LineSegments, one draw, vertex count = segments/3
// ---------------------------------------------------------------------------

describe('line-set geometry shape', () => {
  it('object is a single LineSegments', () => {
    const ls = createLineSet({ segments: makeSegments(4) });
    expect(ls.object).toBeInstanceOf(THREE.LineSegments);
  });

  it('vertex count equals segments.length / 3', () => {
    const segments = makeSegments(5);
    const ls = createLineSet({ segments });
    const pos = (ls.object as THREE.LineSegments).geometry.getAttribute('position');
    expect(pos.count).toBe(segments.length / 3);
  });

  it('reuses the injected Float32Array as the position buffer (no copy)', () => {
    const segments = makeSegments(3);
    const ls = createLineSet({ segments });
    const pos = (ls.object as THREE.LineSegments).geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    expect(pos.array).toBe(segments);
  });
});

// ---------------------------------------------------------------------------
// Material flags + defaults
// ---------------------------------------------------------------------------

describe('line-set material', () => {
  it('is additive, transparent, depthWrite off', () => {
    const mat = (createLineSet({ segments: makeSegments(2) }).object as THREE.LineSegments)
      .material as THREE.ShaderMaterial;
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
  });

  it('uColor defaults to [0.4,0.55,0.8]', () => {
    const mat = (createLineSet({ segments: makeSegments(2) }).object as THREE.LineSegments)
      .material as THREE.ShaderMaterial;
    const c = mat.uniforms['uColor']!.value as THREE.Vector3;
    expect([c.x, c.y, c.z]).toEqual([0.4, 0.55, 0.8]);
  });

  it('uColor reflects an explicit colorLinear', () => {
    const mat = (
      createLineSet({ segments: makeSegments(2), colorLinear: [0.1, 0.2, 0.3] })
        .object as THREE.LineSegments
    ).material as THREE.ShaderMaterial;
    const c = mat.uniforms['uColor']!.value as THREE.Vector3;
    expect([c.x, c.y, c.z]).toEqual([0.1, 0.2, 0.3]);
  });

  it('uOpacity defaults to 0.5 and honours an explicit opacity', () => {
    const def = (createLineSet({ segments: makeSegments(2) }).object as THREE.LineSegments)
      .material as THREE.ShaderMaterial;
    expect(def.uniforms['uOpacity']!.value).toBeCloseTo(0.5);
    const explicit = (
      createLineSet({ segments: makeSegments(2), opacity: 0.9 }).object as THREE.LineSegments
    ).material as THREE.ShaderMaterial;
    expect(explicit.uniforms['uOpacity']!.value).toBeCloseTo(0.9);
  });
});

// ---------------------------------------------------------------------------
// Vertex shader — render offset, rotation only
// ---------------------------------------------------------------------------

describe('line-set vertex shader', () => {
  it('applies uRenderOffset to position (floating origin, ADR-001 §5)', () => {
    expect(LINE_VERT).toContain('position + uRenderOffset');
  });

  it('uses camera rotation only (mat3(viewMatrix))', () => {
    expect(LINE_VERT).toContain('mat3(viewMatrix)');
  });
});

// ---------------------------------------------------------------------------
// set* — zero allocation
// ---------------------------------------------------------------------------

describe('line-set set* are zero-alloc', () => {
  it('setRenderOffset mutates the uniform Vector3 in place', () => {
    const ls = createLineSet({ segments: makeSegments(3) });
    const mat = (ls.object as THREE.LineSegments).material as THREE.ShaderMaterial;
    const before = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;

    ls.setRenderOffset([1, 2, 3]);
    ls.setRenderOffset([4, 5, 6]);

    const after = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;
    expect(after).toBe(before);
    expect([after.x, after.y, after.z]).toEqual([4, 5, 6]);
  });

  it('setOpacity mutates uOpacity in place', () => {
    const ls = createLineSet({ segments: makeSegments(3) });
    const mat = (ls.object as THREE.LineSegments).material as THREE.ShaderMaterial;
    ls.setOpacity(0.25);
    expect(mat.uniforms['uOpacity']!.value).toBeCloseTo(0.25);
  });

  it('setVisible toggles object.visible', () => {
    const ls = createLineSet({ segments: makeSegments(3) });
    ls.setVisible(false);
    expect(ls.object.visible).toBe(false);
    ls.setVisible(true);
    expect(ls.object.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe('line-set dispose', () => {
  it('disposes geometry + material exactly once and is idempotent', () => {
    const ls = createLineSet({ segments: makeSegments(3) });
    const obj = ls.object as THREE.LineSegments;
    const spyGeom = vi.spyOn(obj.geometry, 'dispose');
    const spyMat = vi.spyOn(obj.material as THREE.ShaderMaterial, 'dispose');

    ls.dispose();
    ls.dispose();

    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
  });
});
