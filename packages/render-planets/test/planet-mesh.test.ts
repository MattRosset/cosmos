import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { PlanetRecord } from '@cosmos/core-types';
import { createPlanetMesh } from '../src/planet-mesh.js';
import { PLANET_FRAG_LIT, PLANET_FRAG_UNLIT } from '../src/shaders/planet.frag.glsl.js';

const AU = 1.495978707e11;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const earthRecord: PlanetRecord = {
  id: 'sol:earth',
  kind: 'planet',
  parentId: 'sol:sun',
  name: 'Earth',
  radiusKm: 6371,
  axialTiltRad: 0.4091,
  rotationPeriodH: 23.9345,
  surfaceColorLinear: [0.1, 0.3, 0.6],
};

const saturnRecord: PlanetRecord = {
  id: 'sol:saturn',
  kind: 'planet',
  parentId: 'sol:sun',
  name: 'Saturn',
  radiusKm: 60268,
  axialTiltRad: 0.4665,
  ring: { innerRadiusKm: 74500, outerRadiusKm: 140220 },
};

const exoRecord: PlanetRecord = {
  id: 'exo:kepler22b',
  kind: 'planet',
  parentId: 'exo:kepler22',
  name: 'Kepler-22b',
  radiusKm: 15290,
  surfaceColorLinear: [0.4, 0.5, 0.3],
};

const solRecord: PlanetRecord = {
  id: 'sol:sun',
  kind: 'planet',
  parentId: 'sol:sun',
  name: 'Sol',
  radiusKm: 695700,
  unlit: true,
};

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

