import { useCallback, useEffect, useRef, useState } from 'react';
import { CONTEXT_UNIT_METERS, type UniversePosition } from '@cosmos/core-types';
import type { ScaleFrameTree } from '@cosmos/coords';
import { useTourStore } from '@cosmos/app-state';
import {
  JUMP_COUNT_KEY,
  JUMP_HUD_IDLE,
  JumpHud,
  LETTERBOX_SHOWN_KEY,
  METERS_PER_LY,
  beginJump,
  dampeningAtArrival,
  dampeningAtJumpStart,
  endJump,
  updateRemaining,
  type JumpDampening,
  type JumpHudModel,
} from '@cosmos/ui';
import { controllerHolder, jumpDistancePcHolder } from '../glue/test-hook';

/**
 * D4 letterbox flag for large jumps — the Hud's `Letterbox` polls this as its
 * third activation source (alongside the cinematic store flag and the
 * controller's spline letterbox). Written only at jump start/end.
 */
export const jumpLetterboxHolder: { current: boolean } = { current: false };

/** Model tick cadence — the ≤10 Hz store the perf rules allow (§5.12). */
const TICK_MS = 100;
/** Arrival card lifetime before auto-dismiss (spec: 3–5 s, non-blocking). */
const ARRIVAL_CARD_MS = 4_500;

/** Read the W2a counters; storage failures degrade to "first jump" behavior. */
function readDampening(): JumpDampening {
  try {
    return {
      largeJumpCount: Number(window.localStorage.getItem(JUMP_COUNT_KEY) ?? '0') || 0,
      letterboxShown: window.localStorage.getItem(LETTERBOX_SHOWN_KEY) !== null,
    };
  } catch {
    return { largeJumpCount: 0, letterboxShown: false };
  }
}

function writeDampening(d: JumpDampening): void {
  try {
    window.localStorage.setItem(JUMP_COUNT_KEY, String(d.largeJumpCount));
    if (d.letterboxShown) window.localStorage.setItem(LETTERBOX_SHOWN_KEY, '1');
  } catch {
    /* storage unavailable — dampening simply resets each load */
  }
}

interface JumpHudView {
  readonly model: JumpHudModel;
  readonly durationS: number | null;
  readonly fieldOfViewLy: number | null;
}

const IDLE_VIEW: JumpHudView = { model: JUMP_HUD_IDLE, durationS: null, fieldOfViewLy: null };

/**
 * Unified Jump HUD host (TASK-067 W2/W2a). A ≤10 Hz interval watches the flight
 * controller: when a goTo starts it reads the TASK-066 snapshot
 * (`jumpDistancePcHolder`: distance in pc + target position) and, above the
 * shared scale-jump threshold, runs the pure jump-HUD state machine — live
 * distance remaining from `tree.distanceMeters(state.position, target)`,
 * arrival/cancel from `onGoToEnd(completed)`, dampening counters in
 * localStorage. React re-renders happen at the tick rate of a small HUD-only
 * subtree, never per frame and never inside the Canvas (§5.12). During tours
 * the HUD yields to tour chrome, like the mode badge.
 */
export function JumpHudHost({ tree }: { readonly tree: ScaleFrameTree }): React.JSX.Element {
  const [view, setView] = useState<JumpHudView>(IDLE_VIEW);
  // Mutable machine state shared between the tick loop, the onGoToEnd callback,
  // and the dismiss handler (all low-frequency).
  const machine = useRef<{
    tracking: boolean;
    jump: { target: UniversePosition; startedAt: number } | null;
    model: JumpHudModel;
    unsub: (() => void) | null;
    dismissTimer: number | null;
  }>({ tracking: false, jump: null, model: JUMP_HUD_IDLE, unsub: null, dismissTimer: null });

  const dismiss = useCallback(() => {
    const m = machine.current;
    if (m.dismissTimer !== null) window.clearTimeout(m.dismissTimer);
    m.dismissTimer = null;
    m.model = JUMP_HUD_IDLE;
    setView(IDLE_VIEW);
  }, []);

  useEffect(() => {
    const m = machine.current;

    function handleGoToEnd(completed: boolean): void {
      m.unsub?.();
      m.unsub = null;
      m.tracking = false; // a replaced goTo ends early — re-detect on the next tick
      jumpLetterboxHolder.current = false;
      if (m.model.phase !== 'jumping' || m.jump === null) return;
      if (!completed) {
        // Cancel path: unmount, no arrival card.
        m.jump = null;
        m.model = endJump(m.model, false);
        setView(IDLE_VIEW);
        return;
      }
      const durationS = (performance.now() - m.jump.startedAt) / 1000;
      m.jump = null;
      m.model = endJump(m.model, true);
      writeDampening(dampeningAtArrival(readDampening()));
      // Order-of-magnitude "what you now see" line: the span of the arrival
      // vantage (~2× the camera's distance from the context origin), educational
      // copy computed from queried state, never hard-coded.
      const c = controllerHolder.current;
      let fieldOfViewLy: number | null = null;
      if (c !== null) {
        const [x, y, z] = c.state.position.local;
        fieldOfViewLy =
          (2 * Math.hypot(x, y, z) * CONTEXT_UNIT_METERS[c.contextId]) / METERS_PER_LY;
      }
      setView({ model: m.model, durationS, fieldOfViewLy });
      m.dismissTimer = window.setTimeout(() => {
        m.dismissTimer = null;
        m.model = JUMP_HUD_IDLE;
        setView(IDLE_VIEW);
      }, ARRIVAL_CARD_MS);
    }

    const id = setInterval(() => {
      const c = controllerHolder.current;
      if (c === null) return;

      if (!m.tracking && c.goToActive) {
        m.tracking = true;
        // Track EVERY goTo's end so a replacement mid-flight re-arms detection;
        // sub-threshold flights simply have no model to narrate.
        m.unsub?.();
        m.unsub = c.onGoToEnd(handleGoToEnd);
        const target = jumpDistancePcHolder.target;
        const tourActive = useTourStore.getState().active !== null;
        const damp = readDampening();
        const begun =
          target !== null && !tourActive ? beginJump(jumpDistancePcHolder.current, damp) : null;
        if (begun !== null && target !== null) {
          if (m.dismissTimer !== null) window.clearTimeout(m.dismissTimer);
          m.dismissTimer = null;
          m.model = begun;
          m.jump = { target, startedAt: performance.now() };
          jumpLetterboxHolder.current = begun.letterbox;
          writeDampening(dampeningAtJumpStart(damp, begun));
          setView({ model: begun, durationS: null, fieldOfViewLy: null });
        }
      }

      if (m.model.phase === 'jumping' && m.jump !== null) {
        const remainingM = tree.distanceMeters(c.state.position, m.jump.target);
        m.model = updateRemaining(m.model, remainingM);
        setView({ model: m.model, durationS: null, fieldOfViewLy: null });
      }
    }, TICK_MS);

    return () => {
      clearInterval(id);
      m.unsub?.();
      m.unsub = null;
      if (m.dismissTimer !== null) window.clearTimeout(m.dismissTimer);
      m.dismissTimer = null;
      jumpLetterboxHolder.current = false;
    };
  }, [tree]);

  return (
    <JumpHud
      model={view.model}
      durationS={view.durationS}
      fieldOfViewLy={view.fieldOfViewLy}
      onDismiss={dismiss}
    />
  );
}
