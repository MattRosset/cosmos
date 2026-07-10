/**
 * All user-facing perception copy lives here — one module, English, no scattered
 * literals (TASK-066 §Constraints). Components and app glue read `STRINGS[...]`;
 * do not inline perception strings anywhere else.
 */

/**
 * Scale-jump gate shared by the mode badge (S2), letterbox/Jump HUD (TASK-067 W2),
 * and the descend hint. A `goTo` whose snapshotted target distance is ≥ this many
 * parsecs is a "scale jump"; shorter flights are plain exploration.
 */
export const SCALE_JUMP_THRESHOLD_PC = 100;

export const STRINGS = {
  // Movement-mode badge (S2)
  modeScaleJump: 'Scale jump',
  modeExploring: 'Exploring',

  // D7/D8 galactic-vantage hint — WASD barely moves at Milky Way scale
  galacticDescendHint: 'Barely moving? Use ◂ Galaxy to descend to a star.',

  // InfoPanel light-travel lead-in (V1 honesty: real distances, real time)
  lightTravelPrefix: 'light takes',
  lightTravelSuffix: 'to reach us',
} as const satisfies Readonly<Record<string, string>>;

export type StringKey = keyof typeof STRINGS;
