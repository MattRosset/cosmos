import type { BodyId } from '@cosmos/core-types';
import type { GaiaSourceIdResolver } from '@cosmos/data';

/**
 * The slice of the selection store this upgrade needs (TASK-088 D4). Injected so the async
 * upgrade + staleness guard is unit-testable without WebGL or React, over the SAME function
 * StarScene runs for real clicks (CLAUDE.md testing rule 1 — query real state, don't re-derive).
 */
export interface SelectionPort {
  select(id: BodyId | null): void;
  getSelectedId(): BodyId | null;
}

/**
 * Select `id`, then — if it is a provisional `gaia:<catalogId>` — asynchronously upgrade it to
 * the real `gaia:<source_id>` via the D1 resolver (TASK-088 D4). The provisional id is selected
 * immediately (responsive; non-gaia ids behave exactly as before). The upgrade is guarded: it
 * only replaces the selection if the provisional `id` is STILL selected when the resolve
 * completes — a newer click must win, and a slow resolve of an old click must not clobber it.
 * The `bigint` source_id is interpolated directly (never `Number(sid)`: ids > 2^53 corrupt). A
 * null `sid` (absent / unavailable sidecar) leaves the provisional id (degrade to no-identity).
 */
export function selectWithGaiaUpgrade(
  id: BodyId | null,
  selection: SelectionPort,
  gaiaIds: GaiaSourceIdResolver | undefined,
): void {
  selection.select(id);
  if (id === null || gaiaIds === undefined || !id.startsWith('gaia:')) return;
  const catalogId = Number(id.slice(5));
  if (!Number.isInteger(catalogId)) return;
  void gaiaIds.resolve(catalogId).then((sid) => {
    if (sid === null) return;
    if (selection.getSelectedId() === id) selection.select(`gaia:${sid}`);
  });
}
