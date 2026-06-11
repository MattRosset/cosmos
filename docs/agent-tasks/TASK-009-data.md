# Task: `data` v1 — star-pack loader, region query, name search

**ID:** TASK-009
**Target package:** `packages/data` (new)
**Size:** M
**Phase:** 1 — lane A (data)
**Depends on:** TASK-008

## Goal

`@cosmos/data` loads a star pack (manifest + bin + names) and exposes the uniform
body API of architecture §5.7 over it: record lookup, name search, AABB region
queries, and an allocation-free nearest-star query (this scalar feeds `nav`'s
speed law in the M1 integration). Pure TypeScript — runs identically in Node tests
and the browser. Phase 1 simplification (documented in the README): decode happens
on the main thread at load time (one pack, < 100 ms); the `worker-data` offload
arrives with the `workers` package in Phase 3 — leave a TODO referencing §5.13.

## Frozen Interface

```ts
// public API of @cosmos/data
import type { BodyId, StarBatch, StarRecord } from '@cosmos/core-types';

export type Vec3Pc = readonly [number, number, number];

export interface StarDataSource {
  /** The full pack as one renderer-ready batch (tile-local f32, §5.2). */
  readonly batch: StarBatch;
  /** Record by id ("hyg:32263") — absolute positionPc (originPc + relative, f64). */
  getBody(id: BodyId): StarRecord | null;
  /** Record by batch index (0 ≤ i < batch.count). */
  getByIndex(index: number): StarRecord;
  /**
   * Name search: case-insensitive substring over pack names, prefix matches
   * ranked first, then by brightness (ascending absMag). "hip 32349" / "HIP32349"
   * resolves via hipIds. Must return in < 50 ms over 120k records (§5.12).
   */
  search(query: string, maxResults?: number): readonly StarRecord[];
  /** Indices of stars inside the AABB (absolute galaxy-frame pc), capped. */
  queryRegion(minPc: Vec3Pc, maxPc: Vec3Pc, maxCount: number): Uint32Array;
  /**
   * Index of the star nearest to (x, y, z) (absolute galaxy-frame pc), or -1 if
   * the pack is empty. ZERO allocations — called every frame by the integration.
   */
  nearestStarIndex(xPc: number, yPc: number, zPc: number): number;
}

export interface LoadOptions {
  /** Injectable for Node tests; defaults to globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Fetch + validate + decode a pack. Rejects (throws PackFormatError) when
 * manifest.packFormatVersion !== STAR_PACK_FORMAT_VERSION (§11), when a buffer
 * slice falls outside the bin, or when the bin's SHA-256 mismatches the manifest.
 */
export function loadStarPack(
  manifestUrl: string,
  opts?: LoadOptions,
): Promise<StarDataSource>;

export class PackFormatError extends Error {}
```

## Inputs / Outputs

- **Inputs:** the pack built by TASK-008. Tests use the mini fixture pack produced by
  running `tools/pack-stars` on its committed fixture CSV (generate into a temp dir in
  a test setup step — do not hand-craft binary fixtures).
- **Outputs:** e.g. `search('sirius')[0]` → `{ id: 'hyg:…', kind: 'star', name: 'Sirius', positionPc: […], absMag: 1.45…, colorIndexBV: 0.009 }`;
  `nearestStarIndex(0, 0, 0)` → index of Sol.

## Constraints & Forbidden Actions

- Do not modify `core-types` or `tools/pack-stars`.
- Allowed dependencies: `@cosmos/core-types` only. **No Three.js, no React, no DOM**
  beyond `fetch` (injectable). No Zod at runtime (§5.7 — validation was build-time;
  runtime checks are cheap structural guards + the hash check).
- Spatial index (fixed design — do not improvise): uniform grid hash, cell size
  25 pc, `Map<number, Uint32Array>` keyed by packed cell coords, built once at load.
  `queryRegion` walks overlapping cells; `nearestStarIndex` searches expanding cell
  rings and may early-out once the best distance is smaller than the remaining ring
  distance. Scratch state module-scoped (allocation-free per call).
- `getByIndex`/`getBody` may allocate (selection-time, not per-frame); `search` may
  allocate; `nearestStarIndex` may NOT.
- SHA-256 via WebCrypto (`crypto.subtle`, available in Node ≥ 20 and browsers).

## Common Mistakes (architecture §5.7 — copy kept verbatim)

- Parsing CSV in the browser (this package only ever sees binary packs + small JSON
  manifests).
- Mixing units (parsecs for interstellar — keep units in names: `positionPc`).
- Loading entire Gaia subset eagerly — N/A here (one HYG pack IS the Phase 1 scope);
  do not add tiling/octree machinery speculatively (that is Phase 4).
- Ignoring missing-data flags — `hipIds[i] === 0` means "no HIP number"; never
  resolve "hip 0".

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/data test`:
   - `loadStarPack` round-trip on the fixture pack: counts, ids, names, absolute
     positions (originPc + relative within f32 tolerance) all match the fixture CSV.
   - Version guard: manifest with `packFormatVersion: 2` rejects with
     `PackFormatError`; corrupted bin (flip one byte) rejects via hash mismatch.
   - `search`: 'sirius', 'SIRI', and 'hip <sirius hip>' all return Sirius first;
     unnamed stars never match by name; `maxResults` respected.
   - Search timing: build a synthetic 120k-name source and assert
     `search('sirius')` < 50 ms (generous CI margin; seeded PRNG for names).
   - `queryRegion`: results equal brute-force scan on the fixture (property test over
     ≥ 200 seeded random AABBs); `maxCount` respected.
   - `nearestStarIndex`: equals brute-force nearest on the fixture for ≥ 1000 seeded
     random probes; zero allocations (same-identity scratch check as TASK-003).
2. **Coverage gate:** statement coverage ≥ 90% on `packages/data/src`.
3. `pnpm verify` exits 0 (boundary lint: imports `@cosmos/core-types` only).

## Deliverables

- `packages/data/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/data/src/load.ts`, `src/source.ts`, `src/grid.ts`, `src/index.ts`
- `packages/data/test/load.test.ts`, `test/source.test.ts`, `test/grid.test.ts`
- `packages/data/README.md` (< 150 lines; documents the main-thread-decode TODO)

## Context Files

- `docs/architecture.md` §5.7 (whole section), §5.12 (search criterion), §11
- `packages/core-types/src/packs.ts`, `src/batches.ts`, `src/bodies.ts`
- `tools/pack-stars/README.md` + its fixture (from TASK-008)
