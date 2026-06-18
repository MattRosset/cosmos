import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import type { OriginManager } from '@cosmos/coords';
import { PRIORITY_NAV, useFrameContext } from '@cosmos/scene-host';
import {
  createFlightController,
  type FlightController,
  type FlightControllerOptions,
} from './controller.js';

const renderPosScratch: [number, number, number] = [0, 0, 0];

/**
 * React glue: creates the controller, subscribes at PRIORITY_NAV, and copies
 * state into the R3F camera each frame (the ONLY place that touches camera).
 */
export function useFlightController(
  opts: Omit<FlightControllerOptions, 'origin'> & { origin: OriginManager },
): FlightController {
  const controller = useMemo(() => createFlightController(opts), [opts.origin]);

  const { camera, gl } = useThree();

  useEffect(() => {
    const el = gl.domElement;
    const dispose = controller.attach(el);
    return dispose;
  }, [controller, gl.domElement]);

  useFrameContext((ctx) => {
    const profile = (globalThis as typeof globalThis & { __cosmosProfileSpan?: (n: string, fn: () => void) => void })
      .__cosmosProfileSpan;
    const run = profile ?? ((_n: string, fn: () => void) => fn());
    run('nav.update', () => controller.update(ctx.dtMs));
    const { orientation } = controller.state;
    run('nav.cameraSync', () => {
      opts.origin.toRenderSpace(controller.state.position, renderPosScratch);
      camera.position.set(renderPosScratch[0], renderPosScratch[1], renderPosScratch[2]);
      camera.quaternion.set(orientation[0], orientation[1], orientation[2], orientation[3]);
    });
  }, PRIORITY_NAV);

  return controller;
}
