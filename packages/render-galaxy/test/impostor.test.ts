import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createGalaxyImpostor } from '../src/impostor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTexture(): THREE.Texture {
  return new THREE.Texture();
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('shape', () => {
  it('object is a single THREE.Mesh (billboard)', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusUnits: 500 });
    expect(imp.object).toBeInstanceOf(THREE.Mesh);
  });

  it('radius reflected in scale (scale.x = scale.y = radiusUnits)', () => {
    const radiusUnits = 750;
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusUnits });
    const mesh = imp.object as THREE.Mesh;
    expect(mesh.scale.x).toBeCloseTo(radiusUnits);
    expect(mesh.scale.y).toBeCloseTo(radiusUnits);
  });

  it('different radiusUnits values are reflected independently', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusUnits: 200 });
    expect((imp.object as THREE.Mesh).scale.x).toBeCloseTo(200);
  });
});

// ---------------------------------------------------------------------------
// Material flags
// ---------------------------------------------------------------------------

describe('material flags', () => {
  const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusUnits: 500 });
  const mat = (imp.object as THREE.Mesh).material as THREE.ShaderMaterial;

  it('blending = AdditiveBlending', () => {
    expect(mat.blending).toBe(THREE.AdditiveBlending);
  });

  it('depthWrite = false', () => {
    expect(mat.depthWrite).toBe(false);
  });

  it('transparent = true', () => {
    expect(mat.transparent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setRenderOffset
// ---------------------------------------------------------------------------

describe('setRenderOffset', () => {
  it('mutates uRenderOffset uniform in place', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusUnits: 500 });
    const mat = (imp.object as THREE.Mesh).material as THREE.ShaderMaterial;
    const vecBefore = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;

    imp.setRenderOffset([100, 200, 300]);

    const vecAfter = mat.uniforms['uRenderOffset']!.value as THREE.Vector3;
    expect(vecAfter).toBe(vecBefore);
    expect(vecAfter.x).toBe(100);
    expect(vecAfter.y).toBe(200);
    expect(vecAfter.z).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// setOpacity — drives material uniform
// ---------------------------------------------------------------------------

describe('setOpacity', () => {
  it('mutates uOpacity uniform in place', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusUnits: 500 });
    const mat = (imp.object as THREE.Mesh).material as THREE.ShaderMaterial;

    imp.setOpacity(0.3);
    expect(mat.uniforms['uOpacity']!.value).toBeCloseTo(0.3);
  });

  it('second call uses the same uniform slot', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusUnits: 500 });
    const mat = (imp.object as THREE.Mesh).material as THREE.ShaderMaterial;

    imp.setOpacity(0.5);
    imp.setOpacity(0.9);
    expect(mat.uniforms['uOpacity']!.value).toBeCloseTo(0.9);
  });
});

// ---------------------------------------------------------------------------
// setVisible
// ---------------------------------------------------------------------------

describe('setVisible', () => {
  it('toggles object.visible', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusUnits: 500 });
    imp.setVisible(false);
    expect(imp.object.visible).toBe(false);
    imp.setVisible(true);
    expect(imp.object.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dispose — injected texture must NOT be disposed
// ---------------------------------------------------------------------------

describe('dispose', () => {
  it('disposes geometry and material exactly once', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusUnits: 500 });
    const mesh = imp.object as THREE.Mesh;
    const mat = mesh.material as THREE.ShaderMaterial;

    const spyGeom = vi.spyOn(mesh.geometry, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');

    imp.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
  });

  it('injected spriteTexture dispose is NOT called', () => {
    const tex = makeTexture();
    const imp = createGalaxyImpostor({ spriteTexture: tex, radiusUnits: 500 });
    const spyTex = vi.spyOn(tex, 'dispose');

    imp.dispose();
    expect(spyTex).not.toHaveBeenCalled();
  });

  it('second dispose call is a no-op', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusUnits: 500 });
    const mesh = imp.object as THREE.Mesh;
    const mat = mesh.material as THREE.ShaderMaterial;

    const spyGeom = vi.spyOn(mesh.geometry, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');

    imp.dispose();
    imp.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
  });
});
