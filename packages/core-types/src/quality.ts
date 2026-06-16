/** §9 adaptive tiers — names are ordered best→worst. */
export type QualityTier = 'high' | 'medium' | 'low';

/** §9 degradation order: point count → bloom → atmosphere → resolution scale.
 *  One settings record per tier (consumed by scene-host, TASK-039). */
export interface QualitySettings {
  readonly tier: QualityTier;
  /** Hard cap on rendered points across all batches (§9 ≤ 2e6 at 'high'). */
  readonly maxRenderedPoints: number;
  readonly bloomEnabled: boolean;
  readonly atmosphereEnabled: boolean;
  /** Renderer pixel-ratio multiplier in (0,1], 1 = native. */
  readonly resolutionScale: number;
}

/** §9 fixed tier table (single source of truth; TASK-039 consumes it). */
export const QUALITY_TIERS: Record<QualityTier, QualitySettings> = {
  high: {
    tier: 'high',
    maxRenderedPoints: 2_000_000,
    bloomEnabled: true,
    atmosphereEnabled: true,
    resolutionScale: 1,
  },
  medium: {
    tier: 'medium',
    maxRenderedPoints: 1_000_000,
    bloomEnabled: true,
    atmosphereEnabled: false,
    resolutionScale: 0.75,
  },
  low: {
    tier: 'low',
    maxRenderedPoints: 500_000,
    bloomEnabled: false,
    atmosphereEnabled: false,
    resolutionScale: 0.5,
  },
};
