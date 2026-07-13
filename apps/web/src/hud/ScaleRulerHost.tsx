import { useEffect, useState } from 'react';
import { CONTEXT_UNIT_METERS } from '@cosmos/core-types';
import { ScaleRuler, scaleRulerSegment, type ScaleRulerSegment } from '@cosmos/ui';
import { controllerHolder } from '../glue/test-hook';

/** Poll cadence — segment flips are rare (context switch / vantage change). */
const POLL_MS = 150;

/**
 * The pure D3 mapping fed EXACTLY the sanctioned scalar: |cameraLocal| ×
 * CONTEXT_UNIT_METERS[contextId] — the norm of the camera's local coordinate in
 * its current context frame. The e2e ruler test recomputes this same number
 * from `__cosmos.cameraPosition` and must land on the same segment.
 */
function currentSegment(): ScaleRulerSegment | null {
  const c = controllerHolder.current;
  if (c === null) return null;
  const [x, y, z] = c.state.position.local;
  return scaleRulerSegment(c.contextId, Math.hypot(x, y, z) * CONTEXT_UNIT_METERS[c.contextId]);
}

/**
 * Persistent scale ruler host (TASK-067 D3). Low-rate poll of the flight
 * controller; React re-renders only when the highlighted segment actually
 * changes — never per frame (§5.12).
 */
export function ScaleRulerHost(): React.JSX.Element {
  const [active, setActive] = useState<ScaleRulerSegment | null>(null);
  useEffect(() => {
    let last: ScaleRulerSegment | null = null;
    const id = setInterval(() => {
      const next = currentSegment();
      if (next !== last) {
        last = next;
        setActive(next);
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);
  return <ScaleRuler active={active} />;
}
