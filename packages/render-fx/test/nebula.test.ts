import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createPrng, MAX_NEBULA_LAYERS } from '@cosmos/core-types';
import type { NebulaField, NebulaLayer } from '@cosmos/core-types';
import { createNebula } from '../src/nebula.js';
import { VERT as NEBULA_VERT } from '../src/shaders/nebula.vert.glsl.js';

// ---------------------------------------------------------------------------
// Fixtures — seeded layers (no Math.random; §8.6).
// ---------------------------------------------------------------------------

function makeTexture(): THREE.Texture {
  return new THREE.Texture();
}

function makeField(layerCount: number, seed = 1): NebulaField {
  const prng = createPrng(seed);
  const layers: NebulaLayer[] = [];
  for (let i = 0; i < layerCount; i++) {
    layers.push({
      centerUnits: [prng.range(-100, 100), prng.range(-100, 100), prng.range(-100, 100)],
      radiusUnits: prng.range(10, 50),
      colorLinear: [prng.next(), prng.next(), prng.next()],
      opacity: prng.range(0.2, 0.8),
      seed: prng.int(0, 0xffffffff),
    });
  }
  return { id: `field-${layerCount}`, originPc: [0, 0, 0], layers };
}

function makeOpts(layerCount: number) {
  return { field: makeField(layerCount), noiseTexture: makeTexture() };
}

// ---------------------------------------------------------------------------
// InstancedMesh shape + layer cap
// ---------------------------------------------------------------------------

describe('nebula InstancedMesh shape', () => {
  it('object is a single InstancedMesh', () => {
    const neb = createNebula(makeOpts(5));
    expect(neb.object).toBeInstanceOf(THREE.InstancedMesh);
  });

  it('count equals layer count when under the cap', () => {
    const neb = createNebula(makeOpts(7));
    expect((neb.object as THREE.InstancedMesh).count).toBe(7);
  });

  it('caps a > 32-layer field at exactly MAX_NEBULA_LAYERS', () => {
    const neb = createNebula(makeOpts(MAX_NEBULA_LAYERS + 11));
    expect((neb.object as THREE.InstancedMesh).count).toBe(MAX_NEBULA_LAYERS);
  });

  it('per-instance center/seed/color attributes exist with correct itemSize', () => {
    const mesh = createNebula(makeOpts(4)).object as THREE.InstancedMesh;
    expect((mesh.geometry.getAttribute('aCenterUnits') as THREE.BufferAttribute).itemSize).toBe(3);
    expect((mesh.geometry.getAttribute('aRadius') as THREE.BufferAttribute).itemSize).toBe(1);
    expect((mesh.geometry.getAttribute('aSeed') as THREE.BufferAttribute).itemSize).toBe(1);
    expect((mesh.geometry.getAttribute('aColor') as THREE.BufferAttribute).itemSize).toBe(3);
  });

  it('aColor pre-multiplies layer tint by per-layer opacity', () => {
    const field = makeField(3);
    const neb = createNebula({ field, noiseTexture: makeTexture() });
    const attr = (neb.object as THREE.InstancedMesh).geometry.getAttribute('aColor');
    const layer = field.layers[0]!;
    expect(attr.getX(0)).toBeCloseTo(layer.colorLinear[0] * layer.opacity);
    expect(attr.getY(0)).toBeCloseTo(layer.colorLinear[1] * layer.opacity);
    expect(attr.getZ(0)).toBeCloseTo(layer.colorLinear[2] * layer.opacity);
  });
});

// ---------------------------------------------------------------------------
// Material flags
// ---------------------------------------------------------------------------

describe('nebula material flags', () => {
  const mat = (createNebula(makeOpts(3)).object as THREE.InstancedMesh)
    .material as THREE.ShaderMaterial;

  it('blending is AdditiveBlending (layered billboards add light, §5.11)', () => {
    expect(mat.blending).toBe(THREE.AdditiveBlending);
  });

  it('depthWrite = false', () => {
    expect(mat.depthWrite).toBe(false);
  });

  it('transparent = true', () => {
    expect(mat.transparent).toBe(true);
  });

  it('noise texture is wired as the sampler uniform', () => {
    const opts = makeOpts(3);
    const mat2 = (createNebula(opts).object as THREE.InstancedMesh).material as THREE.ShaderMaterial;
    expect(mat2.uniforms['uNoiseTexture']!.value).toBe(opts.noiseTexture);
  });
});

// ---------------------------------------------------------------------------
// Vertex shader: camera-facing billboard + render offset (§5.11, ADR-001 §5)
// ---------------------------------------------------------------------------

describe('nebula vertex shader', () => {
  it('billboards in camera space (expands position.xy by the radius)', () => {
    expect(NEBULA_VERT).toContain('position.xy * aRadius');
  });

  it('applies uRenderOffset to the instance center (floating origin)', () => {
    expect(NEBULA_VERT).toContain('aCenterUnits + uRenderOffset');
  });

  it('uses camera rotation only (mat3(viewMatrix)) — no translation', () => {
    expect(NEBULA_VERT).toContain('mat3(viewMatrix)');
  });
});

// ---------------------------------------------------------------------------
// set* — zero allocation (same uniform identity)
// ---------------------------------------------------------------------------

describe('nebula set* are zero-alloc', () => {
  it('setRenderOffset mutates the uniform Vector3 in place', () => {
    const neb = createNebula(makeOpts(3));
    const mat = (neb.object as THREE.InstancedMesh).material as THREE.ShaderMaterial;
    const before = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;

    neb.setRenderOffset([10, 20, 30]);

    const after = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;
    expect(after).toBe(before);
    expect([after.x, after.y, after.z]).toEqual([10, 20, 30]);
  });

  it('setExposure mutates uExposure in place', () => {
    const neb = createNebula(makeOpts(3));
    const mat = (neb.object as THREE.InstancedMesh).material as THREE.ShaderMaterial;
    neb.setExposure(2.5);
    expect(mat.uniforms['uExposure']!.value).toBeCloseTo(2.5);
  });

  it('setOpacity mutates uOpacity in place', () => {
    const neb = createNebula(makeOpts(3));
    const mat = (neb.object as THREE.InstancedMesh).material as THREE.ShaderMaterial;
    neb.setOpacity(0.4);
    expect(mat.uniforms['uOpacity']!.value).toBeCloseTo(0.4);
  });

  it('setVisible toggles object.visible', () => {
    const neb = createNebula(makeOpts(3));
    neb.setVisible(false);
    expect(neb.object.visible).toBe(false);
    neb.setVisible(true);
    expect(neb.object.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dispose — injected texture must NOT be disposed
// ---------------------------------------------------------------------------

describe('nebula dispose', () => {
  it('disposes geometry + material exactly once and is idempotent', () => {
    const neb = createNebula(makeOpts(3));
    const mesh = neb.object as THREE.InstancedMesh;
    const spyGeom = vi.spyOn(mesh.geometry, 'dispose');
    const spyMat = vi.spyOn(mesh.material as THREE.ShaderMaterial, 'dispose');

    neb.dispose();
    neb.dispose();

    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
  });

  it('does NOT dispose the injected noiseTexture', () => {
    const opts = makeOpts(3);
    const neb = createNebula(opts);
    const spyTex = vi.spyOn(opts.noiseTexture, 'dispose');
    neb.dispose();
    expect(spyTex).not.toHaveBeenCalled();
  });
});
