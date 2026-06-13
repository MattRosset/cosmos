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
