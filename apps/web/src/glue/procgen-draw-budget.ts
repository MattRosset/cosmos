import type { QualityTier } from '@cosmos/core-types';

/**
 * Tier-aware procgen draw-cap mapping (TASK-071 / docs/research/integrated-gpu-targeting.md
 * §3). Pulled into `glue/` (rather than living inline in GalaxyScene.tsx) so it is a pure,
 * DOM/THREE-free function the node-env unit tests (`vitest.config.ts` scopes to
 * `src/glue/**`) can exercise directly — per the repo's "query real state / thin glue hook"
 * testing convention (`docs/testing-conventions.md`).
 *
 * `drawFraction` is a PERF-ONLY knob: how much of the procgen Milky Way cloud we can afford
 * to rasterize, independent of `procgenBlend` (the visual opacity fade). Coupling the two
 * re-created the P2 "nebulas without stars" regression during the galaxy-transit work — see
 * docs/research/galaxy-transit-procgen-floor-design.md and the contract comment at
 * `GalaxyScene.tsx`'s `setDrawFraction` call site. No code path may derive both from the
 * same input.
 *
 * The `low`-tier budget stays exactly 90_000 — a shipped bug fix (docs/research/procgen-lod-
 * near-sol.md) protecting the flythrough4 §5.4 near-Sol CI gate; load-bearing, do not change.
 * `medium` (250_000) is a placeholder pending real M1/integrated-GPU calibration and may move
 * once measured (TASK-072+). `high` draws the full cloud (no cap) to restore inter-arm
 * density on capable GPUs at the far vantage.
 */
export const PROCGEN_MAX_DRAW_POINTS_BY_TIER: Record<QualityTier, number> = {
  high: Infinity,
  medium: 250_000,
  low: 90_000,
};

/**
 * Pure mapping: tier + live cloud point count → drawFraction (a contiguous-prefix fraction
 * in (0, 1] consumed by `cloud.setDrawFraction`). Clamps `Infinity / count` to 1 (never NaN)
 * and guards non-positive counts so a tier change re-run against a fresh `m.batch.count` is
 * always safe.
 */
export function computeProcgenDrawFraction(tier: QualityTier, count: number): number {
  const budget = PROCGEN_MAX_DRAW_POINTS_BY_TIER[tier];
  if (!Number.isFinite(budget)) return 1;
  const safeCount = Math.max(1, count);
  return Math.min(1, budget / safeCount);
}
