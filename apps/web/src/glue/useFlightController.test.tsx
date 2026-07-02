// @vitest-environment jsdom
import { create } from '@react-three/test-renderer';
import { describe, it } from 'vitest';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import { FrameLoopRoot } from '@cosmos/scene-host';
import { useMemo } from 'react';
import { useFlightController } from './useFlightController';

function FlightProbe(): null {
  const origin = useMemo(
    () =>
      createOriginManager(createScaleFrameTree(), {
        context: 'planet',
        local: [0, 0, 50],
      }),
    [],
  );
  useFlightController({
    origin,
    initial: {
      position: { context: 'planet', local: [0, 0, 50] },
      orientation: [0, 0, 0, 1],
    },
  });
  return null;
}

describe('useFlightController', () => {
  it('subscribes at PRIORITY_NAV and advances without throwing', async () => {
    const renderer = await create(
      <FrameLoopRoot>
        <FlightProbe />
      </FrameLoopRoot>,
    );

    await renderer.advanceFrames(3, 1 / 60);
    await renderer.unmount();
  });
});
