import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ATMOSPHERE_DEFAULTS } from '@cosmos/core-types';
import { createAtmosphere } from '../src/atmosphere.js';
import { ATMOSPHERE_FRAG } from '../src/shaders/atmosphere.frag.glsl.js';

const AU = 1.495978707e11;
// Earth radius in AU (the system-context unit).
const EARTH_RADIUS_UNITS = (6371 * 1000) / AU;

function mesh(atm: ReturnType<typeof createAtmosphere>): THREE.Mesh {
  return atm.object as THREE.Mesh;
}
function mat(atm: ReturnType<typeof createAtmosphere>): THREE.ShaderMaterial {
  return mesh(atm).material as THREE.ShaderMaterial;
}

// ---------------------------------------------------------------------------
// Mesh / material contract (ADR-005 §1–§2)
// ---------------------------------------------------------------------------

describe('mesh & material', () => {
  it('object is a Mesh', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    expect(mesh(atm)).toBeInstanceOf(THREE.Mesh);
  });

  it('material is BackSide (inverted shell)', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    expect(mat(atm).side).toBe(THREE.BackSide);
  });

  it('material is transparent with depthWrite === false', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    expect(mat(atm).transparent).toBe(true);
    expect(mat(atm).depthWrite).toBe(false);
  });

  it('material uses additive blending', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    expect(mat(atm).blending).toBe(THREE.AdditiveBlending);
  });

  it('shell radius is planetRadiusUnits × atmosphereRadiusScale (default 1.025)', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    const geom = mesh(atm).geometry as THREE.SphereGeometry;
    const expected = EARTH_RADIUS_UNITS * 1.025;
    expect(Math.abs(geom.parameters.radius - expected) / expected).toBeLessThan(1e-9);
  });

  it('shell radius honors a custom atmosphereRadiusScale', () => {
    const atm = createAtmosphere({
      planetRadiusUnits: EARTH_RADIUS_UNITS,
      params: { atmosphereRadiusScale: 1.1 },
    });
    const geom = mesh(atm).geometry as THREE.SphereGeometry;
    expect(geom.parameters.radius).toBeCloseTo(EARTH_RADIUS_UNITS * 1.1, 20);
  });

  it('default segments are 64 / 48', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    const geom = mesh(atm).geometry as THREE.SphereGeometry;
    expect(geom.parameters.widthSegments).toBe(64);
    expect(geom.parameters.heightSegments).toBe(48);
  });

  it('throws RangeError when planetRadiusUnits is not positive', () => {
    expect(() => createAtmosphere({ planetRadiusUnits: 0 })).toThrow(RangeError);
    expect(() => createAtmosphere({ planetRadiusUnits: -1 })).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Shader source (O'Neil analytic single-scattering)
// ---------------------------------------------------------------------------

describe('fragment shader source', () => {
  it('contains the O\'Neil scale() optical-depth term', () => {
    expect(ATMOSPHERE_FRAG).toContain('scale(');
  });

  it('uses the fixed uSamples = 5 in-scatter count', () => {
    expect(ATMOSPHERE_FRAG).toContain('uSamples');
    expect(ATMOSPHERE_FRAG).toContain('5');
    expect(ATMOSPHERE_FRAG).toContain('#define uSamples 5');
  });

  it('declares all ADR-005 §5 uniforms', () => {
    for (const name of [
      'uStarDir',
      'uRenderOffset',
      'uPlanetRadius',
      'uAtmosphereRadius',
      'uBetaRayleigh',
      'uBetaMie',
      'uRayleighScaleHeight',
      'uMieG',
      'uSunIntensity',
      'uCameraExposure',
      'uOpacity',
    ]) {
      expect(ATMOSPHERE_FRAG).toContain(name);
    }
  });

  it('material uniforms include all ADR-005 §5 names', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    const u = mat(atm).uniforms;
    for (const name of [
      'uStarDir',
      'uRenderOffset',
      'uPlanetRadius',
      'uAtmosphereRadius',
      'uBetaRayleigh',
      'uBetaMie',
      'uRayleighScaleHeight',
      'uMieG',
      'uSunIntensity',
      'uCameraExposure',
      'uOpacity',
    ]) {
      expect(u[name]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Defaults & param overrides (ADR-005 §3)
// ---------------------------------------------------------------------------

describe('defaults from ATMOSPHERE_DEFAULTS', () => {
  it('absent params ⇒ uniforms equal the defaults', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    const u = mat(atm).uniforms;
    expect(u['uMieG']!.value).toBe(-0.758);
    const br = u['uBetaRayleigh']!.value as THREE.Vector3;
    expect(br.x).toBe(ATMOSPHERE_DEFAULTS.betaRayleigh[0]);
    expect(br.y).toBe(ATMOSPHERE_DEFAULTS.betaRayleigh[1]);
    expect(br.z).toBe(ATMOSPHERE_DEFAULTS.betaRayleigh[2]);
    expect(u['uBetaMie']!.value).toBe(ATMOSPHERE_DEFAULTS.betaMie);
    expect(u['uRayleighScaleHeight']!.value).toBe(ATMOSPHERE_DEFAULTS.rayleighScaleHeight);
    expect(u['uSunIntensity']!.value).toBe(ATMOSPHERE_DEFAULTS.sunIntensity);
  });

  it('partial params overrides only its own fields', () => {
    const atm = createAtmosphere({
      planetRadiusUnits: EARTH_RADIUS_UNITS,
      params: { mieG: -0.5, sunIntensity: 33 },
    });
    const u = mat(atm).uniforms;
    expect(u['uMieG']!.value).toBe(-0.5);
    expect(u['uSunIntensity']!.value).toBe(33);
    // Untouched fields still come from defaults.
    const br = u['uBetaRayleigh']!.value as THREE.Vector3;
    expect(br.x).toBe(ATMOSPHERE_DEFAULTS.betaRayleigh[0]);
    expect(u['uBetaMie']!.value).toBe(ATMOSPHERE_DEFAULTS.betaMie);
  });

  it('betaRayleigh override is reflected per-channel', () => {
    const atm = createAtmosphere({
      planetRadiusUnits: EARTH_RADIUS_UNITS,
      params: { betaRayleigh: [1e-3, 2e-3, 4e-3] },
    });
    const br = mat(atm).uniforms['uBetaRayleigh']!.value as THREE.Vector3;
    expect([br.x, br.y, br.z]).toEqual([1e-3, 2e-3, 4e-3]);
  });
});

// ---------------------------------------------------------------------------
// Zero-allocation set* methods
// ---------------------------------------------------------------------------

describe('set* zero-alloc', () => {
  it('setRenderOffset mutates uRenderOffset in place', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    const v = mat(atm).uniforms['uRenderOffset']!.value as THREE.Vector3;
    atm.setRenderOffset([1, 2, 3]);
    expect(mat(atm).uniforms['uRenderOffset']!.value).toBe(v);
    expect([v.x, v.y, v.z]).toEqual([1, 2, 3]);
  });

  it('setStarDirection mutates uStarDir in place', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    const v = mat(atm).uniforms['uStarDir']!.value as THREE.Vector3;
    atm.setStarDirection([0, 0, 1]);
    expect(mat(atm).uniforms['uStarDir']!.value).toBe(v);
    expect([v.x, v.y, v.z]).toEqual([0, 0, 1]);
  });

  it('setExposure mutates uCameraExposure', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    atm.setExposure(2.5);
    expect(mat(atm).uniforms['uCameraExposure']!.value).toBe(2.5);
  });

  it('setOpacity mutates uOpacity', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    atm.setOpacity(0.4);
    expect(mat(atm).uniforms['uOpacity']!.value).toBe(0.4);
  });

  it('setVisible toggles mesh.visible', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    atm.setVisible(false);
    expect(mesh(atm).visible).toBe(false);
    atm.setVisible(true);
    expect(mesh(atm).visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dispose
// ---------------------------------------------------------------------------

describe('dispose', () => {
  it('disposes geometry and material exactly once', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    const spyGeom = vi.spyOn(mesh(atm).geometry, 'dispose');
    const spyMat = vi.spyOn(mat(atm), 'dispose');
    atm.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
    expect(spyMat).toHaveBeenCalledTimes(1);
  });

  it('second dispose is a no-op', () => {
    const atm = createAtmosphere({ planetRadiusUnits: EARTH_RADIUS_UNITS });
    const spyGeom = vi.spyOn(mesh(atm).geometry, 'dispose');
    atm.dispose();
    atm.dispose();
    expect(spyGeom).toHaveBeenCalledTimes(1);
  });
});
