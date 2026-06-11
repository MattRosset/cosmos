import { useMemo } from 'react';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import { PRIORITY_NAV, useFrameContext } from '@cosmos/scene-host';
import { useFlightController } from '@cosmos/nav';
import { STARFIELD_RADIUS } from './Starfield';

const INITIAL_POSITION: [number, number, number] = [0, 0, 150];

/**
 * Wires scale-aware free flight into the Phase 0 starfield placeholder.
 * Distance-to-surface is fed one priority step before nav integration.
 */
export function NavDriver() {
  const origin = useMemo(() => {
    const tree = createScaleFrameTree();
    return createOriginManager(tree, {
      context: 'planet',
      local: INITIAL_POSITION,
    });
  }, []);

  const flight = useFlightController({
    origin,
    initial: {
      position: { context: 'planet', local: INITIAL_POSITION },
      orientation: [0, 0, 0, 1],
    },
  });

  useFrameContext(() => {
    const [x, y, z] = flight.state.position.local;
    const distFromCenter = Math.hypot(x, y, z);
    flight.setDistanceToNearestSurface(
      Math.max(STARFIELD_RADIUS - distFromCenter, 1e-7),
    );
  }, PRIORITY_NAV - 1);

  return null;
}
