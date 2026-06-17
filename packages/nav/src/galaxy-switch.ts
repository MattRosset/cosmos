/**
 * Automatic universe⇄galaxy context switching (TASK-037, architecture §5.2,
 * ADR-001 §1–§4). Mirrors context-switch.ts one scale up.
 */
import type { BodyId } from '@cosmos/core-types';

/** A candidate galaxy the camera may seamlessly descend into. */
export interface GalaxyAnchor {
  /** Galaxy id, e.g. "proc:milkyway". */
  readonly id: BodyId;
  /** Galaxy center's absolute UNIVERSE-frame position, MEGAPARSECS (f64). */
  readonly positionMpc: readonly [number, number, number];
}

/** Hysteresis for the universe⇄galaxy boundary, METERS (camera↔galaxy center). */
export interface GalaxySwitchPolicy {
  readonly enterGalaxyAtM: number; // default 1.543e21  (≈ 50 kpc)
  readonly exitGalaxyAtM: number;  // default 3.086e21  (≥ 1.5× enter, ctor-checked)
}

/** Defaults per the frozen interface (TASK-037). */
export const DEFAULT_GALAXY_SWITCH_POLICY: GalaxySwitchPolicy = {
  enterGalaxyAtM: 1.543e21,
  exitGalaxyAtM: 3.086e21,
};

/** LOD-popping doctrine §5.8 applied to the universe↔galaxy boundary. */
export const GALAXY_HYSTERESIS_MIN_RATIO = 1.5;

/**
 * Resolve a partial policy against the defaults and enforce the hysteresis
 * floor. Throws `RangeError` if `exitGalaxyAtM < 1.5 × enterGalaxyAtM`.
 */
export function resolveGalaxySwitchPolicy(
  partial?: Partial<GalaxySwitchPolicy>,
): GalaxySwitchPolicy {
  const enterGalaxyAtM =
    partial?.enterGalaxyAtM ?? DEFAULT_GALAXY_SWITCH_POLICY.enterGalaxyAtM;
  const exitGalaxyAtM =
    partial?.exitGalaxyAtM ?? DEFAULT_GALAXY_SWITCH_POLICY.exitGalaxyAtM;
  if (exitGalaxyAtM < GALAXY_HYSTERESIS_MIN_RATIO * enterGalaxyAtM) {
    throw new RangeError(
      `nav: exitGalaxyAtM (${exitGalaxyAtM}) must be ≥ ${GALAXY_HYSTERESIS_MIN_RATIO}× ` +
        `enterGalaxyAtM (${enterGalaxyAtM}) to avoid context flapping (§5.8).`,
    );
  }
  return { enterGalaxyAtM, exitGalaxyAtM };
}

/** Pure: universe→galaxy when the camera is inside the enter threshold. */
export function shouldEnterGalaxy(dM: number, policy: GalaxySwitchPolicy): boolean {
  return dM < policy.enterGalaxyAtM;
}

/** Pure: galaxy→universe when the anchor is gone or the camera left the exit gap. */
export function shouldExitGalaxy(
  dM: number,
  anchorCleared: boolean,
  policy: GalaxySwitchPolicy,
): boolean {
  return anchorCleared || dM > policy.exitGalaxyAtM;
}
