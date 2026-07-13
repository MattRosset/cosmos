import { formatEtaAtC } from './format';
import { SCALE_JUMP_THRESHOLD_PC } from './strings';

/**
 * Jump HUD model (TASK-067 W2 + W2a) — a pure state machine; the DOM component
 * only renders what it is given, and the app host owns the clock, the flight
 * controller subscription, and localStorage. Everything here is unit-testable
 * with plain values.
 */

/** ly per pc — distanceTotalLy = snapshotted jump distance (pc) × this. */
export const PC_TO_LY = 3.2616;
/** Meters per light-year — converts live tree.distanceMeters() to ly. */
export const METERS_PER_LY = 9.4607e15;
/** W2a: full arrival card while the prior large-jump count is below this. */
export const FULL_ARRIVAL_CARD_JUMPS = 3;
/** localStorage keys for the W2a repetition-dampening counters. */
export const JUMP_COUNT_KEY = 'cosmos.jumps.large.count';
export const LETTERBOX_SHOWN_KEY = 'cosmos.jumps.letterboxShown';

export interface JumpHudModel {
  phase: 'idle' | 'jumping' | 'arrived';
  distanceTotalLy: number; // snapshotted at goTo start = jumpDistancePcHolder × 3.2616 (pc→ly)
  distanceRemainingLy: number; // LIVE: tree.distanceMeters(state.position, target) → ly
  etaAtC: string; // formatEtaAtC(distanceTotalLy)
  showFullArrivalCard: boolean; // W2a dampening decision
  letterbox: boolean; // W2a: first large jump only (default)
}

/** W2a persisted counters, read from / written to localStorage by the host. */
export interface JumpDampening {
  /** Completed large jumps so far (`cosmos.jumps.large.count`). */
  largeJumpCount: number;
  /** Letterbox already shown once (`cosmos.jumps.letterboxShown`). */
  letterboxShown: boolean;
}

export const JUMP_HUD_IDLE: JumpHudModel = {
  phase: 'idle',
  distanceTotalLy: 0,
  distanceRemainingLy: 0,
  etaAtC: '',
  showFullArrivalCard: false,
  letterbox: false,
};

/**
 * Start-of-flight transition. Returns null for sub-threshold hops — the Jump
 * HUD narrates scale jumps only (shared S2/D4/W2 gate). Dampening decisions
 * (full card vs. one-liner, letterbox) are taken HERE, from the counters as
 * they stood before this jump.
 */
export function beginJump(distancePc: number, dampening: JumpDampening): JumpHudModel | null {
  if (!(distancePc >= SCALE_JUMP_THRESHOLD_PC)) return null;
  const totalLy = distancePc * PC_TO_LY;
  return {
    phase: 'jumping',
    distanceTotalLy: totalLy,
    distanceRemainingLy: totalLy,
    etaAtC: formatEtaAtC(totalLy),
    showFullArrivalCard: dampening.largeJumpCount < FULL_ARRIVAL_CARD_JUMPS,
    letterbox: !dampening.letterboxShown,
  };
}

/**
 * Mid-flight tick: feed the LIVE remaining distance in meters (the host queries
 * `tree.distanceMeters(controller.state.position, target)` — never a re-derived
 * total×(1−progress)). Clamped to [0, total] so float noise near arrival never
 * shows a negative or growing readout.
 */
export function updateRemaining(model: JumpHudModel, remainingMeters: number): JumpHudModel {
  if (model.phase !== 'jumping') return model;
  const ly = Math.min(Math.max(remainingMeters / METERS_PER_LY, 0), model.distanceTotalLy);
  return { ...model, distanceRemainingLy: ly };
}

/**
 * `onGoToEnd(completed)` transition: arrival morphs the HUD into the summary
 * card; a cancel (user grabbed the controls) unmounts with NO arrival card.
 */
export function endJump(model: JumpHudModel, completed: boolean): JumpHudModel {
  if (model.phase !== 'jumping') return model;
  if (!completed) return JUMP_HUD_IDLE;
  return { ...model, phase: 'arrived', distanceRemainingLy: 0 };
}

/** Counters after a jump STARTS: the letterbox, once shown, never repeats. */
export function dampeningAtJumpStart(
  dampening: JumpDampening,
  model: JumpHudModel,
): JumpDampening {
  return model.letterbox ? { ...dampening, letterboxShown: true } : dampening;
}

/** Counters after a COMPLETED arrival: one more large jump on the record. */
export function dampeningAtArrival(dampening: JumpDampening): JumpDampening {
  return { ...dampening, largeJumpCount: dampening.largeJumpCount + 1 };
}
