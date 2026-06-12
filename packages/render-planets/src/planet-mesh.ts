import * as THREE from 'three';
import type { PlanetRecord } from '@cosmos/core-types';
import { PLANET_VERT } from './shaders/planet.vert.glsl.js';
import { PLANET_FRAG_LIT, PLANET_FRAG_UNLIT } from './shaders/planet.frag.glsl.js';
import { RING_FRAG } from './shaders/ring.frag.glsl.js';
import { buildRingGeometry } from './ring.js';

export interface PlanetMeshOptions {
  readonly record: PlanetRecord;
  readonly contextUnitMeters: number;
  readonly albedoTexture?: THREE.Texture | null;
  readonly ringTexture?: THREE.Texture | null;
  readonly widthSegments?: number;
  readonly heightSegments?: number;
}

export interface PlanetMesh {
  readonly object: THREE.Group;
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setStarDirection(dirUnit: readonly [number, number, number]): void;
  setSpinAngleRad(angleRad: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createPlanetMesh(opts: PlanetMeshOptions): PlanetMesh {
  const {
    record,
    contextUnitMeters,
    albedoTexture = null,
    ringTexture = null,
    widthSegments = 64,
    heightSegments = 48,
  } = opts;

  if (!record.radiusKm || record.radiusKm <= 0) {
    throw new RangeError(
      `PlanetRecord "${record.id}" has invalid radiusKm: ${record.radiusKm}`,
    );
  }

  const scaleUnits = (record.radiusKm * 1000) / contextUnitMeters;
  const surfaceColor = record.surfaceColorLinear ?? [0.5, 0.5, 0.5];

  // --- Sphere geometry (unit radius, scaled via object.scale) ---------------
  const sphereGeom = new THREE.SphereGeometry(1, widthSegments, heightSegments);

  const hasAlbedo = albedoTexture != null;
  const isUnlit = record.unlit === true;

  const sphereUniforms = {
    uRenderOffset: { value: new THREE.Vector3() },
    uAlbedo: { value: albedoTexture ?? new THREE.Texture() },
    uHasAlbedo: { value: hasAlbedo },
    uBaseColor: { value: new THREE.Vector3(surfaceColor[0], surfaceColor[1], surfaceColor[2]) },
    uStarDir: { value: new THREE.Vector3(0, 1, 0) },
  };

  const sphereMat = new THREE.ShaderMaterial({
    uniforms: sphereUniforms,
    vertexShader: PLANET_VERT,
    fragmentShader: isUnlit ? PLANET_FRAG_UNLIT : PLANET_FRAG_LIT,
  });

  const sphereMesh = new THREE.Mesh(sphereGeom, sphereMat);
  sphereMesh.scale.setScalar(scaleUnits);

  // --- Axial tilt group (spin happens inside here) --------------------------
  const tiltGroup = new THREE.Group();
  tiltGroup.rotation.x = record.axialTiltRad ?? 0;
  tiltGroup.add(sphereMesh);

  // --- Ring annulus (optional) ----------------------------------------------
  let ringGeom: THREE.RingGeometry | null = null;
  let ringMat: THREE.ShaderMaterial | null = null;
  let ringUniforms: Record<string, { value: unknown }> | null = null;

  if (record.ring) {
    const innerUnits = (record.ring.innerRadiusKm * 1000) / contextUnitMeters;
    const outerUnits = (record.ring.outerRadiusKm * 1000) / contextUnitMeters;
    ringGeom = buildRingGeometry(innerUnits, outerUnits, 64);

    // Ring normal in local space is +Y (equatorial plane normal).
    ringUniforms = {
      uRingTex: { value: ringTexture ?? new THREE.Texture() },
      uHasRingTex: { value: ringTexture != null },
      uRingNormalWorld: { value: new THREE.Vector3(0, 1, 0) },
      uStarDir: { value: new THREE.Vector3(0, 1, 0) },
    };

    ringMat = new THREE.ShaderMaterial({
      uniforms: ringUniforms,
      vertexShader: PLANET_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const ringMesh = new THREE.Mesh(ringGeom, ringMat);
    tiltGroup.add(ringMesh);
  }

  // --- Root group (offset applied here) ------------------------------------
  const group = new THREE.Group();
  group.add(tiltGroup);

  // Preallocated vectors for zero-alloc set* methods.
  const _offset = new THREE.Vector3();
  const _starDir = new THREE.Vector3();

  let disposed = false;

  return {
    object: group,

    setRenderOffset([x, y, z]: readonly [number, number, number]): void {
      _offset.x = x;
      _offset.y = y;
      _offset.z = z;
      group.position.copy(_offset);
    },

    setStarDirection([x, y, z]: readonly [number, number, number]): void {
      _starDir.x = x;
      _starDir.y = y;
      _starDir.z = z;
      const su = sphereUniforms['uStarDir']!.value as THREE.Vector3;
      su.x = x;
      su.y = y;
      su.z = z;
      if (ringUniforms) {
        const ru = ringUniforms['uStarDir']!.value as THREE.Vector3;
        ru.x = x;
        ru.y = y;
        ru.z = z;
      }
    },

    setSpinAngleRad(angleRad: number): void {
      sphereMesh.rotation.y = angleRad;
    },

    setVisible(visible: boolean): void {
      group.visible = visible;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      sphereGeom.dispose();
      sphereMat.dispose();
      if (ringGeom) ringGeom.dispose();
      if (ringMat) ringMat.dispose();
      // Never dispose injected textures — app shares them across remounts.
    },
  };
}
