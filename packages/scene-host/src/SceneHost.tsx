import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import type * as THREE from 'three';
import {
  PRIORITY_FRAME_CONTEXT,
  PRIORITY_RENDER,
  sharedFrameContext,
  updateSharedFrameContext,
  type FrameCallback,
} from './frame-loop.js';

export interface SceneHostProps {
  /** Scene content (render packages, debug markers). Rendered inside the Canvas. */
  children?: ReactNode;
  /** Escape hatch for the app shell; runs at PRIORITY_RENDER. */
  onFrame?: FrameCallback;
}

function FrameContextUpdater(): null {
  const { camera } = useThree();
  useFrame((_, deltaSec) => {
    updateSharedFrameContext(camera as THREE.PerspectiveCamera, deltaSec);
  }, PRIORITY_FRAME_CONTEXT);
  return null;
}

/** Inner frame-loop tree (no Canvas). Used by SceneHost and tests. */
export function FrameLoopRoot({
  children,
  onFrame,
}: SceneHostProps): React.JSX.Element {
  return (
    <>
      <FrameContextUpdater />
      {onFrame ? <OnFrameBridge onFrame={onFrame} /> : null}
      {/* Extension point: coords rebase root-group shifts (TASK-005+), streaming
          visible-set hooks, quality-tier post chain — mount as frame subscribers. */}
      {children}
    </>
  );
}

function OnFrameBridge({ onFrame }: { onFrame: FrameCallback }): null {
  useFrameContext(onFrame, PRIORITY_RENDER);
  return null;
}

/** Subscribe to the frame loop from inside the Canvas tree. */
export function useFrameContext(cb: FrameCallback, priority: number = PRIORITY_RENDER): void {
  const cbRef = useRef(cb);
  cbRef.current = cb;

  useFrame(() => {
    cbRef.current(sharedFrameContext);
  }, priority);
}

/** Owns the only `<Canvas>`. Renderer config is THIS package's responsibility. */
export function SceneHost({ children, onFrame }: SceneHostProps): React.JSX.Element {
  return (
    <Canvas
      gl={{ logarithmicDepthBuffer: true, antialias: false }}
      camera={{ position: [0, 0, 50], near: 0.1, far: 1e9, fov: 60 }}
    >
      <FrameLoopRoot {...(onFrame !== undefined ? { onFrame } : {})}>{children}</FrameLoopRoot>
    </Canvas>
  );
}
