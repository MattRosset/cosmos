/**
 * Guided-tour steps. See docs/architecture.md §5.12.
 *
 * A tour is an ordered list of stops; the camera flies to each target and dwells
 * while narration is shown in the tour chrome (TASK-050). Data contract only.
 */

import type { BodyId } from './bodies';

/** One stop in a guided tour. The target is a body the camera flies to; narration
 *  is shown in the tour chrome (TASK-050) while dwelling. */
export interface TourStep {
  readonly targetId: BodyId;
  /** Heading shown in the tour card. */
  readonly title: string;
  /** Educational body text (plain string; no HTML). */
  readonly narration: string;
  /** Dwell time at the target after arrival, ms. */
  readonly dwellMs: number;
  /** Optional: auto-orbit the target during the dwell (TASK-051). */
  readonly orbit?: boolean;
}

export interface Tour {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly TourStep[];
}
