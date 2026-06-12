/** 1 AU in km (IERS 2012). */
export const AU_KM = 1.495978707e8;
/** Seconds per Julian day. */
export const SECONDS_PER_DAY = 86_400;

/** @internal Last Newton–Raphson iteration count from the most recent solveKepler call. */
export let _lastIterations = 0;

/** Mean motion n = sqrt(μ / a³), a converted km internally. Radians per second. */
export function meanMotionRadPerS(semiMajorAxisAu: number, muKm3S2: number): number {
  const aKm = semiMajorAxisAu * AU_KM;
  return Math.sqrt(muKm3S2 / (aKm * aKm * aKm));
}

/** Normalize angle to the half-open interval (−π, π]. */
function normAngle(rad: number): number {
  const TWO_PI = 2 * Math.PI;
  let a = rad % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a <= -Math.PI) a += TWO_PI;
  return a;
}

/**
 * Solve Kepler's equation E − e·sin E = M for the eccentric anomaly.
 * Newton–Raphson, |ΔE| < 1e-12 tolerance, ≤ 12 iterations; falls back to
 * 64-step bisection on non-convergence (never throws for e ∈ [0, 0.99]).
 * meanAnomalyRad may be any finite value (normalised internally).
 * Curtis §3.3 / Vallado §2.2.
 */
export function solveKepler(meanAnomalyRad: number, eccentricity: number): number {
  if (eccentricity >= 1) {
    throw new RangeError(`Hyperbolic orbits (e ≥ 1) not supported; got e=${eccentricity}`);
  }

  const meanAnomalyNorm = normAngle(meanAnomalyRad);

  // Initial guess: E₀ = M for low-e; π·sign(M) for high-e (Curtis §3.3).
  let eccentricAnomalyRad =
    eccentricity < 0.8 ? meanAnomalyNorm : Math.PI * Math.sign(meanAnomalyNorm);

  let iters = 0;
  let converged = false;
  for (let k = 0; k < 12; k++) {
    iters++;
    const sinE = Math.sin(eccentricAnomalyRad);
    const cosE = Math.cos(eccentricAnomalyRad);
    const dE =
      (eccentricAnomalyRad - eccentricity * sinE - meanAnomalyNorm) /
      (1 - eccentricity * cosE);
    eccentricAnomalyRad -= dE;
    if (Math.abs(dE) < 1e-12) {
      converged = true;
      break;
    }
  }
  _lastIterations = iters;

  if (!converged) {
    // Bracketed bisection: f(E) = E − e·sinE − M is monotone increasing,
    // so [M−π, M+π] always brackets the root.
    let lo = meanAnomalyNorm - Math.PI;
    let hi = meanAnomalyNorm + Math.PI;
    for (let b = 0; b < 64; b++) {
      const mid = 0.5 * (lo + hi);
      if (mid - eccentricity * Math.sin(mid) - meanAnomalyNorm < 0) lo = mid;
      else hi = mid;
    }
    eccentricAnomalyRad = 0.5 * (lo + hi);
  }

  return eccentricAnomalyRad;
}
