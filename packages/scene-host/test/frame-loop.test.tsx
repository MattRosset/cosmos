import { create } from '@react-three/test-renderer';
import { describe, expect, it } from 'vitest';
import {
  J2000_EPOCH_JD,
  MAX_DT_MS,
  PRIORITY_COORDS,
  PRIORITY_NAV,
  PRIORITY_RENDER,
  PRIORITY_STREAMING,
  useFrameContext,
} from '../src/index';
import { FrameLoopRoot } from '../src/SceneHost';

function PriorityProbe({
  priority,
  order,
  label,
}: {
  priority: number;
  order: string[];
  label: string;
}): null {
  useFrameContext(() => {
    order.push(label);
  }, priority);
  return null;
}

describe('frame loop', () => {
  it('runs subscribers in ascending priority order within one frame', async () => {
    const order: string[] = [];

    const renderer = await create(
      <FrameLoopRoot>
        <PriorityProbe priority={PRIORITY_RENDER} order={order} label="render" />
        <PriorityProbe priority={PRIORITY_NAV} order={order} label="nav" />
        <PriorityProbe priority={PRIORITY_STREAMING} order={order} label="streaming" />
        <PriorityProbe priority={PRIORITY_COORDS} order={order} label="coords" />
      </FrameLoopRoot>,
    );

    await renderer.advanceFrames(1, 1 / 60);

    expect(order).toEqual(['nav', 'coords', 'streaming', 'render']);

    await renderer.unmount();
  });

  it('clamps dtMs to 100 for a simulated 5 s gap', async () => {
    let dtMs = -1;

    function DtCapture(): null {
      useFrameContext((ctx) => {
        dtMs = ctx.dtMs;
      }, PRIORITY_RENDER);
      return null;
    }

    const renderer = await create(
      <FrameLoopRoot>
        <DtCapture />
      </FrameLoopRoot>,
    );

    await renderer.advanceFrames(1, 5);

    expect(dtMs).toBe(MAX_DT_MS);

    await renderer.unmount();
  });

  it('exposes epochJD === J2000 (2451545.0)', async () => {
    let epochJD = 0;

    function EpochCapture(): null {
      useFrameContext((ctx) => {
        epochJD = ctx.epochJD;
      }, PRIORITY_RENDER);
      return null;
    }

    const renderer = await create(
      <FrameLoopRoot>
        <EpochCapture />
      </FrameLoopRoot>,
    );

    await renderer.advanceFrames(1, 1 / 60);

    expect(epochJD).toBe(J2000_EPOCH_JD);

    await renderer.unmount();
  });

  it('invokes onFrame via FrameLoopRoot at PRIORITY_RENDER', async () => {
    let onFrameCalled = false;

    const renderer = await create(
      <FrameLoopRoot
        onFrame={() => {
          onFrameCalled = true;
        }}
      />,
    );

    await renderer.advanceFrames(1, 1 / 60);

    expect(onFrameCalled).toBe(true);

    await renderer.unmount();
  });

  it('unsubscribes on unmount (no callback after unmount, stable over 100 cycles)', async () => {
    let callCount = 0;

    function CountingProbe(): null {
      useFrameContext(() => {
        callCount += 1;
      }, PRIORITY_RENDER);
      return null;
    }

    for (let i = 0; i < 100; i += 1) {
      const renderer = await create(
        <FrameLoopRoot>
          <CountingProbe />
        </FrameLoopRoot>,
      );

      await renderer.advanceFrames(1, 1 / 60);
      const countAfterFrame = callCount;

      await renderer.unmount();
      await renderer.advanceFrames(1, 1 / 60);

      expect(callCount).toBe(countAfterFrame);
    }
  });
});
