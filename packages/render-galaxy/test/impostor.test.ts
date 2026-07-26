import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createGalaxyImpostor } from '../src/impostor.js';
import { VERT } from '../src/shaders/impostor.vert.glsl.js';

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
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusPc: 500 });
    expect(imp.object).toBeInstanceOf(THREE.Mesh);
  });

  // TASK-082 — the two `mesh.scale` assertions that used to live here are DELETED, not
  // ported. They asserted a value the impostor's vertex shader never reads (it uses neither
  // modelMatrix nor modelViewMatrix), so they passed for a sprite that had never drawn a
  // single pixel in production: docs/research/galaxy-impostor-scale-is-inert.md. That is why
  // the radius now travels as a uniform, and why the proof of size lives in a PIXEL gate
  // (e2e/tests/universe-impostor-scale.spec.ts) instead of in this file. jsdom has no WebGL,
  // so nothing here can render — the checks below are STRUCTURAL backups only.
  it('the mesh transform is left at identity (it cannot reach this shader)', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusPc: 750 });
    const mesh = imp.object as THREE.Mesh;
    expect([mesh.scale.x, mesh.scale.y, mesh.scale.z]).toEqual([1, 1, 1]);
  });

  it('radius travels as a uniform, seeded from radiusPc', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusPc: 750 });
    const mat = (imp.object as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(mat.uniforms['uRadiusPc']!.value).toBe(750);
  });
});

// ---------------------------------------------------------------------------
// Vertex shader — structural backup for the pixel gate (TASK-082)
// ---------------------------------------------------------------------------

describe('impostor vertex shader', () => {
  it('applies the radius to the quad geometry (the multiply that was missing)', () => {
    expect(VERT).toContain('position.xy * (2.0 * uRadiusPc)');
  });

  it('declares the context-scale uniform', () => {
    expect(VERT).toContain('uniform float uPcToUnits;');
  });

  it('applies the context scale once, at the projection', () => {
    expect(VERT).toContain('* uPcToUnits, 1.0)');
  });

  it('never consults the mesh transform', () => {
    expect(VERT).not.toContain('modelMatrix');
    expect(VERT).not.toContain('modelViewMatrix');
  });
});

// ---------------------------------------------------------------------------
// setRadiusPc / setContextScale — zero-alloc, exact seeding
// ---------------------------------------------------------------------------

describe('setRadiusPc', () => {
  it('mutates uRadiusPc in place', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusPc: 500 });
    const mat = (imp.object as THREE.Mesh).material as THREE.ShaderMaterial;
    const before = mat.uniforms['uRadiusPc'];

    imp.setRadiusPc(15000);

    expect(mat.uniforms['uRadiusPc']).toBe(before);
    expect(mat.uniforms['uRadiusPc']!.value).toBe(15000);
  });
});

describe('setContextScale', () => {
  it('uPcToUnits seeds to exactly 1 (galaxy context is bit-identical)', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusPc: 500 });
    const mat = (imp.object as THREE.Mesh).material as THREE.ShaderMaterial;
    expect(mat.uniforms['uPcToUnits']!.value).toBe(1);
  });

  it('mutates uPcToUnits in place', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusPc: 500 });
    const mat = (imp.object as THREE.Mesh).material as THREE.ShaderMaterial;
    const before = mat.uniforms['uPcToUnits'];

    imp.setContextScale(1e-6);

    expect(mat.uniforms['uPcToUnits']).toBe(before);
    expect(mat.uniforms['uPcToUnits']!.value).toBe(1e-6);
  });
});

// ---------------------------------------------------------------------------
// Material flags
// ---------------------------------------------------------------------------

describe('material flags', () => {
  const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusPc: 500 });
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
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusPc: 500 });
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
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusPc: 500 });
    const mat = (imp.object as THREE.Mesh).material as THREE.ShaderMaterial;

    imp.setOpacity(0.3);
    expect(mat.uniforms['uOpacity']!.value).toBeCloseTo(0.3);
  });

  it('second call uses the same uniform slot', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusPc: 500 });
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
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusPc: 500 });
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
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusPc: 500 });
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
    const imp = createGalaxyImpostor({ spriteTexture: tex, radiusPc: 500 });
    const spyTex = vi.spyOn(tex, 'dispose');

    imp.dispose();
    expect(spyTex).not.toHaveBeenCalled();
  });

  it('second dispose call is a no-op', () => {
    const imp = createGalaxyImpostor({ spriteTexture: makeTexture(), radiusPc: 500 });
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
