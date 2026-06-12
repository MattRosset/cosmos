/** JD of the Unix epoch 1970-01-01T00:00:00Z. */
export const UNIX_EPOCH_JD = 2440587.5;

/** Convert Unix milliseconds to Julian Date. */
export function unixMsToEpochJD(unixMs: number): number {
  return UNIX_EPOCH_JD + unixMs / 86_400_000;
}

/** Convert Julian Date to Unix milliseconds. */
export function epochJDToUnixMs(epochJD: number): number {
  return (epochJD - UNIX_EPOCH_JD) * 86_400_000;
}
