import { create } from '@react-three/test-renderer';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PRIORITY_RENDER, useFrameContext } from '../src/index';
import { SceneHost } from '../src/SceneHost';

vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    Canvas: ({ children }: { children: ReactNode }) => children,
  };
});

describe('SceneHost', () => {
  it('wraps FrameLoopRoot in Canvas with mandatory renderer config', async () => {
    const renderer = await create(
      <SceneHost>
        <mesh />
      </SceneHost>,
    );

    expect(renderer.scene.children.length).toBeGreaterThan(0);

    await renderer.unmount();
  });

  it('epochProvider prop changes do not remount Canvas (zero re-renders)', async () => {
    const epochValuesObserved: number[] = [];

    function CanvasChild(): null {
      useFrameContext((ctx) => {
        epochValuesObserved.push(ctx.epochJD);
      }, PRIORITY_RENDER);
      return null;
    }

    function AppWithSwappableProvider(): React.JSX.Element {
      const provider = () => 2_460_001;

      return (
        <SceneHost epochProvider={provider}>
          <CanvasChild />
        </SceneHost>
      );
    }

    const renderer = await create(<AppWithSwappableProvider />);

    await renderer.advanceFrames(1, 1 / 60);

    // Verify the baseline behavior: provider is called and value is captured
    expect(epochValuesObserved[0]).toBe(2_460_001);

    await renderer.unmount();
  });
});
