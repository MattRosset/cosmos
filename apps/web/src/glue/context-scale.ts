import { CONTEXT_UNIT_METERS, type ContextId } from '@cosmos/core-types';

/**
 * Unit bridge between the point renderers and the active scale context (TASK-081).
 *
 * The point renderers (`render-stars`, `render-galaxy`) bind `batch.positionsPc` directly
 * as the `position` attribute — always PARSECS — and their `setRenderOffset` contract is
 * parsecs too. But `OriginManager.toRenderSpace` returns ACTIVE-CONTEXT units. In galaxy
 * context those coincide, which is why the mismatch went unnoticed; outside it they differ
 * by up to 206,265x (system) or 1e6 (universe), and the star field is drawn in the wrong
 * place and unlit. Measured: `docs/research/star-sprite-goes-dark-on-system-entry.md`.
 *
 * Callers convert the offset to parsecs with `unitsToPc` and hand `pcToUnits` to the
 * renderer, which applies it once at the projection.
 */
export interface PcScales {
  /** Active-context units → parsecs. Multiply `toRenderSpace`'s output by this. */
  readonly unitsToPc: number;
  /** Parsecs → active-context units. Pass to `setContextScale`. */
  readonly pcToUnits: number;
}

/**
 * The galaxy branch returns literal `1`s and is REQUIRED, not an optimization: the whole
 * "galaxy context is bit-identical" property rests on the shader multiplying by exactly
 * 1.0 (exact in IEEE-754). Computing the ratio would be 1.0 today, but any refactor
 * through a ratio-of-ratios can land on 0.9999999999999999 and silently move every
 * galaxy-context baseline.
 */
export function pcScales(ctx: ContextId): PcScales {
  if (ctx === 'galaxy') return { unitsToPc: 1, pcToUnits: 1 };
  const unitsToPc = CONTEXT_UNIT_METERS[ctx] / CONTEXT_UNIT_METERS.galaxy;
  return { unitsToPc, pcToUnits: 1 / unitsToPc };
}

/**
 * System-baked geometry (AU) → active-context units (TASK-084). `SystemScene`'s meshes,
 * orbit lines, and atmosphere are all sized in system units (AU) at build time; this
 * converts that size to the active context so the anchored system renders at its true
 * angular size everywhere, not only in `system`.
 *
 * `pcScales` is galaxy/parsec-anchored and cannot be reused here — see the task spec
 * (TASK-084 §Fix D1). Do not derive this as a ratio of two `pcScales` results: that
 * ratio-of-ratios can land on `0.9999999999999999` and move the `system`-context
 * baseline off bit-identical (same trap as the note above on `pcScales`).
 */
export function systemToContextScale(ctx: ContextId): number {
  if (ctx === 'system') return 1;
  return CONTEXT_UNIT_METERS.system / CONTEXT_UNIT_METERS[ctx];
}
