/**
 * Automatic galaxy⇄system context switching (TASK-027, architecture §5.3,
 * ADR-001 §3–§4). This module holds the policy type, defaults, the hysteresis
 * floor, and the *pure* threshold helpers. The stateful switch law lives in
 * controller.ts (it needs the live origin + velocity state).
 */
import type { BodyId, ContextId } from '@cosmos/core-types';

/** A candidate star system the camera may seamlessly descend into. */
export interface SystemAnchor {
  /** System id, e.g. "sol" or "exo:trappist-1". */
  readonly id: BodyId;
  /** Host star's absolute galaxy-frame position, parsecs (f64). */
  readonly positionPc: readonly [number, number, number];
}

/** Hysteresis thresholds, METERS (camera ↔ host star distance). */
export interface ContextSwitchPolicy {
  readonly enterSystemAtM: number; // default 7.5e14  (≈ 5,000 AU)
  readonly exitSystemAtM: number; // default 1.5e15  (≥ 1.5× enter, lint by ctor)
}

export interface ContextSwitchEvent {
  readonly from: ContextId;
  readonly to: ContextId;
  readonly anchorId: BodyId | null;
}

/** Defaults per the frozen interface (TASK-027). */
export const DEFAULT_CONTEXT_SWITCH_POLICY: ContextSwitchPolicy = {
  enterSystemAtM: 7.5e14,
  exitSystemAtM: 1.5e15,
};

/** LOD-popping doctrine §5.8 applied to contexts: exit must clear enter ×1.5. */
export const HYSTERESIS_MIN_RATIO = 1.5;

/**
 * Resolve a partial policy against the defaults and enforce the hysteresis
 * floor. Throws `RangeError` if `exitSystemAtM < 1.5 × enterSystemAtM`.
 */
export function resolveContextSwitchPolicy(
  partial?: Partial<ContextSwitchPolicy>,
): ContextSwitchPolicy {
  const enterSystemAtM = partial?.enterSystemAtM ?? DEFAULT_CONTEXT_SWITCH_POLICY.enterSystemAtM;
  const exitSystemAtM = partial?.exitSystemAtM ?? DEFAULT_CONTEXT_SWITCH_POLICY.exitSystemAtM;
  if (exitSystemAtM < HYSTERESIS_MIN_RATIO * enterSystemAtM) {
    throw new RangeError(
      `nav: exitSystemAtM (${exitSystemAtM}) must be ≥ ${HYSTERESIS_MIN_RATIO}× ` +
        `enterSystemAtM (${enterSystemAtM}) to avoid context flapping (§5.8).`,
    );
  }
  return { enterSystemAtM, exitSystemAtM };
}

/** Pure: galaxy→system when the camera is inside the enter threshold. */
export function shouldEnterSystem(dM: number, policy: ContextSwitchPolicy): boolean {
  return dM < policy.enterSystemAtM;
}

/** Pure: system→galaxy when the anchor is gone or the camera left the exit gap. */
export function shouldExitSystem(
  dM: number,
  anchorCleared: boolean,
  policy: ContextSwitchPolicy,
): boolean {
  return anchorCleared || dM > policy.exitSystemAtM;
}
