import { spectralClassFromBV } from './spectral';
import { STRINGS } from './strings';

/**
 * TASK-068 — pure display-time derivations for the insight cards (C1–C7).
 * Every function is TOTAL: missing/non-finite input returns `null`, never a
 * "NaN"/"undefined" string — the card silently omits the line instead of
 * rendering filler. All fixed copy comes from `STRINGS`; nothing here embeds
 * its own English sentences.
 */

/**
 * Naked-eye limiting apparent magnitude under a dark sky (~6.5; the
 * conventional catalog cutoff — a rough perceptual bound, not a hard optic).
 */
export const NAKED_EYE_LIMIT_MAG = 6.5;

/** IAU nominal Earth radius (km), for the C4 size comparison. */
export const EARTH_RADIUS_KM = 6371;

type SpectralClass = ReturnType<typeof spectralClassFromBV>;

const SPECTRAL_PLAIN: Record<SpectralClass, string> = {
  B: STRINGS.spectralPlainB,
  A: STRINGS.spectralPlainA,
  F: STRINGS.spectralPlainF,
  G: STRINGS.spectralPlainG,
  K: STRINGS.spectralPlainK,
  M: STRINGS.spectralPlainM,
};

/**
 * C7 — approximate perceived star color per spectral class (CSS hex).
 * Values follow the classic blackbody star-color tables, nudged toward
 * saturation so the tint stays visible on the dark glass panel.
 */
const SPECTRAL_TINT: Record<SpectralClass, string> = {
  B: '#9db4ff',
  A: '#b8c6ff',
  F: '#e4ecff',
  G: '#fff2d5',
  K: '#ffd9a1',
  M: '#ff9d6f',
};

/**
 * C5 — rough main-sequence habitable-zone bounds in AU per spectral class,
 * scaled from the Kasting et al. (1993) conservative solar bounds
 * (~0.95–1.67 AU) by class luminosity. Order-of-magnitude educational copy,
 * not a climate model; A/B stars are omitted (short-lived, bounds contested).
 */
export const HABITABLE_ZONE_AU: Partial<Record<SpectralClass, readonly [number, number]>> = {
  F: [1.3, 2.4],
  G: [0.95, 1.7],
  K: [0.5, 0.95],
  M: [0.1, 0.3],
};

/** Resolve a spectral-class letter from an explicit class string or a B−V index. */
function resolveClass(bv: number | null, spectral?: string | null): SpectralClass | null {
  const letter = spectral?.trim().charAt(0).toUpperCase();
  if (letter !== undefined && letter in SPECTRAL_PLAIN) return letter as SpectralClass;
  if (bv === null || !Number.isFinite(bv)) return null;
  return spectralClassFromBV(bv);
}

/** Shared "human number": 3 significant figures, no trailing zeros. */
function fmtSig3(n: number): string {
  return parseFloat(n.toPrecision(3)).toString();
}

/** C1 — "Yellow dwarf — similar to the Sun" from B−V (or an explicit class letter). */
export function spectralPlainLanguage(bv: number | null, spectral?: string | null): string | null {
  const cls = resolveClass(bv, spectral);
  return cls === null ? null : SPECTRAL_PLAIN[cls];
}

/**
 * C2 input — apparent magnitude from absolute magnitude + distance:
 * m = M + 5·log₁₀(d / 10 pc). Null when the distance is not a positive finite pc.
 */
export function apparentMagnitude(absMag: number, distancePc: number): number | null {
  if (!Number.isFinite(absMag) || !Number.isFinite(distancePc) || distancePc <= 0) return null;
  return absMag + 5 * Math.log10(distancePc / 10);
}

/** C2 — one-line visibility verdict against {@link NAKED_EYE_LIMIT_MAG}. */
export function nakedEyeVisibility(apparentMag: number | null): string | null {
  if (apparentMag === null || !Number.isFinite(apparentMag)) return null;
  return apparentMag <= NAKED_EYE_LIMIT_MAG
    ? STRINGS.visibilityNakedEye
    : STRINGS.visibilityTelescope;
}

