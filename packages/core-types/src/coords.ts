/**
 * Coordinate & scale-context types. See docs/decisions/ADR-001-coordinates.md.
 *
 * The universe is a hierarchy of local frames ("scale contexts"), each with its
 * own unit. Positions are f64 (JS numbers) inside a context, and are converted
 * to camera-relative f32 only at the rendering boundary (packages/coords).
 */

export type ContextId = 'universe' | 'galaxy' | 'system' | 'planet';

/** Unit size of each context, expressed in meters. */
export const CONTEXT_UNIT_METERS: Record<ContextId, number> = {
  universe: 3.0857e22, // 1 Mpc
  galaxy: 3.0857e16, // 1 pc
  system: 1.495978707e11, // 1 AU
  planet: 1e3, // 1 km
};

/** Position within a scale context. `local` is in context units, f64. */
export interface UniversePosition {
  readonly context: ContextId;
  readonly local: readonly [number, number, number];
}

/** Rebase threshold: when |cameraLocal| exceeds this, the origin is rebased. */
export const REBASE_THRESHOLD_UNITS = 10_000;
