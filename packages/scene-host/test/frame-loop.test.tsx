import { create } from '@react-three/test-renderer';
import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { AppError } from '@cosmos/core-types';
import { __resetDiagnostics, setTransports } from '@cosmos/diagnostics';
import {
  J2000_EPOCH_JD,
  MAX_DT_MS,
  PRIORITY_COORDS,
  PRIORITY_NAV,
  PRIORITY_RENDER,
  PRIORITY_STREAMING,
  useFrameContext,
} from '../src/index';
import { sharedFrameContext, updateSharedFrameContext } from '../src/frame-loop';
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

  it('provider receives clamped dt (5s gap → 100ms)', async () => {
    const calls: number[] = [];
    const provider = (dtMs: number) => {
      calls.push(dtMs);
      return 2_460_000;
    };

    function ProbeWithProvider(): null {
      useFrameContext(() => {}, PRIORITY_RENDER);
      return null;
    }

    const renderer = await create(
      <FrameLoopRoot epochProvider={provider}>
        <ProbeWithProvider />
      </FrameLoopRoot>,
    );

    await renderer.advanceFrames(1, 5);

    expect(calls[0]).toBe(MAX_DT_MS);

    await renderer.unmount();
  });

  it('epochJD equals provider return for all subscribers in same frame', async () => {
    const epochs: number[] = [];
    const providerValue = 2_460_000;
    const provider = () => providerValue;

    function EpochAtPriority({
      priority,
    }: {
      priority: number;
    }): null {
      useFrameContext((ctx) => {
        epochs.push(ctx.epochJD);
      }, priority);
      return null;
    }

    const renderer = await create(
      <FrameLoopRoot epochProvider={provider}>
        <EpochAtPriority priority={PRIORITY_NAV} />
        <EpochAtPriority priority={PRIORITY_RENDER} />
      </FrameLoopRoot>,
    );

    await renderer.advanceFrames(1, 1 / 60);

    expect(epochs).toEqual([providerValue, providerValue]);

    await renderer.unmount();
  });

  it('provider called exactly once per frame', async () => {
    let callCount = 0;
    const provider = () => {
      callCount += 1;
      return 2_460_000;
    };

    function Probe(): null {
      useFrameContext(() => {}, PRIORITY_RENDER);
      return null;
    }

    const renderer = await create(
      <FrameLoopRoot epochProvider={provider}>
        <Probe />
      </FrameLoopRoot>,
    );

    await renderer.advanceFrames(3, 1 / 60);

    expect(callCount).toBe(3);

    await renderer.unmount();
  });

  it('non-finite return retains previous epoch and reports once (TASK-058)', () => {
    // The one-shot console.warn became a single reportError(kind:'invariant') so the
    // broken provider is counted + overlay-visible, not a console line that scrolls away.
    __resetDiagnostics();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reports: AppError[] = [];
    setTransports([(e) => reports.push(e)]);
    const cam = null as unknown as THREE.PerspectiveCamera;

    // Establish a known epoch
    updateSharedFrameContext(cam, 0.016, () => 2_460_001);
    expect(sharedFrameContext.epochJD).toBe(2_460_001);

    // NaN return → previous epoch retained, reported exactly once
    updateSharedFrameContext(cam, 0.016, () => NaN);
    expect(sharedFrameContext.epochJD).toBe(2_460_001);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.kind).toBe('invariant');

    // Finite again → updates normally
    updateSharedFrameContext(cam, 0.016, () => 2_460_003);
    expect(sharedFrameContext.epochJD).toBe(2_460_003);

    // Second NaN → still only one report (latched once per session, hot-path safe)
    updateSharedFrameContext(cam, 0.016, () => NaN);
    expect(sharedFrameContext.epochJD).toBe(2_460_003);
    expect(reports).toHaveLength(1);

    setTransports([]);
    vi.restoreAllMocks();
  });

});
