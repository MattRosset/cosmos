import { create } from '@react-three/test-renderer';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
});
