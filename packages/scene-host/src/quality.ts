import { QUALITY_TIERS, type QualitySettings, type QualityTier } from '@cosmos/core-types';

const TIERS: readonly QualityTier[] = ['high', 'medium', 'low'];
const DEBOUNCE_MS = 50;

/** Per-tier cap on device pixel ratio (TASK-072): the single largest fill multiplier
 *  on Retina/HiDPI integrated GPUs is dpr² fragments — cap it below `high` on tiers
 *  that already exist to shed fill cost. */
const TIER_DPR_CAP: Record<QualityTier, number> = { high: 2, medium: 1.5, low: 1 };

/** Effective renderer pixel ratio for a given tier: `min(dpr, tierCap) *
 *  resolutionScale`. Applied only on tier change (never per-frame) — see SceneHost's
 *  QualityApplier. */
export function computeEffectivePixelRatio(
  tier: QualityTier,
  dpr: number,
  resolutionScale: number,
): number {
  return Math.min(dpr, TIER_DPR_CAP[tier]) * resolutionScale;
}

export interface QualityController {
  readonly tier: QualityTier;
  readonly settings: QualitySettings;
  /** Manual override (settings UI / tests). null ⇒ resume automatic control. */
  setTier(tier: QualityTier | null): void;
  /** Fires on every tier change (debounced — never per-frame). Returns unsubscribe. */
  onChange(cb: (settings: QualitySettings) => void): () => void;
}

export class QualityControllerImpl implements QualityController {
  private _tier: QualityTier;
  private _override: QualityTier | null = null;
  private _subscribers = new Set<(settings: QualitySettings) => void>();
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingTier: QualityTier | null = null;

  constructor(initialTier: QualityTier = 'high') {
    this._tier = initialTier;
  }

  get tier(): QualityTier {
    return this._tier;
  }

  get settings(): QualitySettings {
    return QUALITY_TIERS[this._tier];
  }

  setTier(tier: QualityTier | null): void {
    this._override = tier;
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
      this._pendingTier = null;
    }
    if (tier !== null) {
      this._applyTier(tier);
    }
  }

  stepDown(): void {
    if (this._override !== null) return;
    const idx = TIERS.indexOf(this._tier);
    if (idx < TIERS.length - 1) {
      this._scheduleChange(TIERS[idx + 1]!);
    }
  }

  stepUp(): void {
    if (this._override !== null) return;
    const idx = TIERS.indexOf(this._tier);
    if (idx > 0) {
      this._scheduleChange(TIERS[idx - 1]!);
    }
  }

  onChange(cb: (settings: QualitySettings) => void): () => void {
    this._subscribers.add(cb);
    return () => {
      this._subscribers.delete(cb);
    };
  }

  private _scheduleChange(tier: QualityTier): void {
    this._pendingTier = tier;
    if (this._debounceTimer !== null) return;
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      const t = this._pendingTier!;
      this._pendingTier = null;
      this._applyTier(t);
    }, DEBOUNCE_MS);
  }

  private _applyTier(tier: QualityTier): void {
    if (tier === this._tier) return;
    this._tier = tier;
    const settings = QUALITY_TIERS[tier];
    for (const cb of this._subscribers) {
      try {
        cb(settings);
      } catch {
        // isolate throwing handlers
      }
    }
  }
}
