import { useEffect, useRef } from 'react';
import { Icon, formatSpeedKmS } from '@cosmos/ui';
import { controllerHolder } from '../glue/test-hook';

/** Screen readers should hear speed changes, but not per-frame — throttle announcements. */
const ARIA_THROTTLE_MS = 3000;

/**
 * Speed/scale readout (bottom-left). Reads the live controller on a rAF loop and
 * writes to the DOM imperatively — never React state — so per-frame speed changes
 * cost zero renders (§5.12). Hidden while stationary to keep the view clean; the
 * visible label pairs the context unit with its km/s equivalent (`formatSpeedKmS`),
 * and a throttled aria-live mirror voices it for assistive tech (S5).
 */
export function SpeedReadout(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const ariaRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    let lastAria = 0;
    const loop = (): void => {
      const c = controllerHolder.current;
      const container = containerRef.current;
      const value = valueRef.current;
      if (c && container && value) {
        const v = c.state.speedUnitsPerS;
        if (v < 1e-6) {
          container.style.visibility = 'hidden';
        } else {
          container.style.visibility = 'visible';
          const txt = formatSpeedKmS(v, c.contextId);
          if (txt !== last) {
            value.textContent = txt;
            last = txt;
            const now = performance.now();
            if (ariaRef.current && now - lastAria >= ARIA_THROTTLE_MS) {
              ariaRef.current.textContent = txt;
              lastAria = now;
            }
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="hud-speed" ref={containerRef}>
      <Icon name="gauge" size={14} />
      <span ref={valueRef} className="hud-speed-value" />
      <span ref={ariaRef} className="sr-only" aria-live="polite" />
    </div>
  );
}
