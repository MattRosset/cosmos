import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGaiaSourceIds } from '../src/gaia-sourceids.js';

/**
 * TASK-087 D1 contract (carve-out of TASK-069). The Gaia sidecar resolver maps a
 * pack-global `catalogId` → real DR3 `source_id`, kept as `bigint` end-to-end. These
 * tests ARE the contract Task B (octree-stream pick) will consume — there is no live
 * consumer today (docs/research/gaia-pick-identity-gap.md).
 *
 * The buffer is synthesised in-memory (a `BigInt64Array` served via `Response`) rather
 * than reading `apps/web/public/...`: depending on the web app's asset layout from a
 * packages/data test is cross-package coupling. The real sample pack's format is exercised
 * by the pack-octree writer tests; here we pin decode + index semantics.
 */

const MANIFEST_URL = 'https://example.test/packs/octree-gaia/manifest.json';

// Values chosen from the REAL sample sidecar (Step 0b): catalogId 0 and 1. Both are
// > 2^53, so a `Number()` decode would silently corrupt them — the test asserts the exact
// bigint compared as string to catch that.
const ID0 = 4000000000000000137n; // real sample catalogId 0
const ID1 = 4000000000000000274n; // real sample catalogId 1

/** Serve a synthetic BigInt64Array sidecar over a fetch mock. */
function servedSidecar(ids: readonly bigint[]): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const arr = new BigInt64Array(ids.length);
  ids.forEach((v, i) => (arr[i] = BigInt.asIntN(64, v)));
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    // Copy into a fresh ArrayBuffer so the served body has byteOffset 0.
    return new Response(arr.buffer.slice(0), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadGaiaSourceIds — decode + index (D1)', () => {
  it('resolves a known catalogId to its exact DR3 source_id (> 2^53, as bigint)', async () => {
    const { fetchImpl } = servedSidecar([ID0, ID1]);
    const resolver = loadGaiaSourceIds(MANIFEST_URL, { fetchImpl });

    const got0 = await resolver.resolve(0);
    const got1 = await resolver.resolve(1);

    // Log chosen inputs + measured values (CLAUDE.md rule 6): a CI-only failure is
    // triagable from these lines alone.
    // eslint-disable-next-line no-console
    console.log(`D1 decode: resolve(0)=${got0?.toString()} resolve(1)=${got1?.toString()}`);

    expect(got0?.toString()).toBe('4000000000000000137');
    expect(got1?.toString()).toBe('4000000000000000274');
    // Compared as bigint too — proves no Number() truncation upstream.
    expect(got0).toBe(ID0);
  });

  it('fetches the sidecar exactly once across many resolve calls', async () => {
    const { fetchImpl, calls } = servedSidecar([ID0, ID1]);
    const resolver = loadGaiaSourceIds(MANIFEST_URL, { fetchImpl });

    // Concurrent + subsequent calls must share one in-flight load.
    await Promise.all([resolver.resolve(0), resolver.resolve(1), resolver.resolve(0)]);
    await resolver.resolve(1);

    expect(calls).toHaveLength(1);
    // Sidecar resolved next to the manifest.
    expect(calls[0]).toBe('https://example.test/packs/octree-gaia/gaia-sourceids.bin');
  });

  it('returns null for out-of-range indices (< 0 and >= count)', async () => {
    const { fetchImpl } = servedSidecar([ID0, ID1]);
    const resolver = loadGaiaSourceIds(MANIFEST_URL, { fetchImpl });

    expect(await resolver.resolve(-1)).toBeNull();
    expect(await resolver.resolve(2)).toBeNull(); // count === 2
    expect(await resolver.resolve(1.5)).toBeNull(); // non-integer
  });
});

describe('loadGaiaSourceIds — missing sidecar degrades (D1)', () => {
  it('a 404 → every resolve returns null, warns exactly once, never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = (async () => new Response(null, { status: 404 })) as typeof fetch;
    const resolver = loadGaiaSourceIds(MANIFEST_URL, { fetchImpl });

    expect(await resolver.resolve(0)).toBeNull();
    expect(await resolver.resolve(1)).toBeNull();
    expect(await resolver.resolve(0)).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a 200 with a truncated (non-multiple-of-8) body → warns once, serves the whole ids only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 12 bytes = one full i64 id + 4 trailing bytes (a truncated second id).
    const body = new Uint8Array(12);
    new DataView(body.buffer).setBigInt64(0, ID0, /* littleEndian */ true);
    const fetchImpl = (async () => new Response(body.buffer, { status: 200 })) as typeof fetch;
    const resolver = loadGaiaSourceIds(MANIFEST_URL, { fetchImpl });

    expect((await resolver.resolve(0))?.toString()).toBe('4000000000000000137');
    expect(await resolver.resolve(1)).toBeNull(); // floor(12/8) === 1 → index 1 out of range
    expect(warn).toHaveBeenCalledTimes(1); // surfaced once, not silently dropped
  });

  it('a rejected fetch (network error) → null, warns once, no reject', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const resolver = loadGaiaSourceIds(MANIFEST_URL, { fetchImpl });

    await expect(resolver.resolve(0)).resolves.toBeNull();
    await expect(resolver.resolve(5)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
