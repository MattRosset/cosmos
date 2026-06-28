/**
 * Educational-overlay glue (TASK-052, §5.12). Builds the constellation render data
 * and the screen-space label set from `data` v4, keeping every world→screen
 * projection on the app side (the `ui` package never sees the camera). The label
 * projection runs on a ≤ 10 Hz interval in Overlays.tsx — never per frame (§5.12).
 */
import type { BodyId, LabelRecord } from '@cosmos/core-types';
import {
  createConstellationSource,
  labelCandidates,
  type ConstellationPack,
  type ConstellationSource,
  type ConstellationStarSource,
  type LabelableSource,
} from '@cosmos/data';

/** Constellation lines tint (linear RGB) — a cool, dim blue so they read as a guide. */
export const CONSTELLATION_COLOR: readonly [number, number, number] = [0.4, 0.55, 0.8];
export const CONSTELLATION_OPACITY = 0.45;

/** Max label candidates resolved from the catalog (declutter happens in the host too). */
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
 * A label whose membership (id/text/priority/anchor) is fixed for the lifetime of the
 * current overlay set, but whose screen-space position + on-screen flag are MUTATED in
 * place every frame by the in-Canvas projector (zero allocation, §9). The HUD's imperative
 * label host reads these same objects on its own rAF loop and writes them to the DOM — so
 * labels track the camera at full frame rate without ever re-rendering the Canvas OR the
 * HUD subtree (§5.12). This is the BUG-5 fix: the old path projected on a 10 Hz interval
 * and pushed pixels through React state, so labels froze in pixel space between updates and
 * visibly swam whenever the camera moved.
 */
export interface LiveLabel {
  readonly id: BodyId;
  readonly text: string;
  readonly priority: number;
  /** Absolute anchor, galaxy-context parsecs (the projector reads it every frame). */
  readonly positionPc: readonly [number, number, number];
  /** Screen pixel position — mutated in place by the per-frame projector. */
  xPx: number;
  yPx: number;
  /** false ⇒ behind the camera / off-screen; the host hides it. Mutated per frame. */
  visible: boolean;
}

/**
 * Shared live-label buffer (membership). The projector mutates each element's
 * `xPx`/`yPx`/`visible` in place per frame; the host reads the same array. Pre-sorted by
 * priority so the host can cap to its max by walking in order.
 */
let _liveLabels: readonly LiveLabel[] = [];
type LabelSetListener = (labels: readonly LiveLabel[]) => void;
const _labelSetListeners = new Set<LabelSetListener>();

/** The shared buffer the per-frame projector mutates and the host's rAF loop reads. */
export function liveLabels(): readonly LiveLabel[] {
  return _liveLabels;
}

/**
 * Replace the label SET — a rare event (overlay data load or the Labels toggle), NOT a
 * per-frame call. Rebuilds the buffer (sorted by priority, positions reset off-screen until
 * the next projection frame) and notifies the host so it re-mounts its DOM nodes once.
 */
export function publishLabelSet(labels: readonly LabelRecord[]): void {
  _liveLabels = labels
    .map(
      (l): LiveLabel => ({
        id: l.id,
        text: l.text,
        priority: l.priority,
        positionPc: l.positionPc,
        xPx: 0,
        yPx: 0,
        visible: false,
      }),
    )
    .sort((a, b) => a.priority - b.priority);
  for (const cb of _labelSetListeners) cb(_liveLabels);
}

/** Host subscription: fires on every label-SET change (membership), never per frame. */
export function subscribeLabelSet(cb: LabelSetListener): () => void {
  _labelSetListeners.add(cb);
  cb(_liveLabels);
  return () => {
    _labelSetListeners.delete(cb);
  };
}
