import { describe, it, expect, vi } from 'vitest';
import type { BodyId } from '@cosmos/core-types';
import type { GaiaSourceIdResolver } from '@cosmos/data';
import { loadGaiaSourceIds } from '@cosmos/data';
import { selectWithGaiaUpgrade, type SelectionPort } from './gaia-identity';

/**
 * TASK-088 D4 contract: the provisional `gaia:<catalogId>` from the sync pick is upgraded to
 * the real `gaia:<source_id>` at the select site, and a stale resolve must NOT clobber a newer
 * selection. Exercises the REAL resolver end-to-end for the identity chain (gate 3), and a
 * controllable resolver for the staleness guard.
 */

const MANIFEST_URL = 'https://example.test/packs/octree-gaia/manifest.json';
// The REAL sample sidecar's catalogId 0 (Step 0e). > 2^53 — a `Number()` decode would corrupt
// it, so the assertion is a STRING compare against the full 19 digits.
const ID0 = 4000000000000000137n;

/** A mutable in-memory selection port (mirrors the useSelectionStore slice StarScene injects). */
function makePort(): SelectionPort & { value: BodyId | null } {
  return {
    value: null as BodyId | null,
    select(id) {
      this.value = id;
    },
    getSelectedId() {
      return this.value;
    },
  };
}

/** Serve a synthetic BigInt64Array sidecar (precedent: packages/data gaia-sourceids.test.ts). */
function servedResolver(ids: readonly bigint[]): GaiaSourceIdResolver {
  const arr = new BigInt64Array(ids.length);
  ids.forEach((v, i) => (arr[i] = BigInt.asIntN(64, v)));
  const fetchImpl = (async () => new Response(arr.buffer.slice(0), { status: 200 })) as typeof fetch;
  return loadGaiaSourceIds(MANIFEST_URL, { fetchImpl });
}

/** A resolver whose single resolve is settled manually, to drive the staleness race. */
function deferredResolver(): { resolver: GaiaSourceIdResolver; resolve: (sid: bigint | null) => void } {
  let settle!: (sid: bigint | null) => void;
  const p = new Promise<bigint | null>((r) => (settle = r));
  return { resolver: { resolve: () => p }, resolve: settle };
}

describe('selectWithGaiaUpgrade — identity chain (TASK-088 D4, gate 3)', () => {
  it('upgrades a provisional gaia:<catalogId> to the real 19-digit gaia:<source_id> (string, no Number() truncation)', async () => {
    const port = makePort();
    const resolver = servedResolver([ID0]);

    selectWithGaiaUpgrade('gaia:0', port, resolver);
    // Immediately: the provisional catalog-indexed id is selected (responsive).
    expect(port.value).toBe('gaia:0');

    await vi.waitFor(() => expect(port.value).toBe('gaia:4000000000000000137'));
    // eslint-disable-next-line no-console
    console.log(`D4 chain: gaia:0 → ${port.value}`);
    // Asserted as a STRING — proves the bigint was interpolated losslessly, never Number(sid).
    expect(port.value).toBe(`gaia:${ID0.toString()}`);
  });

  it('a non-gaia id is selected verbatim with no upgrade attempt', () => {
    const port = makePort();
    const resolver = servedResolver([ID0]);
    selectWithGaiaUpgrade('hyg-v41:42', port, resolver);
    expect(port.value).toBe('hyg-v41:42');
  });

  it('no resolver present → the provisional gaia id is kept', () => {
    const port = makePort();
    selectWithGaiaUpgrade('gaia:0', port, undefined);
    expect(port.value).toBe('gaia:0');
  });

  it('a null resolution (absent sidecar) leaves the provisional id (degrade to no-identity)', async () => {
    const { resolver, resolve } = deferredResolver();
    const port = makePort();
    selectWithGaiaUpgrade('gaia:0', port, resolver);
    resolve(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(port.value).toBe('gaia:0');
  });
});

describe('selectWithGaiaUpgrade — staleness guard (TASK-088 D4, failure mode)', () => {
  it('a slow resolve of an OLD click does NOT overwrite a newer selection', async () => {
    const { resolver, resolve } = deferredResolver();
    const port = makePort();

    // Old click: provisional gaia:0 selected, upgrade in flight.
    selectWithGaiaUpgrade('gaia:0', port, resolver);
    expect(port.value).toBe('gaia:0');

    // Newer click lands before the resolve completes (a different body).
    port.select('hyg-v41:999');

    // The old resolve now completes — the guard must see the selection changed and NOT clobber.
    resolve(ID0);
    await Promise.resolve();
    await Promise.resolve();

    expect(port.value).toBe('hyg-v41:999');
  });

  it('the guard still upgrades when the provisional id is STILL selected', async () => {
    const { resolver, resolve } = deferredResolver();
    const port = makePort();
    selectWithGaiaUpgrade('gaia:0', port, resolver);
    resolve(ID0);
    await vi.waitFor(() => expect(port.value).toBe(`gaia:${ID0.toString()}`));
  });
});
