import { useEffect } from 'react';
import type { UniversePosition } from '@cosmos/core-types';
import type { OriginManager } from '@cosmos/coords';
import type { StarDataSource } from '@cosmos/data';
import { PRIORITY_NAV, useFrameContext } from '@cosmos/scene-host';
import { useFlightController, type FlightController } from '@cosmos/nav';

/** Initial camera: ≈ 2 AU above Sol in the galaxy frame (TASK-015 wiring). */
export const INITIAL_CAMERA: UniversePosition = {
  context: 'galaxy',
  local: [0, 0, 1e-5],
};

/** Distance floor (pc): avoids the Sol-at-zero-distance trap (TASK-015). */
const MIN_SURFACE_DISTANCE_PC = 1e-7;

interface NavDriverProps {
  readonly origin: OriginManager;
  readonly source: StarDataSource;
  /** Called once with the live controller so the HUD can issue goTo at event time. */
  onController(controller: FlightController): void;
}

/**
 * Wires scale-aware free flight into the real star catalog: the speed law is
 * fed the camera-to-nearest-star distance one priority step before nav
 * integrates (1-frame-stale camera is fine for a speed law).
 */
export function NavDriver({ origin, source, onController }: NavDriverProps) {
  const flight = useFlightController({
    origin,
    initial: { position: INITIAL_CAMERA, orientation: [0, 0, 0, 1] },
  });

  useEffect(() => {
    onController(flight);
  }, [flight, onController]);

  useFrameContext(() => {
    const [cx, cy, cz] = flight.state.position.local;
    const i = source.nearestStarIndex(cx, cy, cz);
    if (i < 0) return;
    const { positionsPc, originPc } = source.batch;
    const dx = originPc[0] + positionsPc[i * 3]! - cx;
    const dy = originPc[1] + positionsPc[i * 3 + 1]! - cy;
    const dz = originPc[2] + positionsPc[i * 3 + 2]! - cz;
    flight.setDistanceToNearestSurface(
      Math.max(Math.hypot(dx, dy, dz), MIN_SURFACE_DISTANCE_PC),
    );
  }, PRIORITY_NAV - 1);

  return null;
}