describe('scale', () => {
  it('Earth sphere scale is ~4.2588e-5 context units (1e-9 relative tolerance)', () => {
    const pm = createPlanetMesh({ record: earthRecord, contextUnitMeters: AU });
    const group = pm.object;
    // tiltGroup is first child; sphereMesh is first child of tiltGroup
    const tiltGroup = group.children[0] as THREE.Group;
    const sphereMesh = tiltGroup.children[0] as THREE.Mesh;
    const expected = (6371 * 1000) / AU;
    const actual = sphereMesh.scale.x;
    expect(Math.abs(actual - expected) / expected).toBeLessThan(1e-9);
  });

  it('throws RangeError when radiusKm is missing', () => {
    const bad = { ...earthRecord, radiusKm: 0 };
    expect(() => createPlanetMesh({ record: bad, contextUnitMeters: AU })).toThrow(RangeError);
  });

  it('throws RangeError when radiusKm is negative', () => {
    const bad = { ...earthRecord, radiusKm: -100 };
    expect(() => createPlanetMesh({ record: bad, contextUnitMeters: AU })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Axial tilt & spin
// ---------------------------------------------------------------------------

describe('tilt and spin', () => {
  it('tiltGroup.rotation.x equals axialTiltRad', () => {
    const pm = createPlanetMesh({ record: earthRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    expect(tiltGroup.rotation.x).toBeCloseTo(earthRecord.axialTiltRad!, 10);
  });

  it('tiltGroup.rotation.x defaults to 0 when axialTiltRad is absent', () => {
    const pm = createPlanetMesh({ record: exoRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    expect(tiltGroup.rotation.x).toBe(0);
  });

  it('setSpinAngleRad sets sphere rotation.y', () => {
    const pm = createPlanetMesh({ record: earthRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    const sphereMesh = tiltGroup.children[0] as THREE.Mesh;
    pm.setSpinAngleRad(1.23);
    expect(sphereMesh.rotation.y).toBeCloseTo(1.23, 10);
  });

  it('setSpinAngleRad does not allocate (object identity stable)', () => {
    const pm = createPlanetMesh({ record: earthRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    const sphereMesh = tiltGroup.children[0] as THREE.Mesh;
    const rotBefore = sphereMesh.rotation;
    pm.setSpinAngleRad(2.0);
    expect(sphereMesh.rotation).toBe(rotBefore);
  });
});

// ---------------------------------------------------------------------------
// Shader strings
// ---------------------------------------------------------------------------

describe('shader strings — lit', () => {
  it('lit fragment contains uStarDir', () => {
    expect(PLANET_FRAG_LIT).toContain('uStarDir');
  });

  it('lit fragment contains terminator smoothstep(-0.08, 0.12', () => {
    expect(PLANET_FRAG_LIT).toContain('smoothstep(-0.08, 0.12');
  });

  it('lit fragment contains ambient floor 0.035', () => {
    expect(PLANET_FRAG_LIT).toContain('0.035');
  });
});

describe('shader strings — unlit', () => {
  it('unlit fragment does NOT contain uStarDir lighting term', () => {
    // The unlit shader must not perform lighting via uStarDir.
    expect(PLANET_FRAG_UNLIT).not.toContain('uStarDir');
  });
});

describe('shader selection', () => {
  it('lit record uses PLANET_FRAG_LIT', () => {
    const pm = createPlanetMesh({ record: earthRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    const sphereMesh = tiltGroup.children[0] as THREE.Mesh;
    const mat = sphereMesh.material as THREE.ShaderMaterial;
    expect(mat.fragmentShader).toBe(PLANET_FRAG_LIT);
  });

  it('unlit record uses PLANET_FRAG_UNLIT', () => {
    const pm = createPlanetMesh({ record: solRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    const sphereMesh = tiltGroup.children[0] as THREE.Mesh;
    const mat = sphereMesh.material as THREE.ShaderMaterial;
    expect(mat.fragmentShader).toBe(PLANET_FRAG_UNLIT);
  });
});

// ---------------------------------------------------------------------------
// Ring
// ---------------------------------------------------------------------------

describe('ring', () => {
  it('ring mesh is present when record.ring is set', () => {
    const pm = createPlanetMesh({ record: saturnRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    // tiltGroup has sphere + ring
    expect(tiltGroup.children.length).toBe(2);
  });

  it('ring mesh is absent when record.ring is not set', () => {
    const pm = createPlanetMesh({ record: earthRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    expect(tiltGroup.children.length).toBe(1);
  });

  it('ring UV u ≈ 0 at inner radius vertices, u ≈ 1 at outer radius', () => {
    const pm = createPlanetMesh({ record: saturnRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    const ringMesh = tiltGroup.children[1] as THREE.Mesh;
    const uv = ringMesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const pos = ringMesh.geometry.getAttribute('position') as THREE.BufferAttribute;

    const innerUnits = (saturnRecord.ring!.innerRadiusKm * 1000) / AU;
    const outerUnits = (saturnRecord.ring!.outerRadiusKm * 1000) / AU;

    let foundInner = false;
    let foundOuter = false;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const r = Math.sqrt(x * x + y * y);
      const u = uv.getX(i);

      if (Math.abs(r - innerUnits) / innerUnits < 0.01) {
        expect(u).toBeCloseTo(0, 1);
        foundInner = true;
      }
      if (Math.abs(r - outerUnits) / outerUnits < 0.01) {
        expect(u).toBeCloseTo(1, 1);
        foundOuter = true;
      }
    }

    expect(foundInner).toBe(true);
    expect(foundOuter).toBe(true);
  });

  it('ring material is transparent', () => {
    const pm = createPlanetMesh({ record: saturnRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    const ringMesh = tiltGroup.children[1] as THREE.Mesh;
    const mat = ringMesh.material as THREE.ShaderMaterial;
    expect(mat.transparent).toBe(true);
  });

  it('ring material is DoubleSide', () => {
    const pm = createPlanetMesh({ record: saturnRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    const ringMesh = tiltGroup.children[1] as THREE.Mesh;
    const mat = ringMesh.material as THREE.ShaderMaterial;
    expect(mat.side).toBe(THREE.DoubleSide);
  });

  it('ring material has depthWrite === false', () => {
    const pm = createPlanetMesh({ record: saturnRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    const ringMesh = tiltGroup.children[1] as THREE.Mesh;
    const mat = ringMesh.material as THREE.ShaderMaterial;
    expect(mat.depthWrite).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setRenderOffset — zero allocation
// ---------------------------------------------------------------------------

describe('setRenderOffset', () => {
  it('mutates group.position in place (same object identity)', () => {
    const pm = createPlanetMesh({ record: earthRecord, contextUnitMeters: AU });
    const posBefore = pm.object.position;
    pm.setRenderOffset([1, 2, 3]);
    expect(pm.object.position).toBe(posBefore);
    expect(pm.object.position.x).toBe(1);
    expect(pm.object.position.y).toBe(2);
    expect(pm.object.position.z).toBe(3);
  });

  it('second call still uses the same position identity', () => {
    const pm = createPlanetMesh({ record: earthRecord, contextUnitMeters: AU });
    const pos = pm.object.position;
    pm.setRenderOffset([4, 5, 6]);
    pm.setRenderOffset([7, 8, 9]);
    expect(pm.object.position).toBe(pos);
    expect(pos.x).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// setStarDirection — zero allocation
// ---------------------------------------------------------------------------

describe('setStarDirection', () => {
  it('updates sphere uStarDir uniform in place', () => {
    const pm = createPlanetMesh({ record: earthRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    const sphereMesh = tiltGroup.children[0] as THREE.Mesh;
    const mat = sphereMesh.material as THREE.ShaderMaterial;
    const vecBefore = mat.uniforms['uStarDir']!.value as THREE.Vector3;
    pm.setStarDirection([0, 1, 0]);
    expect(mat.uniforms['uStarDir']!.value).toBe(vecBefore);
    expect(vecBefore.y).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe('dispose', () => {
  it('disposes sphere geometry and material exactly once', () => {
    const pm = createPlanetMesh({ record: earthRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    const sphereMesh = tiltGroup.children[0] as THREE.Mesh;
    const mat = sphereMesh.material as THREE.ShaderMaterial;

    const spyGeom = vi.spyOn(sphereMesh.geometry, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');

    pm.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
  });

  it('disposes ring geometry and material when present', () => {
    const pm = createPlanetMesh({ record: saturnRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    const ringMesh = tiltGroup.children[1] as THREE.Mesh;
    const mat = ringMesh.material as THREE.ShaderMaterial;

    const spyGeom = vi.spyOn(ringMesh.geometry, 'dispose');
    const spyMat = vi.spyOn(mat, 'dispose');

    pm.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
  });

  it('does NOT dispose injected albedo texture', () => {
    const tex = new THREE.Texture();
    const spyTex = vi.spyOn(tex, 'dispose');
    const pm = createPlanetMesh({
      record: earthRecord,
      contextUnitMeters: AU,
      albedoTexture: tex,
    });
    pm.dispose();
    expect(spyTex).not.toHaveBeenCalled();
  });

  it('does NOT dispose injected ring texture', () => {
    const tex = new THREE.Texture();
    const spyTex = vi.spyOn(tex, 'dispose');
    const pm = createPlanetMesh({
      record: saturnRecord,
      contextUnitMeters: AU,
      ringTexture: tex,
    });
    pm.dispose();
    expect(spyTex).not.toHaveBeenCalled();
  });

  it('second dispose is a no-op', () => {
    const pm = createPlanetMesh({ record: earthRecord, contextUnitMeters: AU });
    const tiltGroup = pm.object.children[0] as THREE.Group;
    const sphereMesh = tiltGroup.children[0] as THREE.Mesh;
    const spyGeom = vi.spyOn(sphereMesh.geometry, 'dispose');
    pm.dispose();
    pm.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// setVisible
// ---------------------------------------------------------------------------

describe('setVisible', () => {
  it('sets group.visible', () => {
    const pm = createPlanetMesh({ record: earthRecord, contextUnitMeters: AU });
    pm.setVisible(false);
    expect(pm.object.visible).toBe(false);
    pm.setVisible(true);
    expect(pm.object.visible).toBe(true);
  });
});
