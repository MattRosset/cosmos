import { create } from '@react-three/test-renderer';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { attachContextLossListener, SceneHost } from '../src/SceneHost';

vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    Canvas: ({ children }: { children: ReactNode }) => children,
  };
});

describe('attachContextLossListener', () => {
  it('calls onContextLost and prevents default when event fires', () => {
    const canvas = document.createElement('canvas');
    const onContextLost = vi.fn();

    attachContextLossListener(canvas, onContextLost);

    const event = new Event('webglcontextlost', { cancelable: true });
    canvas.dispatchEvent(event);

    expect(onContextLost).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('removes the listener when the cleanup function is called', () => {
    const canvas = document.createElement('canvas');
    const onContextLost = vi.fn();

    const cleanup = attachContextLossListener(canvas, onContextLost);
    cleanup();

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    expect(onContextLost).not.toHaveBeenCalled();
  });
});

describe('SceneHost onContextLost prop', () => {
  it('does not crash when onContextLost is not provided', async () => {
    const renderer = await create(
      <SceneHost>
        <mesh />
      </SceneHost>,
    );
    await renderer.unmount();
  });

  it('does not crash when onContextLost is provided', async () => {
    const renderer = await create(
      <SceneHost onContextLost={() => {}}>
        <mesh />
      </SceneHost>,
    );
    await renderer.unmount();
  });
});
