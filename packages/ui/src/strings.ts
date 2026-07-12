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

  // First-run overlay (V1) — teaches the three movement modes (research §5.1). This
  // is the whole thesis: users don't know three distinct modes exist. The three-mode
  // body absorbs the retired permanent help wall's WASD/controls literacy.
  firstRunTitle: 'Three ways to move through the cosmos',
  firstRunJumpTitle: 'Scale jump',
  firstRunJumpBody:
    'Double-click a star, or use the breadcrumb, to leap across the galaxy. The trip always takes a few seconds — distance does not matter.',
  firstRunExploreTitle: 'Free flight',
  firstRunExploreBody:
    'WASD to fly, R/F for up/down, drag to look, G to frame. Speed scales to whatever is nearest, so it feels slow at galactic vantage — that is expected.',
  firstRunTourTitle: 'Guided tour',
  firstRunTourBody: 'Press ▶ Guided tour to sit back for a narrated cinematic path through the highlights.',
  firstRunDismiss: 'Start exploring',
  firstRunReopenLabel: 'Movement guide',
  firstRunHint: 'Ctrl+K to search · H for a clean view',

  // W1 breadcrumb tooltips (TASK-067) — name the mechanism: a scale link, not flight.
  breadcrumbMilkyWayTip: 'Jump to Milky Way view (scale link)',
  breadcrumbStarfieldTip: 'Return to star field',

  // W2 unified Jump HUD (TASK-067) — progress readout + arrival summary card.
  jumpRemainingSuffix: 'ly remaining',
  jumpArrivedPrefix: 'Jumped',
  jumpFovPrefix: 'Field of view: ~',
  jumpFovSuffix: 'ly across',
  jumpDismiss: 'Dismiss',

  // D3 scale ruler (TASK-067) — one label per ScaleRulerSegment + the bar's name.
  rulerLabel: 'Scale',
  rulerPlanet: 'Planet',
  rulerSystem: 'System',
  rulerStarfield: 'Star field',
  rulerGalacticSurvey: 'Galactic survey',
  rulerUniverse: 'Universe',
} as const satisfies Readonly<Record<string, string>>;

export type StringKey = keyof typeof STRINGS;
