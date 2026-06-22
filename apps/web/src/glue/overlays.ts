/**
 * Educational-overlay glue (TASK-052, §5.12). Builds the constellation render data
 * and the screen-space label set from `data` v4, keeping every world→screen
 * projection on the app side (the `ui` package never sees the camera). The label
 * projection runs on a ≤ 10 Hz interval in Overlays.tsx — never per frame (§5.12).
 */
import type { LabelRecord } from '@cosmos/core-types';
import {
  createConstellationSource,
  labelCandidates,
  type ConstellationPack,
  type ConstellationSource,
  type ConstellationStarSource,
  type LabelableSource,
} from '@cosmos/data';
import type { ProjectedLabel } from '@cosmos/ui';

/** Constellation lines tint (linear RGB) — a cool, dim blue so they read as a guide. */
export const CONSTELLATION_COLOR: readonly [number, number, number] = [0.4, 0.55, 0.8];
export const CONSTELLATION_OPACITY = 0.45;

/** Label projection cadence — the existing ≤ 10 Hz overlay throttle (§5.12). */
export const LABEL_PROJECT_INTERVAL_MS = 100;
/** Max label candidates resolved from the catalog (declutter happens in the UI too). */
export const LABEL_MAX = 40;

export interface OverlayData {
  readonly constellation: ConstellationSource;
  /**
   * Constellation endpoints as a camera-relative `Float32Array` (6×N) measured from
   * the galaxy origin `[0,0,0]`; the per-frame `setRenderOffset` adds
   * `origin.toRenderSpace(galaxyOrigin)` (ADR-001 §5). Constellation stars are nearby
   * HYG entries (≤ a few hundred pc), so the f32 cast is lossless at render scale.
   */
  readonly segmentsF32: Float32Array;
  readonly labels: readonly LabelRecord[];
}

/** Resolve the constellation source + label candidates against the HYG star source. */
export function buildOverlayData(
  pack: ConstellationPack,
  stars: ConstellationStarSource & LabelableSource,
): OverlayData {
  const constellation = createConstellationSource(pack, stars);
  const segmentsPc = constellation.segmentsPc();
  const segmentsF32 = new Float32Array(segmentsPc.length);
  for (let i = 0; i < segmentsPc.length; i++) segmentsF32[i] = segmentsPc[i]!;
  const labels = labelCandidates(stars, { max: LABEL_MAX });
  return { constellation, segmentsF32, labels };
}

/**
 * Map a resolved label to a `ProjectedLabel` for `<LabelLayer>`. The app supplies the
 * already-computed screen pixel coords + on-screen flag (the §5.12 contract: `ui`
 * receives pixels, never the camera).
 */
export function toProjectedLabel(
  label: LabelRecord,
  xPx: number,
  yPx: number,
  visible: boolean,
): ProjectedLabel {
  return { id: label.id, text: label.text, xPx, yPx, priority: label.priority, visible };
}

/**
 * Tiny pub/sub for projected labels. Overlays.tsx (inside the Canvas) publishes the
 * ≤ 10 Hz projection; the HUD's label host (OUTSIDE the Canvas) subscribes and
 * re-renders only itself — so label updates never re-render the Canvas subtree (§5.12).
 */
type LabelListener = (labels: readonly ProjectedLabel[]) => void;
let _labels: readonly ProjectedLabel[] = [];
const _labelListeners = new Set<LabelListener>();

export function publishLabels(labels: readonly ProjectedLabel[]): void {
  _labels = labels;
  for (const cb of _labelListeners) cb(labels);
}

export function subscribeLabels(cb: LabelListener): () => void {
  _labelListeners.add(cb);
  cb(_labels);
  return () => {
    _labelListeners.delete(cb);
  };
}
