import { useEffect, useState } from 'react';
import { STRINGS } from '@cosmos/ui';
import { controllerHolder } from '../glue/test-hook';

/**
 * Beyond this galaxy-frame distance the camera is at the whole-Milky-Way vantage,
 * where WASD "barely moves" (the scale is ~kpc/frame). viewGalaxy parks the camera
 * ~49 kpc out; ordinary star-field exploration near Sol stays well under 1 kpc.
 */
const GALACTIC_VANTAGE_MIN_PC = 5000;

/** True when parked (not mid-jump) at the whole-galaxy vantage. */
function atGalacticVantage(): boolean {
  const c = controllerHolder.current;
  if (!c || c.contextId !== 'galaxy' || c.goToActive) return false;
  const [x, y, z] = c.state.position.local;
  return Math.hypot(x, y, z) >= GALACTIC_VANTAGE_MIN_PC;
}

/**
 * D8 scale-aware hint (TASK-066): at the whole-galaxy vantage, WASD is nearly
 * static, so tell the user to descend via the breadcrumb instead. rAF-driven but
 * re-renders only on the show/hide transition (never per-frame, §5.12).
 */
export function GalacticHint(): React.JSX.Element {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let raf = 0;
    let last = false;
    const loop = (): void => {
      const next = atGalacticVantage();
      if (next !== last) {
        last = next;
        setShow(next);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return show ? (
    <div className="hud-galactic-hint" role="note">
      {STRINGS.galacticDescendHint}
    </div>
  ) : (
    <></>
  );
}
