import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { QualitySettings } from '@cosmos/core-types';
import type { QualityTier } from '@cosmos/core-types';
import type * as THREE from 'three';
import {
  PRIORITY_FRAME_CONTEXT,
  PRIORITY_RENDER,
  sharedFrameContext,
  updateSharedFrameContext,
  type EpochProvider,
  type FrameCallback,
} from './frame-loop.js';
import { QualityControllerImpl, type QualityController } from './quality.js';
import { QualityContext } from './use-quality.js';

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
  /** Start tier (default 'high'). PerformanceMonitor adapts from here. */
  readonly initialQualityTier?: QualityTier;
  /** Called once on mount with the QualityController (app wires streaming + post). */
  readonly onQualityController?: (qc: QualityController) => void;
  /** Disable automatic adaptation (tests / forced-tier demos). Default false. */
  readonly disableAutoQuality?: boolean;
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

/** Applies resolution scale via gl.setPixelRatio on tier change (never per-frame). */
function QualityApplier({ qc }: { qc: QualityControllerImpl }): null {
  const { gl } = useThree();

  useEffect(() => {
    const apply = (settings: QualitySettings) => {
      gl.setPixelRatio(Math.min(window.devicePixelRatio, 2) * settings.resolutionScale);
    };
    apply(qc.settings);
    return qc.onChange(apply);
  }, [qc, gl]);

  return null;
}

/** Manages quality tier state and PerformanceMonitor wiring inside the Canvas. */
function QualityRoot({
  qc,
  disableAutoQuality,
  children,
  onFrame,
  epochProvider,
}: {
  qc: QualityControllerImpl;
  disableAutoQuality: boolean;
  children?: ReactNode;
  onFrame?: FrameCallback;
  epochProvider?: EpochProvider;
}): React.JSX.Element {
  const disableRef = useRef(disableAutoQuality);
  disableRef.current = disableAutoQuality;

  const handleDecline = useCallback(() => {
    if (!disableRef.current) qc.stepDown();
  }, [qc]);

  const handleIncline = useCallback(() => {
    if (!disableRef.current) qc.stepUp();
  }, [qc]);

  const frameLoopRoot = (
    <FrameLoopRoot
      {...(onFrame !== undefined ? { onFrame } : {})}
      {...(epochProvider !== undefined ? { epochProvider } : {})}
    >
      {children}
    </FrameLoopRoot>
  );

  return (
    <QualityContext.Provider value={qc}>
      <QualityApplier qc={qc} />
      <PerformanceMonitor onDecline={handleDecline} onIncline={handleIncline}>
        {frameLoopRoot}
      </PerformanceMonitor>
    </QualityContext.Provider>
  );
}

/** Owns the only `<Canvas>`. Renderer config is THIS package's responsibility. */
export function SceneHost({
  children,
  onFrame,
  onContextLost,
  epochProvider,
  initialQualityTier = 'high',
  onQualityController,
  disableAutoQuality = false,
}: SceneHostProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Stable controller for the lifetime of this SceneHost instance.
  const qcRef = useRef<QualityControllerImpl | null>(null);
  if (qcRef.current === null) {
    qcRef.current = new QualityControllerImpl(initialQualityTier);
  }
  const qc = qcRef.current;

  const onQcRef = useRef(onQualityController);
  onQcRef.current = onQualityController;

  useEffect(() => {
    onQcRef.current?.(qc);
  }, []);

  useEffect(() => {
    if (!onContextLost || !canvasRef.current) return;
    return attachContextLossListener(canvasRef.current, onContextLost);
  }, [onContextLost]);

  return (
    <Canvas
      ref={canvasRef}
      gl={{ logarithmicDepthBuffer: true, antialias: false }}
      camera={{ position: [0, 0, 50], near: 0.1, far: 1e9, fov: 60 }}
    >
      <QualityRoot
        qc={qc}
        disableAutoQuality={disableAutoQuality}
        {...(onFrame !== undefined ? { onFrame } : {})}
        {...(epochProvider !== undefined ? { epochProvider } : {})}
      >
        {children}
      </QualityRoot>
    </Canvas>
  );
}
