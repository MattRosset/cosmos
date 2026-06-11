# Task: `core-types` Phase-1 thaw — star-pack manifest + renderer batch contract

**ID:** TASK-007
**Target package:** `packages/core-types`
**Size:** S
**Phase:** 1
**Depends on:** TASK-006

## Goal

The one sanctioned Phase-boundary API thaw (architecture §16) for `core-types`: add the
data contracts that Phase 1 lanes build against — the star-pack binary format
(`packs.ts`) consumed by `tools/pack-stars` and `data`, and the renderer-facing
`StarBatch` (`batches.ts`) consumed by `render-stars`. Per §7, **no renderer may be
built before its data contract exists in `core-types`** — this task unblocks every
Phase 1 lane. After it merges, `core-types` is frozen again until the Phase 1→2 thaw.

## Frozen Interface

```ts
// ── src/packs.ts ────────────────────────────────────────────────────────────
/** Byte range of one attribute inside a pack's single .bin file. */
export interface BufferSlice {
  readonly byteOffset: number;
  readonly byteLength: number;
}

export const STAR_PACK_FORMAT_VERSION = 1;

/**
 * Manifest of a packed star catalog tile (architecture §5.7, §11). The .bin is
 * little-endian; every slice is 4-byte aligned. Loaders MUST reject manifests
 * whose packFormatVersion differs (§11).
 */
export interface StarPackManifest {
  readonly packFormatVersion: typeof STAR_PACK_FORMAT_VERSION;
  /** Source catalog tag, e.g. "hyg-v41". */
  readonly source: string;
  /** Lowercase hex SHA-256 of the .bin (reproducible builds, §11). */
  readonly contentHashSha256: string;
  readonly count: number;
  /** URLs relative to the manifest's own location. */
  readonly binUrl: string;
  readonly namesUrl: string;
  /**
   * Tile origin in galaxy-context parsecs, f64. Star positions in the .bin are
   * RELATIVE to this origin (context-local GPU buffers, §5.2 / ADR-001).
   * Phase 1 convention: galaxy-context origin = the Sun, axes = galactic
   * (x → galactic center, z → north galactic pole); originPc = [0,0,0].
   */
  readonly originPc: readonly [number, number, number];
  readonly buffers: {
    /** Float32Array, 3 × count, parsecs relative to originPc. */
    readonly positionsPc: BufferSlice;
    /** Float32Array, count — absolute visual magnitude. */
    readonly absMag: BufferSlice;
    /** Float32Array, count — B–V color index. */
    readonly colorIndexBV: BufferSlice;
    /** Uint32Array, count — source-catalog id (HYG `id` column). */
    readonly catalogIds: BufferSlice;
    /** Uint32Array, count — Hipparcos number, 0 = none. */
    readonly hipIds: BufferSlice;
  };
}

// ── src/batches.ts ──────────────────────────────────────────────────────────
/**
 * Renderer-facing star tile (§5.9 input contract). Positions are tile-local
 * f32 — NEVER absolute (§5.2). The renderer receives the tile's camera-relative
 * offset separately, per frame, computed by `coords`.
 */
export interface StarBatch {
  readonly count: number;
  /** Tile origin, galaxy-context parsecs, f64. */
  readonly originPc: readonly [number, number, number];
  /** 3 × count, parsecs relative to originPc. */
  readonly positionsPc: Float32Array;
  readonly absMag: Float32Array;
  readonly colorIndexBV: Float32Array;
  readonly catalogIds: Uint32Array;
  readonly hipIds: Uint32Array;
  /** BodyId of star i = `${idPrefix}:${catalogIds[i]}`, e.g. "hyg:32263". */
  readonly idPrefix: string;
}
```

`src/index.ts` re-exports all of the above (extend the existing re-export list).

## Inputs / Outputs

- **Inputs:** none (zero-dependency package by definition, §4).
- **Outputs:** types + the version constant. Example manifest fixture for downstream
  tests:
  `{ packFormatVersion: 1, source: 'hyg-v41', contentHashSha256: 'ab…', count: 3, binUrl: 'stars.abcd1234.bin', namesUrl: 'names.json', originPc: [0,0,0], buffers: { positionsPc: { byteOffset: 0, byteLength: 36 }, … } }`

## Constraints & Forbidden Actions

- Do not modify `src/coords.ts`, `src/prng.ts`, `src/bodies.ts`, `src/orbits.ts`, or
  `src/events.ts` — **no new events** (selection/changed already exists and is what
  Phase 1 uses). New events = a new reviewed task.
- Zero dependencies; no Zod here (validation is pack-build-time in `tools/`, §5.7).
- Plain readonly interfaces; no classes (§1.4).
- Do not add speculative fields (e.g., octree/tiling metadata — that is Phase 4).

## Common Mistakes (architecture §5.2, §5.7)

- Storing absolute positions in f32 anywhere — that is why `positionsPc` is documented
  as origin-relative and `originPc` is f64; keep those docs verbatim.
- Mixing units — units stay in names (`positionsPc`, `absMag`, `colorIndexBV`).
- Loaders accepting unknown `packFormatVersion` — the constant exists so `data` can
  reject mismatches (§11); document it.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/core-types test` — new `test/packs.test.ts`:
   compile-time shape checks (valid manifest literal typechecks; wrong
   `packFormatVersion`, missing buffer slice, and mutating a readonly field each fail
   via `// @ts-expect-error`); `STAR_PACK_FORMAT_VERSION === 1`.
2. Existing `test/events.test.ts` and `test/prng.test.ts` pass unmodified.
3. `pnpm verify` exits 0 (boundary lint: package still imports nothing).

## Deliverables

- `packages/core-types/src/packs.ts`
- `packages/core-types/src/batches.ts`
- `packages/core-types/src/index.ts` (re-exports only)
- `packages/core-types/test/packs.test.ts`

## Context Files

- `docs/architecture.md` §5.7 (data layer), §5.9 (renderer inputs), §7, §11
- `docs/decisions/ADR-001-coordinates.md` (context-local buffer rule)
- `packages/core-types/src/bodies.ts`, `src/coords.ts` (existing style to match)
