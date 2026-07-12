import { CONTEXT_UNIT_METERS, type ContextId } from '@cosmos/core-types';

/**
 * Scale-ruler segment mapping (TASK-067 D3). PURE: segments are a function of
 * ONLY (contextId, cameraLocalDistanceM) — the two quantities the engine can
 * report — so the e2e ruler test can recompute the expected segment from
 * `__cosmos.contextId` + `hypot(__cosmos.cameraPosition.local) ×
 * CONTEXT_UNIT_METERS[contextId]` and get an identical answer. No hidden inputs.
 *
 * `cameraLocalDistanceM` is the magnitude of the camera's local coordinate in
 * the CURRENT context frame in meters — distance from the context-frame ORIGIN
 * (not from a system/Sol anchor).
 */
export type ScaleRulerSegment =
  | 'planet'
  | 'system'
  | 'starfield'
  | 'galactic-survey'
  | 'universe';

/** Ruler segments in ascending scale order — the component renders this list. */
export const SCALE_RULER_SEGMENTS: readonly ScaleRulerSegment[] = [
  'planet',
  'system',
  'starfield',
  'galactic-survey',
  'universe',
];

/**
 * Galaxy-context split: star field vs. galactic survey. PINNED to 2,000 pc
 * (spec §Frozen Interface): the galaxy frame origin ≈ Sol, so the Sol-boot
 * vantage (|cameraLocal| ≈ 0.06 pc) reads 'starfield' and the post-viewGalaxy
 * vantage (≈ 49,000 pc) reads 'galactic-survey' — both well clear of the line.
 */
export const GALACTIC_SURVEY_MIN_PC = 2_000;

const GALACTIC_SURVEY_MIN_M = GALACTIC_SURVEY_MIN_PC * CONTEXT_UNIT_METERS.galaxy;

export function scaleRulerSegment(
  contextId: ContextId,
  cameraLocalDistanceM: number,
): ScaleRulerSegment {
  switch (contextId) {
    case 'planet':
      return 'planet';
    case 'system':
      return 'system';
    case 'galaxy':
      return cameraLocalDistanceM >= GALACTIC_SURVEY_MIN_M ? 'galactic-survey' : 'starfield';
    case 'universe':
      return 'universe';
  }
}
