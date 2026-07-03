import { useEffect, useRef } from 'react';
import { Icon } from '@cosmos/ui';
import { controllerHolder } from '../glue/test-hook';

function fmtSpeed(v: number): string {
  if (v >= 100) return Math.round(v).toLocaleString('en-US');
  if (v >= 1) return v.toFixed(1);
  if (v >= 0.01) return v.toFixed(2);
  return v.toPrecision(2);
}

/**
 * Speed/scale readout (bottom-left). Reads the live controller on a rAF loop and
 * writes to the DOM imperatively — never React state — so per-frame speed changes
 * cost zero renders (§5.12). Hidden while stationary to keep the view clean; the
 * unit tracks the scale context (pc/s in the galaxy, AU/s inside a system).
 */
export function SpeedReadout(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
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
          const txt = `${fmtSpeed(v)} ${c.contextId === 'system' ? 'AU/s' : 'pc/s'}`;
          if (txt !== last) {
            value.textContent = txt;
            last = txt;
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="hud-speed" ref={containerRef} aria-hidden="true">
      <Icon name="gauge" size={14} />
      <span ref={valueRef} className="hud-speed-value" />
    </div>
  );
}
