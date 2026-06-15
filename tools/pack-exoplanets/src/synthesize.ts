/**
 * Deterministic synthesis for incomplete exoplanet archive data.
 *
 * All fallback rules are NORMATIVE (architecture §5.7):
 *   - Semi-major axis: pl_orbsmax → else Kepler III from pl_orbper
 *   - Eccentricity: pl_orbeccen → else 0; clamped to [0, 0.95]
 *   - Orbit orientation: synthesized per-system from seeded PRNG (inclination,
 *     ascending node) plus per-planet (argument of periapsis, mean anomaly)
 *   - Radius: pl_rade×6371 → pl_bmasse-derived (capped 11.2 R⊕) → 2×6371 km
 *   - Color: equilibrium temperature bands
 *   - B-V: Ballesteros (2012) inverse → 1.5 fallback
 *   - absMag: photometric formula → 10.0 fallback
 *
 * PRNG call order (fixed — changing it breaks determinism for existing packs):
 *   system level: (1) inclinationRad, (2) ascendingNodeLongitudeRad
 *   per planet in sorted order: (3) argumentOfPeriapsisRad if pl_orblper absent,
 *                               (4) meanAnomalyAtEpochRad (always)
 */

import { createHash } from 'node:crypto';
import { createPrng, type Prng } from '@cosmos/core-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 1 AU in km (IERS 2012). */
export const AU_KM = 1.495978707e8;

/** Sun's standard gravitational parameter, km³/s². */
const MU_SUN = 1.32712440018e11;

const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------------------
// Slug & seed
// ---------------------------------------------------------------------------

