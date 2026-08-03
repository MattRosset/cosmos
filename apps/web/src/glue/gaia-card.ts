/**
 * Single-slot holder for the picked Gaia star's physical attributes (TASK-089 D2).
 * Populated at the select site (not inside the pure `pickAt`), cleared on non-gaia
 * picks. The InfoPanel reads it only when the holder's lineage matches the current
 * selectedId (D5.2 match-check), so a stale entry never paints against a newer pick.
 */
export interface GaiaCardDetails {
  readonly catalogId: number;
  /** Filled by the async upgrade (D4). Null until the sidecar resolves (degrade path). */
  sourceId: bigint | null;
  /** Absolute galactic-frame position, Sol-origin, parsecs. |positionPc| = dist from Sol. */
  readonly positionPc: readonly [number, number, number];
  readonly absMag: number;
  readonly colorIndexBV: number;
}

export const gaiaCardHolder: { current: GaiaCardDetails | null } = { current: null };

/**
 * D5.2 lineage match-check — the single-slot holder's safety guard (TASK-089's #1 risk:
 * a slow async id-upgrade of an old click must never paint its attributes onto a newer
 * pick's card). Returns the holder ONLY when its lineage matches `id`, else null:
 *   - provisional `gaia:<catalogId>` matches `holder.catalogId`, OR
 *   - upgraded `gaia:<source_id>` matches `holder.sourceId` (BigInt: ids > 2^53 — never
 *     `Number(sid)`, which would truncate; `BigInt()` is guarded against a non-numeric tail).
 * A mismatch (stale holder vs newer selection, or vice-versa) returns null → the card falls
 * through to the bare-id display rather than showing another star's physics. Pure, so the
 * safety-critical branch is unit-tested independent of the WebGL pick path.
 */
export function gaiaCardFor(
  id: string,
  holder: GaiaCardDetails | null,
): GaiaCardDetails | null {
  if (!id.startsWith('gaia:') || holder === null) return null;
  const tail = id.slice(5);
  // Provisional id (gaia:<catalogId>): small uint32 catalog index, Number is exact.
  const tailNum = Number(tail);
  if (Number.isInteger(tailNum) && tailNum === holder.catalogId) return holder;
  // Upgraded id (gaia:<source_id>): 19-digit DR3 id, BigInt only.
  if (holder.sourceId !== null) {
    try {
      if (BigInt(tail) === holder.sourceId) return holder;
    } catch {
      // non-numeric tail — not a match
    }
  }
  return null;
}