/** C4 — radius relative to Earth, e.g. { ratio: 9.14, label: "9.1× Earth" }. */
export function radiusVsEarth(radiusKm: number): { ratio: number; label: string } | null {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) return null;
  const ratio = radiusKm / EARTH_RADIUS_KM;
  return { ratio, label: `${fmtSig3(ratio)}${STRINGS.sizeVsEarthSuffix}` };
}

/**
 * C5 comparison anchors: Sol-planet periods (days) + semi-major axes (AU).
 * A period within ×/÷ {@link ORBIT_LIKE_RATIO} of an anchor earns the
 * "— like <planet>" tail; a body matching an anchor's period AND axis within
 * {@link ORBIT_SELF_EPSILON} IS that planet, so the tail is suppressed
 * ("Saturn — like Saturn" is noise, not insight).
 */
const ORBIT_ANCHORS: readonly { periodDays: number; aAu: number; like: string }[] = [
  { periodDays: 87.97, aAu: 0.387, like: STRINGS.orbitLikeMercury },
  { periodDays: 224.7, aAu: 0.723, like: STRINGS.orbitLikeVenus },
  { periodDays: 365.25, aAu: 1.0, like: STRINGS.orbitLikeEarth },
  { periodDays: 687.0, aAu: 1.524, like: STRINGS.orbitLikeMars },
  { periodDays: 4332.6, aAu: 5.203, like: STRINGS.orbitLikeJupiter },
  { periodDays: 10759, aAu: 9.537, like: STRINGS.orbitLikeSaturn },
  { periodDays: 60190, aAu: 30.07, like: STRINGS.orbitLikeNeptune },
];
export const ORBIT_LIKE_RATIO = 1.25;
export const ORBIT_SELF_EPSILON = 0.02;

/**
 * C5 — "88-day year" / "29.4-year orbit", with a "— like Mercury" tail when the
 * period lands near a Sol-planet anchor. periodDays MUST come from format.ts
 * `orbitalPeriodDays` (single home of the Kepler math).
 */
export function orbitInHumanTerms(periodDays: number, semiMajorAxisAu: number): string | null {
  if (!Number.isFinite(periodDays) || periodDays <= 0) return null;
  const base =
    periodDays < 1000
      ? `${fmtSig3(periodDays)}${STRINGS.orbitDayYearSuffix}`
      : `${fmtSig3(periodDays / 365.25)}${STRINGS.orbitYearOrbitSuffix}`;

  for (const anchor of ORBIT_ANCHORS) {
    const ratio = periodDays / anchor.periodDays;
    if (ratio < 1 / ORBIT_LIKE_RATIO || ratio > ORBIT_LIKE_RATIO) continue;
    const isSelf =
      Math.abs(ratio - 1) < ORBIT_SELF_EPSILON &&
      Number.isFinite(semiMajorAxisAu) &&
      Math.abs(semiMajorAxisAu / anchor.aAu - 1) < ORBIT_SELF_EPSILON;
    return isSelf ? base : `${base}${anchor.like}`;
  }
  return base;
}

/**
 * C5 — habitable-zone hint from semi-major axis + the PARENT STAR's B−V.
 * Positive-only: inside the class's {@link HABITABLE_ZONE_AU} band → hint;
 * outside, unknown class, or missing data → null (no cluttering negative).
 */
export function habitableZoneHint(semiMajorAxisAu: number, bv: number | null): string | null {
  if (!Number.isFinite(semiMajorAxisAu) || semiMajorAxisAu <= 0) return null;
  const cls = resolveClass(bv);
  if (cls === null) return null;
  const zone = HABITABLE_ZONE_AU[cls];
  if (zone === undefined) return null;
  return semiMajorAxisAu >= zone[0] && semiMajorAxisAu <= zone[1] ? STRINGS.hzHint : null;
}

/** C7 — CSS color for the panel's spectral tint, or null when B−V is missing. */
export function spectralTint(bv: number | null): string | null {
  if (bv === null || !Number.isFinite(bv)) return null;
  return SPECTRAL_TINT[spectralClassFromBV(bv)];
}
