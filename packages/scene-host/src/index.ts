export {
  J2000_EPOCH_JD,
  MAX_DT_MS,
  PRIORITY_COORDS,
  PRIORITY_NAV,
  PRIORITY_RENDER,
  PRIORITY_STREAMING,
  type EpochProvider,
  type FrameCallback,
  type FrameContext,
} from './frame-loop.js';
export { SceneHost, FrameLoopRoot, useFrameContext, type SceneHostProps } from './SceneHost.js';
export { computeEffectivePixelRatio, type QualityController } from './quality.js';
export { useQuality } from './use-quality.js';
export { classifyRenderer, detectInitialTier } from './gpu-detect.js';
