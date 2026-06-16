/** ADR-004 §1: galaxy generation params. Every field optional ⇒ default applied
 *  from PROCGEN_GALAXY_DEFAULTS; `starCount` and `seed` are required. */
export interface GalaxyGenParams {
  readonly seed: number;
  readonly starCount: number;
  readonly discRadiusPc?: number;
  readonly discScaleLengthPc?: number;
  readonly discScaleHeightPc?: number;
  readonly armCount?: number;
  readonly armPitchRad?: number;
  readonly armWindings?: number;
  readonly armWidthPc?: number;
  readonly armContrast?: number;
  readonly bulgeFraction?: number;
  readonly bulgeRadiusPc?: number;
}

/** ADR-004 §1: the fixed default table (single source of truth). */
export const PROCGEN_GALAXY_DEFAULTS: Required<Omit<GalaxyGenParams, 'seed' | 'starCount'>> = {
  discRadiusPc: 15000,
  discScaleLengthPc: 3500,
  discScaleHeightPc: 300,
  armCount: 2,
  armPitchRad: 0.2304,
  armWindings: 1.0,
  armWidthPc: 1200,
  armContrast: 2.5,
  bulgeFraction: 0.18,
  bulgeRadiusPc: 1500,
};

/** ADR-004 §5: fixed PRNG fork stream ids. */
export const PROCGEN_STREAM_PLACEMENT = 0;
export const PROCGEN_STREAM_MASS = 1;
export const PROCGEN_STREAM_JITTER = 2;
