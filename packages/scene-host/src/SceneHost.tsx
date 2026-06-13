import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type * as THREE from 'three';
import {
  PRIORITY_FRAME_CONTEXT,
  PRIORITY_RENDER,
  sharedFrameContext,
  updateSharedFrameContext,
  type EpochProvider,
  type FrameCallback,
} from './frame-loop.js';

export interface SceneHostProps {
  /** Scene content (render packages, debug markers). Rendered inside the Canvas. */
  children?: ReactNode;
  /** Escape hatch for the app shell; runs at PRIORITY_RENDER. */
  onFrame?: FrameCallback;
  /** Fired when the WebGL context is lost (event already preventDefault()ed so the
   *  browser allows restoration). The app decides UX; scene-host stays UI-free. */
  onContextLost?: () => void;
  /** Epoch source for FrameContext.epochJD. Absent ⇒ J2000 stub (Phase 0/1
   *  behavior, bit-identical). MUST be referentially stable or wrapped by the
   *  caller — changing it does not remount the canvas. */
  readonly epochProvider?: EpochProvider | undefined;
}

function FrameContextUpdater({
  epochProvider,
}: {
  epochProvider?: EpochProvider | undefined;
}): null {
  const { camera } = useThree();
  const epochProviderRef = useRef(epochProvider);
  epochProviderRef.current = epochProvider;

  useFrame((_, deltaSec) => {
    updateSharedFrameContext(
      camera as THREE.PerspectiveCamera,
      deltaSec,
      epochProviderRef.current,
    );
  }, PRIORITY_FRAME_CONTEXT);
  return null;
}

/** Inner frame-loop tree (no Canvas). Used by SceneHost and tests. */
export function FrameLoopRoot({
  children,
  onFrame,
  epochProvider,
}: SceneHostProps): React.JSX.Element {
  return (
    <>
      <FrameContextUpdater epochProvider={epochProvider} />
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

/**
 * Attaches a webglcontextlost listener to a canvas element.
 * Returns a cleanup function. Exported for unit testing.
 */
export function attachContextLossListener(
  canvas: HTMLCanvasElement,
  onContextLost: () => void,
): () => void {
  const handler = (e: Event) => {
    e.preventDefault();
    onContextLost();
  };
  canvas.addEventListener('webglcontextlost', handler);
  return () => canvas.removeEventListener('webglcontextlost', handler);
}

/** Wires the context-loss listener from inside the Canvas using useThree. */
function ContextLossWatcher({ onContextLost }: { onContextLost: () => void }): null {
  const gl = useThree((s) => s.gl);
  useEffect(
    () => attachContextLossListener(gl.domElement, onContextLost),
    [gl.domElement, onContextLost],
  );
  return null;
}

/** Owns the only `<Canvas>`. Renderer config is THIS package's responsibility. */
export function SceneHost({
  children,
  onFrame,
  onContextLost,
  epochProvider,
}: SceneHostProps): React.JSX.Element {
  return (
    <Canvas
      gl={{ logarithmicDepthBuffer: true, antialias: false }}
      camera={{ position: [0, 0, 50], near: 0.1, far: 1e9, fov: 60 }}
    >
      {onContextLost ? <ContextLossWatcher onContextLost={onContextLost} /> : null}
      <FrameLoopRoot
        {...(onFrame !== undefined ? { onFrame } : {})}
        {...(epochProvider !== undefined ? { epochProvider } : {})}
      >
        {children}
      </FrameLoopRoot>
    </Canvas>
  );
}
