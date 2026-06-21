/**
 * Nebula billboard params. See docs/architecture.md §5.11 (billboard volumetric-look).
 *
 * Layered, camera-facing noise billboards. Positions/radii here are CONTEXT UNITS
 * relative to the field origin; the field origin itself is absolute galaxy-context
 * parsecs (f64). This module owns the data contract only.
 */

/** One camera-facing layered-noise billboard (§5.11 "billboard volumetric-look").
 *  Positions/radii are CONTEXT UNITS relative to the field origin. */
export interface NebulaLayer {
  /** Billboard center, context units relative to NebulaField.originPc. */
  readonly centerUnits: readonly [number, number, number];
  /** Billboard radius, context units. */
  readonly radiusUnits: number;
  /** Tint, LINEAR RGB in [0,1]. */
  readonly colorLinear: readonly [number, number, number];
  /** Per-layer opacity scalar in [0,1] (overdraw control, §5.11). */
  readonly opacity: number;
  /** Noise seed for the layer's fragment pattern (deterministic, §8.6). */
  readonly seed: number;
}

export interface NebulaField {
  readonly id: string;
  /** Field origin, galaxy-context parsecs, f64. */
  readonly originPc: readonly [number, number, number];
  readonly layers: readonly NebulaLayer[];
}

/** §5.11 overdraw cap — renderers must not exceed this layer count per field. */
export const MAX_NEBULA_LAYERS = 32;
