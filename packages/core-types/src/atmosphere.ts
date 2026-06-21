/**
 * Atmospheric-scattering parameters. See docs/decisions/ADR-005-atmospheric-scattering.md.
 *
 * O'Neil analytic single-scattering on an inverted shell (ADR-005 §1). This module
 * owns the data contract only; the shader lives in render-planets (TASK-048).
 */

/** ADR-005 §4: O'Neil analytic single-scattering params. Every field optional ⇒
 *  default applied from ATMOSPHERE_DEFAULTS. */
export interface AtmosphereParams {
  /** Shell outer radius as a multiple of the planet radius (> 1). */
  readonly atmosphereRadiusScale?: number;
  /** Rayleigh scattering coefficient, per-channel LINEAR RGB. */
  readonly betaRayleigh?: readonly [number, number, number];
  readonly betaMie?: number;
  /** Fraction of shell thickness (O'Neil fScaleDepth). */
  readonly rayleighScaleHeight?: number;
  /** Mie phase asymmetry g (forward-scattering ⇒ negative). */
  readonly mieG?: number;
  readonly sunIntensity?: number;
}

/** ADR-005 §3 fixed Earth-like default table (single source of truth). */
export const ATMOSPHERE_DEFAULTS: Required<AtmosphereParams> = {
  atmosphereRadiusScale: 1.025,
  betaRayleigh: [5.8e-3, 13.5e-3, 33.1e-3],
  betaMie: 21e-3,
  rayleighScaleHeight: 0.25,
  mieG: -0.758,
  sunIntensity: 20.0,
};
