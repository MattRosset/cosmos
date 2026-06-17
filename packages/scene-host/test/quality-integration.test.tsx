import { create } from '@react-three/test-renderer';
import type { QualitySettings } from '@cosmos/core-types';
import { QUALITY_TIERS } from '@cosmos/core-types';
import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QualityController } from '../src/index';
import { useQuality } from '../src/index';
import { SceneHost } from '../src/SceneHost';

let capturedOnDecline: (() => void) | undefined;
let capturedOnIncline: (() => void) | undefined;

vi.mock('@react-three/drei', () => ({
  PerformanceMonitor: ({
    children,
    onDecline,
    onIncline,
  }: {
    children: ReactNode;
    onDecline: () => void;
    onIncline: () => void;
  }) => {
    capturedOnDecline = onDecline;
    capturedOnIncline = onIncline;
    return children;
  },
}));

vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    Canvas: ({ children }: { children: ReactNode }) => children,
  };
});

describe('SceneHost quality integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    capturedOnDecline = undefined;
    capturedOnIncline = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('useQuality returns QUALITY_TIERS.high by default', async () => {
    let captured: QualitySettings | null = null;

    function Probe(): null {
      captured = useQuality();
      return null;
    }

    const renderer = await create(
      <SceneHost>
        <Probe />
      </SceneHost>,
    );

    expect(captured).toEqual(QUALITY_TIERS.high);
    await renderer.unmount();
  });

  it('useQuality reflects initialQualityTier', async () => {
    let captured: QualitySettings | null = null;

    function Probe(): null {
      captured = useQuality();
      return null;
    }

    const renderer = await create(
      <SceneHost initialQualityTier="low">
        <Probe />
      </SceneHost>,
    );

    expect(captured).toEqual(QUALITY_TIERS.low);
    await renderer.unmount();
  });

  it('onQualityController is called once on mount with the controller', async () => {
    const spy = vi.fn();

    const renderer = await create(
      <SceneHost onQualityController={spy} />,
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const qc = spy.mock.calls[0]![0] as QualityController;
    expect(qc.tier).toBe('high');
    await renderer.unmount();
  });

  it('useQuality updates when setTier is called', async () => {
    let qc: QualityController | null = null;
    let captured: QualitySettings | null = null;

    function Probe(): null {
      captured = useQuality();
      return null;
    }

    const renderer = await create(
      <SceneHost
        disableAutoQuality
        onQualityController={(c) => {
          qc = c;
        }}
      >
        <Probe />
      </SceneHost>,
    );

    expect(captured).toEqual(QUALITY_TIERS.high);

    await act(() => {
      qc!.setTier('low');
    });

    expect(captured).toEqual(QUALITY_TIERS.low);
    await renderer.unmount();
  });

  it('PerformanceMonitor onDecline steps the tier down (debounced)', async () => {
    let qc: QualityController | null = null;

    const renderer = await create(
      <SceneHost
        onQualityController={(c) => {
          qc = c;
        }}
      />,
    );

    expect(capturedOnDecline).toBeDefined();
    expect(qc!.tier).toBe('high');

    capturedOnDecline!();
    vi.runAllTimers();
    expect(qc!.tier).toBe('medium');

    await renderer.unmount();
  });

  it('PerformanceMonitor onIncline steps the tier up (debounced)', async () => {
    let qc: QualityController | null = null;

    const renderer = await create(
      <SceneHost
        initialQualityTier="low"
        onQualityController={(c) => {
          qc = c;
        }}
      />,
    );

    expect(capturedOnIncline).toBeDefined();
    capturedOnIncline!();
    vi.runAllTimers();
    expect(qc!.tier).toBe('medium');

    await renderer.unmount();
  });

  it('disableAutoQuality makes PerformanceMonitor callbacks no-ops', async () => {
    let qc: QualityController | null = null;

    const renderer = await create(
      <SceneHost
        disableAutoQuality
        onQualityController={(c) => {
          qc = c;
        }}
      />,
    );

    capturedOnDecline!();
    vi.runAllTimers();
    expect(qc!.tier).toBe('high'); // unchanged

    await renderer.unmount();
  });

  it('Canvas isolation: tier change does not re-render a sibling HUD component', async () => {
    let qc: QualityController | null = null;
    let hudRenderCount = 0;

    function HudStub(): null {
      hudRenderCount += 1;
      return null;
    }

    // HUD is outside the Canvas (Canvas is mocked to just render children,
    // so we simulate isolation by mounting HUD as a sibling outside SceneHost).
    await create(
      <>
        <SceneHost
          disableAutoQuality
          onQualityController={(c) => {
            qc = c;
          }}
        />
        <HudStub />
      </>,
    );

    const countAfterMount = hudRenderCount;

    await act(() => {
      qc!.setTier('low');
    });

    // HUD must not have re-rendered due to the tier change
    expect(hudRenderCount).toBe(countAfterMount);
  });
});