/** Canonical host slug: lowercase, spaces → hyphens, strip non-[a-z0-9-]. */
export function hostSlug(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/** Planet id suffix from pl_name: strip hostname prefix, trim, lowercase. */
export function planetSuffix(plName: string, hostname: string): string {
  const lower = plName.toLowerCase();
  const prefix = hostname.toLowerCase();
  return lower.startsWith(prefix) ? lower.slice(prefix.length).trim() : lower.trim();
}

/**
 * Seed from host slug: first 4 bytes of SHA-256, interpreted as big-endian u32.
 * All synthesized values for a system derive from this seed via the PRNG,
 * consumed in the documented call order above.
 */
export function seedFromSlug(slug: string): number {
  const buf = createHash('sha256').update(slug).digest();
  return buf.readUInt32BE(0);
}

export function makePrng(slug: string): Prng {
  return createPrng(seedFromSlug(slug));
}

// ---------------------------------------------------------------------------
// Host star synthesis
// ---------------------------------------------------------------------------

/**
 * Inverts the Ballesteros (2012) T(B-V) formula to recover B-V from Teff.
 *
 * Forward: T = 4600 · (1/(0.92·bv + 1.7) + 1/(0.92·bv + 0.62))
 * Substituting u = 0.92·bv gives the quadratic:
 *   T·u² + (2.32T − 9200)·u + (1.054T − 10672) = 0
 * We take the positive root (u > 0 for physical Teff).
 * Clamped to [−0.4, 2.0].
 */
export function ballesterosInvert(teff: number): number {
  const a = teff;
  const b = 2.32 * teff - 9200;
  const c = 1.054 * teff - 10672;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 1.5;
  const u = (-b + Math.sqrt(disc)) / (2 * a);
  const bv = u / 0.92;
  return Math.max(-0.4, Math.min(2.0, bv));
}

/** Absolute magnitude from apparent magnitude and parallax distance. */
export function absMagFromApparent(syVmag: number, syDistPc: number): number {
  return syVmag - 5 * Math.log10(syDistPc / 10);
}

/** IAU nominal solar radius, km. */
const SUN_RADIUS_KM = 695700;

/**
 * Host-star disc radius in km. The archive gives `st_rad` in solar radii; when
 * absent we assume 1 R_sun. This drives a rendered disc only (NAV-A) — it is not
 * used for any physics.
 */
export function resolveStarRadiusKm(stRadSolar: number | null): number {
  return (stRadSolar ?? 1) * SUN_RADIUS_KM;
}

/** Ballesteros (2012): B-V → effective temperature, Kelvin (forward formula). */
function bvToTemperature(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/**
 * Linear-RGB star tint from B-V color index. Mirrors `@cosmos/render-stars`
 * blackbody.ts (Ballesteros 2012 T(B-V) + Tanner Helland blackbody approximation
 * + sRGB→linear) so the rendered host disc matches the galaxy-context star sprite.
 * Duplicated here on purpose: tools must not depend on render packages (Three.js,
 * dependency-boundary lint, §4). B-V is expected clamped to [-0.4, 2.0].
 */
export function bvToStarColorLinear(bv: number): readonly [number, number, number] {
  const t = bvToTemperature(bv) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const toLinear = (c: number): number => {
    const s = Math.max(0, Math.min(1, c / 255));
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [toLinear(r), toLinear(g), toLinear(b)];
}

// ---------------------------------------------------------------------------
// Orbital element synthesis
// ---------------------------------------------------------------------------

/** Standard gravitational parameter for the host, km³/s². */
export function hostMu(stMassSolar: number | null): number {
  return (stMassSolar ?? 1.0) * MU_SUN;
}

/**
 * Semi-major axis from orbital period via Kepler's third law.
 *   a³ = μ·P² / (4π²)
 * Returns a in AU.
 */
export function semiMajorFromPeriod(periodDays: number, muKm3S2: number): number {
  const P = periodDays * 86400; // seconds
  const aKm = Math.cbrt((muKm3S2 * P * P) / (4 * Math.PI * Math.PI));
  return aKm / AU_KM;
}

/** Eccentricity with fallback and clamp to [0, 0.95]. */
export function resolveEccentricity(raw: number | null): number {
  return Math.max(0, Math.min(0.95, raw ?? 0));
}

// ---------------------------------------------------------------------------
// Radius synthesis
// ---------------------------------------------------------------------------

const EARTH_RADIUS_KM = 6371;
const MAX_RADIUS_EARTH_RADII = 11.2;

/**
 * Planet radius in km.
 *   1. pl_rade present → pl_rade × 6371 km
 *   2. pl_bmasse present → 6371 × min(pl_bmasse^0.28, 11.2) km
 *      (mass-radius relation, capped at 11.2 R⊕ to avoid unphysical values)
 *   3. else → 2 × 6371 km (anonymous 2-R⊕ default)
 */
export function resolveRadius(plRadeEarth: number | null, plBmasseEarth: number | null): number {
  if (plRadeEarth !== null) {
    return plRadeEarth * EARTH_RADIUS_KM;
  }
  if (plBmasseEarth !== null) {
    const rEarth = Math.min(Math.pow(plBmasseEarth, 0.28), MAX_RADIUS_EARTH_RADII);
    return rEarth * EARTH_RADIUS_KM;
  }
  return 2 * EARTH_RADIUS_KM;
}

// ---------------------------------------------------------------------------
// Color synthesis
// ---------------------------------------------------------------------------

/** Stellar luminosity in solar units from archive columns. Missing → 1. */
function stellarLuminosity(stRadSolar: number | null, stTeff: number | null): number {
  if (stRadSolar === null || stTeff === null) return 1;
  return stRadSolar * stRadSolar * Math.pow(stTeff / 5772, 4);
}

/**
 * Equilibrium temperature (zero-albedo, uniform redistribution approximation).
 *   T_eq = 278.3 · L^0.25 / sqrt(a_au)   [K]
 */
export function equilibriumTemp(
  stRadSolar: number | null,
  stTeff: number | null,
  aAu: number,
): number {
  const L = stellarLuminosity(stRadSolar, stTeff);
  return (278.3 * Math.pow(L, 0.25)) / Math.sqrt(aAu);
}

/**
 * Surface color from equilibrium temperature bands:
 *   T_eq > 1000 K  → hot (lava-like)    [0.55, 0.35, 0.20]
 *   200–1000 K     → temperate (rocky)  [0.25, 0.35, 0.45]
 *   < 200 K        → cold (icy)         [0.75, 0.78, 0.82]
 */
export function surfaceColorFromTeq(teq: number): readonly [number, number, number] {
  if (teq > 1000) return [0.55, 0.35, 0.20];
  if (teq >= 200) return [0.25, 0.35, 0.45];
  return [0.75, 0.78, 0.82];
}

// ---------------------------------------------------------------------------
// Per-system PRNG synthesis (call order is the contract — do not reorder)
// ---------------------------------------------------------------------------

export interface SystemPlane {
  inclinationRad: number;
  ascendingNodeLongitudeRad: number;
}

/**
 * Draw the shared orbital plane for a system.
 * Consumes PRNG calls 1 and 2 (must be first draws on the system PRNG).
 *
 * Inclination is drawn uniform in cos(i) ∈ [−1,1] then acos'd — this gives
 * an isotropic distribution of orbital poles on the sphere.
 */
export function drawSystemPlane(prng: Prng): SystemPlane {
  const inclinationRad = Math.acos(prng.range(-1, 1));
  const ascendingNodeLongitudeRad = prng.range(0, TWO_PI);
  return { inclinationRad, ascendingNodeLongitudeRad };
}

/**
 * Draw per-planet angle values.
 * Call order per planet (in sorted planet order):
 *   - argumentOfPeriapsisRad: if pl_orblper absent → prng.range(0, 2π); else use archive value
 *   - meanAnomalyAtEpochRad: always prng.range(0, 2π) (phases are unknown)
 */
export function drawPlanetAngles(
  prng: Prng,
  plOrblperDeg: number | null,
): { argumentOfPeriapsisRad: number; meanAnomalyAtEpochRad: number } {
  const argumentOfPeriapsisRad =
    plOrblperDeg !== null ? (plOrblperDeg * Math.PI) / 180 : prng.range(0, TWO_PI);
  const meanAnomalyAtEpochRad = prng.range(0, TWO_PI);
  return { argumentOfPeriapsisRad, meanAnomalyAtEpochRad };
}
