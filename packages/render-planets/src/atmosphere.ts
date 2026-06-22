import * as THREE from 'three';
import { ATMOSPHERE_DEFAULTS, type AtmosphereParams } from '@cosmos/core-types';
import { ATMOSPHERE_VERT } from './shaders/atmosphere.vert.glsl.js';
import { ATMOSPHERE_FRAG } from './shaders/atmosphere.frag.glsl.js';

export interface AtmosphereOptions {
  /** Planet surface radius in CONTEXT UNITS (e.g. AU for the system context). */
  readonly planetRadiusUnits: number;
  /** Scattering params; absent fields fall back to ATMOSPHERE_DEFAULTS (ADR-005 §3). */
  readonly params?: AtmosphereParams;
  readonly widthSegments?: number; // default 64
  readonly heightSegments?: number; // default 48
}

export interface Atmosphere {
  readonly object: THREE.Object3D; // the inverted shell mesh (BackSide)
  /** Per frame: camera-relative shell-center position, CONTEXT UNITS. Zero alloc. */
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  /** Per frame: unit vector planet→star (same convention as PlanetMesh). */
  setStarDirection(dir: readonly [number, number, number]): void;
  setExposure(v: number): void;
  /** Cross-fade alpha in [0,1]. */
  setOpacity(a: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createAtmosphere(opts: AtmosphereOptions): Atmosphere {
  const { planetRadiusUnits, params, widthSegments = 64, heightSegments = 48 } = opts;

  if (!(planetRadiusUnits > 0)) {
    throw new RangeError(`createAtmosphere: planetRadiusUnits must be > 0, got ${planetRadiusUnits}`);
  }

  // ADR-005 §3: absent fields ⇒ the matching ATMOSPHERE_DEFAULTS value (single source).
  const atmosphereRadiusScale = params?.atmosphereRadiusScale ?? ATMOSPHERE_DEFAULTS.atmosphereRadiusScale;
  const betaRayleigh = params?.betaRayleigh ?? ATMOSPHERE_DEFAULTS.betaRayleigh;
  const betaMie = params?.betaMie ?? ATMOSPHERE_DEFAULTS.betaMie;
  const rayleighScaleHeight = params?.rayleighScaleHeight ?? ATMOSPHERE_DEFAULTS.rayleighScaleHeight;
  const mieG = params?.mieG ?? ATMOSPHERE_DEFAULTS.mieG;
  const sunIntensity = params?.sunIntensity ?? ATMOSPHERE_DEFAULTS.sunIntensity;

  const atmosphereRadiusUnits = planetRadiusUnits * atmosphereRadiusScale;

  // Shell geometry built at the atmosphere radius in context units, so `position`
  // is shell-center-relative in the space the O'Neil integral works in (ADR-005 §2).
  const geometry = new THREE.SphereGeometry(atmosphereRadiusUnits, widthSegments, heightSegments);

  const uniforms = {
    uStarDir: { value: new THREE.Vector3(0, 1, 0) },
    uRenderOffset: { value: new THREE.Vector3() },
    uPlanetRadius: { value: planetRadiusUnits },
    uAtmosphereRadius: { value: atmosphereRadiusUnits },
    uBetaRayleigh: { value: new THREE.Vector3(betaRayleigh[0], betaRayleigh[1], betaRayleigh[2]) },
    uBetaMie: { value: betaMie },
    uRayleighScaleHeight: { value: rayleighScaleHeight },
    uMieG: { value: mieG },
    uSunIntensity: { value: sunIntensity },
    uCameraExposure: { value: 1.0 },
    uOpacity: { value: 1.0 },
  };

  // Transparent, additive over the lit planet; BackSide so the inner surface shows
  // from inside or outside the shell (ADR-005 §1). depthWrite off (§10 transparent band).
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: ATMOSPHERE_VERT,
    fragmentShader: ATMOSPHERE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(geometry, material);

  let disposed = false;

  return {
    object: mesh,

    setRenderOffset([x, y, z]: readonly [number, number, number]): void {
      const v = uniforms.uRenderOffset.value;
      v.x = x;
      v.y = y;
      v.z = z;
    },

    setStarDirection([x, y, z]: readonly [number, number, number]): void {
      const v = uniforms.uStarDir.value;
      v.x = x;
      v.y = y;
      v.z = z;
    },

    setExposure(v: number): void {
      uniforms.uCameraExposure.value = v;
    },

    setOpacity(a: number): void {
      uniforms.uOpacity.value = a;
    },

    setVisible(visible: boolean): void {
      mesh.visible = visible;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
      // Nothing injected to dispose (no textures); contract kept for symmetry.
    },
  };
}
