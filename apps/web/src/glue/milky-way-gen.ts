/**
 * Procgen Milky Way overrides (TASK-040 Tier-1 visual experiment).
 * Shared by streaming (star cloud) and galaxy-assets (dust-lane placement).
 */
import type { GalaxyGenParams } from '@cosmos/core-types';
import { PROCGEN_GALAXY_DEFAULTS } from '@cosmos/core-types';
import type { GalaxyArmGeometry } from '@cosmos/render-galaxy';
import { MILKY_WAY_STAR_COUNT } from './local-group';

/** Stronger spiral structure + four major arms (reference-galaxy trial). */
export const MILKY_WAY_GEN_OVERRIDES = {
  armCount: 4,
  armContrast: 3.5,
  armWidthPc: 1400,
} as const satisfies Partial<GalaxyGenParams>;

/** Resolved Milky Way procgen + arm geometry (shared by streaming and shaders). */
export function milkyWayResolvedParams() {
  return { ...PROCGEN_GALAXY_DEFAULTS, ...MILKY_WAY_GEN_OVERRIDES };
}

export function milkyWayArmGeometry(dustStrength = 0.45): GalaxyArmGeometry {
  const p = milkyWayResolvedParams();
  return {
    scaleLengthPc: p.discScaleLengthPc,
    armCount: p.armCount,
    armPitchRad: p.armPitchRad,
    armWindings: p.armWindings,
    armWidthPc: p.armWidthPc,
    dustStrength,
  };
}

export function milkyWayGenParams(seed: number): GalaxyGenParams {
  return {
    seed,
    starCount: MILKY_WAY_STAR_COUNT,
    ...MILKY_WAY_GEN_OVERRIDES,
  };
}
