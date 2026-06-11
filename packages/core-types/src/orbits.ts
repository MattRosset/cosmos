/**
 * Keplerian orbital elements. All angles in RADIANS — degrees exist only at the
 * data-pack boundary (architecture §5.5). Never abbreviate anomaly names.
 */
export interface KeplerElements {
  /** Semi-major axis, AU. */
  readonly semiMajorAxisAu: number;
  /** Eccentricity, dimensionless; [0, 1) elliptical. */
  readonly eccentricity: number;
  /** Inclination to the reference plane, radians. */
  readonly inclinationRad: number;
  /** Longitude of the ascending node (Ω), radians. */
  readonly ascendingNodeLongitudeRad: number;
  /** Argument of periapsis (ω), radians. */
  readonly argumentOfPeriapsisRad: number;
  /** Mean anomaly at `epochJD` (M₀), radians. */
  readonly meanAnomalyAtEpochRad: number;
  /** Reference epoch for the mean anomaly, Julian Date. */
  readonly epochJD: number;
  /** Standard gravitational parameter μ = GM of the PARENT body, km³/s². */
  readonly muKm3S2: number;
}
