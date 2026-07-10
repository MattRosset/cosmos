import { CONTEXT_UNIT_METERS, type ContextId } from '@cosmos/core-types';

/** Seconds in a Julian year (365.25 d) — light-travel and @c conversions. */
const SECONDS_PER_YEAR = 365.25 * 86_400;

/** Context-unit label for the speed readout (unit per second). */
const CONTEXT_SPEED_LABEL: Record<ContextId, string> = {
  universe: 'Mpc/s',
  galaxy: 'pc/s',
  system: 'AU/s',
  planet: 'km/s',
};

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};

function toSuperscript(n: number): string {
  return String(n)
    .split('')
    .map((ch) => SUPERSCRIPT[ch] ?? ch)
    .join('');
}

/** Human-readable magnitude for a plain count (no unit). */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n >= 1000) return Math.round(n).toLocaleString('en-US');
  if (n >= 100) return String(Math.round(n));
  if (n >= 1) return String(parseFloat(n.toFixed(1)));
  if (n > 0) return n.toPrecision(2);
  return '0';
}

/** Speed magnitude in the context unit (mirrors the historic HUD formatter). */
function fmtSpeedMagnitude(v: number): string {
  if (v >= 100) return Math.round(v).toLocaleString('en-US');
  if (v >= 1) return v.toFixed(1);
  if (v >= 0.01) return v.toFixed(2);
  return v.toPrecision(2);
}

/** km/s with scientific notation past 10⁴ (velocities inside the galaxy are vast). */
function fmtKmS(kms: number): string {
  if (!Number.isFinite(kms)) return '∞ km/s';
  if (kms < 1e4) return `${fmtNum(kms)} km/s`;
  const exp = Math.floor(Math.log10(kms));
  const mantissa = kms / 10 ** exp;
  return `${mantissa.toFixed(1)}×10${toSuperscript(exp)} km/s`;
}

/** Split a duration in seconds into its largest sensible unit. */
function pickTimeUnit(seconds: number): { value: number; unit: string } {
  const years = seconds / SECONDS_PER_YEAR;
  if (years >= 1) return { value: years, unit: 'years' };
  const days = seconds / 86_400;
  if (days >= 1) return { value: days, unit: 'days' };
  const hours = seconds / 3600;
  if (hours >= 1) return { value: hours, unit: 'hours' };
  const minutes = seconds / 60;
  if (minutes >= 1) return { value: minutes, unit: 'minutes' };
  return { value: seconds, unit: 'seconds' };
}

/** Plain human duration, e.g. "4.2 years" / "8.6 minutes". */
function humanDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const { value, unit } = pickTimeUnit(seconds);
  return `${fmtNum(value)} ${unit}`;
}

/**
 * Speed readout: context unit first, km/s second — e.g. "3.2 pc/s · 9.9×10¹³ km/s".
 * km/s from speedUnitsPerS × CONTEXT_UNIT_METERS[contextId] / 1000. In `planet`
 * context the unit already IS km/s, so the redundant second term is dropped.
 */
export function formatSpeedKmS(speedUnitsPerS: number, contextId: ContextId): string {
  const ctxPart = `${fmtSpeedMagnitude(speedUnitsPerS)} ${CONTEXT_SPEED_LABEL[contextId]}`;
  if (contextId === 'planet') return ctxPart;
  const kms = (speedUnitsPerS * CONTEXT_UNIT_METERS[contextId]) / 1000;
  return `${ctxPart} · ${fmtKmS(kms)}`;
}

/**
 * Light-travel time for a distance already expressed in light-years. Light crosses
 * N ly in N years, so ≥1 ly reads "N years"; nearer distances read "N light-<unit>".
 */
export function formatLightTravel(distanceLy: number): string {
  const seconds = distanceLy * SECONDS_PER_YEAR;
  const { value, unit } = pickTimeUnit(seconds);
  if (unit === 'years') return `${fmtNum(value)} years`;
  return `${fmtNum(value)} light-${unit}`;
}

/** "at c: 4.2 years" — travel time at the speed of light for an N-ly distance. */
export function formatEtaAtC(distanceLy: number): string {
  return `at c: ${humanDuration(distanceLy * SECONDS_PER_YEAR)}`;
}

/**
 * D7 crossing hint: time to traverse `spanM` meters at the current speed. Returns
 * "—" when stationary (crossing time is unbounded).
 */
export function formatCrossingTime(
  speedUnitsPerS: number,
  contextId: ContextId,
  spanM: number,
): string {
  const speedMs = speedUnitsPerS * CONTEXT_UNIT_METERS[contextId];
  if (speedMs <= 0) return '—';
  return humanDuration(spanM / speedMs);
}

/**
 * epochJD → "2026-06-12 14:05 UTC" (UTC, minutes).
 * Duplicating the JD→Unix formula is sanctioned — ui must not import sim-time.
 */
export function formatEpochJD(epochJD: number): string {
  const unixMs = (epochJD - 2440587.5) * 86_400_000;
  return new Date(unixMs).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

/**
 * Orbital period from Keplerian elements.
 * aAu: semi-major axis in AU; muKm3S2: GM of parent body in km³/s².
 * Result: "N d" when < 1000 days, else "N yr" (3 sig figs each).
 */
export function formatOrbitalPeriod(aAu: number, muKm3S2: number): string {
  const aKm = aAu * 1.495978707e8;
  const Ts = 2 * Math.PI * Math.sqrt(aKm ** 3 / muKm3S2);
  const Td = Ts / 86400;
  if (Td < 1000) {
    return `${parseFloat(Td.toPrecision(3))} d`;
  }
  const Ty = Td / 365.25;
  return `${parseFloat(Ty.toPrecision(3))} yr`;
}
