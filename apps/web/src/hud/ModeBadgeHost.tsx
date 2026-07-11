import { useEffect, useState } from 'react';
import { ModeBadge, STRINGS, SCALE_JUMP_THRESHOLD_PC } from '@cosmos/ui';
import { useTourStore } from '@cosmos/app-state';
import { controllerHolder, jumpDistancePcHolder } from '../glue/test-hook';

/** Below this the camera is effectively stationary (matches SpeedReadout's floor). */
const MOVING_MIN_UNITS_PER_S = 1e-6;

/**
 * Decide the movement-mode label from live flight state:
 *  - tour active → hidden (tour chrome owns the screen)
 *  - goTo beyond the scale-jump threshold → "Scale jump"; shorter goTo → hidden
 *  - moving under manual control → "Exploring"; otherwise hidden
 */
function computeLabel(): string | null {
  const c = controllerHolder.current;
  if (!c) return null;
  if (useTourStore.getState().active !== null) return null;
  if (c.goToActive) {
    return jumpDistancePcHolder.current >= SCALE_JUMP_THRESHOLD_PC ? STRINGS.modeScaleJump : null;
  }
  return c.state.speedUnitsPerS > MOVING_MIN_UNITS_PER_S ? STRINGS.modeExploring : null;
}

/**
 * rAF host for the mode badge. Reads live controller state every frame but only
 * re-renders on a mode *transition* (a handful of times per session), so it never
 * costs a per-frame React render (§5.12).
 */
export function ModeBadgeHost(): React.JSX.Element {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let raf = 0;
    let last: string | null = null;
    const loop = (): void => {
      const next = computeLabel();
      if (next !== last) {
        last = next;
        setLabel(next);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <ModeBadge label={label} />;
}
