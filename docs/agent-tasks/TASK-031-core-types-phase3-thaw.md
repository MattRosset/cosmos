# Task: `core-types` Phase-3 thaw — galaxy procgen, octree, chunk lifecycle, quality tiers, worker RPC

**ID:** TASK-031
**Target package:** `packages/core-types`
**Size:** S
**Phase:** 3
**Depends on:** TASK-030

## Goal

The one sanctioned Phase-2→3 API thaw (architecture §16) for `core-types`: add every
data contract the Phase 3 lanes build against, and nothing else. Per architecture §7
("never build a renderer before its data contract exists in `core-types`") this task
unblocks all Phase 3 lanes and must land first. It adds: the galaxy procedural-generation
params (`procgen.ts`, ADR-004 §1/§5); the octree tile manifest + Morton-key conventions
(`octree.ts`, ADR-003); the chunk-lifecycle event record (`streaming.ts`,
`ChunkLifecycleEvent` request|ready|evict); the `universe` scale-context constants
(`universe.ts`); the adaptive quality-tier types (`quality.ts`, §9); and the worker RPC
contract types (`worker-rpc.ts`, §5.13). After it merges, `core-types` is frozen again
until the Phase 3→4 thaw.

**This task may not begin until TASK-030 is `done`** (the Phase 2 gate freezes the
Phase 2 surfaces; this is the next sanctioned change window).

## Frozen Interface

```ts
// ── src/octree.ts (new) — ADR-003 ────────────────────────────────────────────
export const OCTREE_FORMAT_VERSION = 1;
/** ADR-003 §2: level cap (≤ 21 by Morton width; Phase 3 caps lower). */
export const MAX_OCTREE_LEVEL = 16;
/** ADR-003 §3: split thresholds (whichever binds first). */
export const MAX_POINTS_PER_TILE = 32768;
export const MAX_TILE_BYTES = 512 * 1024;
/** ADR-003 §3: decimated representative point count on internal tiles. */
export const INTERNAL_TILE_POINTS = 4096;

/** ADR-003 §2: node id as "<level>/<mortonDecimal>", e.g. "3/427". */
export type MortonKey = string;

/** Cell indices from the root cube's MIN corner, ix,iy,iz ∈ [0, 2^level). */
export interface OctreeCell {
  readonly level: number;
  readonly ix: number;
  readonly iy: number;
  readonly iz: number;
}

/** Interleave (x = LSB of each triplet) → "<level>/<bigint decimal>". Pure. */
export function encodeMortonKey(cell: OctreeCell): MortonKey;
/** Inverse of encodeMortonKey. Throws RangeError on malformed input. */
export function decodeMortonKey(key: MortonKey): OctreeCell;
/** ADR-003 §2 child order: c∈[0,7], ix'=ix*2+(c&1), iy'=iy*2+((c>>1)&1),
 *  iz'=iz*2+((c>>2)&1). Throws if cell.level >= MAX_OCTREE_LEVEL. */
export function childCell(cell: OctreeCell, child: number): OctreeCell;
/** Parent cell (level-1). Throws RangeError if cell.level === 0. */
export function parentCell(cell: OctreeCell): OctreeCell;

/** Reuses the same attribute layout as StarPackManifest.buffers (ADR-003 §3). */
export interface OctreeTileBuffers {
  /** Float32Array, 3 × pointCount, context units RELATIVE to the node center. */
  readonly positionsPc: BufferSlice;
  /** Float32Array, pointCount — absolute visual magnitude. */
  readonly absMag: BufferSlice;
  /** Float32Array, pointCount — B–V color index. */
  readonly colorIndexBV: BufferSlice;
  /** Uint32Array, pointCount — source-catalog id. */
  readonly catalogIds: BufferSlice;
  /** Uint32Array, pointCount — Hipparcos number, 0 = none. */
  readonly hipIds: BufferSlice;
}

export interface OctreeTileManifest {
  readonly key: MortonKey;
  readonly isLeaf: boolean;
  /** ADR-003 §4: bit c set ⇒ child c exists. 0 on leaves. */
  readonly childMask: number;
  readonly pointCount: number;
  /** Node cube center, CONTEXT UNITS (galaxy ⇒ parsecs), f64. */
  readonly centerUnits: readonly [number, number, number];
  /** Half side length of the node cube, context units, f64. */
  readonly halfExtentUnits: number;
  /** URL relative to the octree manifest's location. */
  readonly binUrl: string;
  /** Lowercase hex SHA-256 of this tile's .bin (reproducible builds, §11). */
  readonly contentHashSha256: string;
  readonly buffers: OctreeTileBuffers;
}

export interface OctreeManifest {
  readonly octreeFormatVersion: typeof OCTREE_FORMAT_VERSION;
  /** Source catalog tag, e.g. "gaia-dr3-bright". */
  readonly source: string;
  /** Context the tree lives in (Phase 3: 'galaxy'). */
  readonly context: ContextId;
  /** ADR-003 §1: root cube half-extent, context units (power of two). */
  readonly rootHalfExtentUnits: number;
  /** BodyId of point i in any tile = `${idPrefix}:${catalogIds[i]}`. */
  readonly idPrefix: string;
  /** Every node in the tree (root first), keyed by MortonKey for the loader. */
  readonly tiles: readonly OctreeTileManifest[];
}

// ── src/procgen.ts (new) — ADR-004 ───────────────────────────────────────────
/** ADR-004 §1: galaxy generation params. Every field optional ⇒ default applied
 *  from PROCGEN_GALAXY_DEFAULTS; `starCount` and `seed` are required. */
export interface GalaxyGenParams {
  readonly seed: number;
  readonly starCount: number;
  readonly discRadiusPc?: number;
  readonly discScaleLengthPc?: number;
  readonly discScaleHeightPc?: number;
  readonly armCount?: number;
  readonly armPitchRad?: number;
  readonly armWindings?: number;
  readonly armWidthPc?: number;
  readonly armContrast?: number;
  readonly bulgeFraction?: number;
  readonly bulgeRadiusPc?: number;
}

/** ADR-004 §1: the fixed default table (single source of truth). */
export const PROCGEN_GALAXY_DEFAULTS: Required<Omit<GalaxyGenParams, 'seed' | 'starCount'>>;

/** ADR-004 §5: fixed PRNG fork stream ids. */
export const PROCGEN_STREAM_PLACEMENT = 0;
export const PROCGEN_STREAM_MASS = 1;
export const PROCGEN_STREAM_JITTER = 2;

// ── src/streaming.ts (new) — §5.8 ────────────────────────────────────────────
export type ChunkKind = 'octree' | 'procgen';
export type ChunkLifecyclePhase = 'request' | 'ready' | 'evict';

/** §5.8: the streamer's output event. `request` carries no buffers; `ready`
 *  carries the decoded StarBatch; `evict` carries neither. */
export interface ChunkLifecycleEvent {
  readonly phase: ChunkLifecyclePhase;
  readonly kind: ChunkKind;
  /** Stable id: octree ⇒ the MortonKey; procgen ⇒ `gal<seed>:sec<sectorId>`. */
  readonly chunkId: string;
  /** Discrete LOD level (octree: node level; procgen: requested LOD). */
  readonly lod: number;
  /** Present only on `phase: 'ready'`; null otherwise. */
  readonly batch: StarBatch | null;
}

// ── src/quality.ts (new) — §9 ────────────────────────────────────────────────
/** §9 adaptive tiers — names are ordered best→worst. */
export type QualityTier = 'high' | 'medium' | 'low';

/** §9 degradation order: point count → bloom → atmosphere → resolution scale.
 *  One settings record per tier (consumed by scene-host, TASK-039). */
export interface QualitySettings {
  readonly tier: QualityTier;
  /** Hard cap on rendered points across all batches (§9 ≤ 2e6 at 'high'). */
  readonly maxRenderedPoints: number;
  readonly bloomEnabled: boolean;
  readonly atmosphereEnabled: boolean;
  /** Renderer pixel-ratio multiplier in (0,1], 1 = native. */
  readonly resolutionScale: number;
}

/** §9 fixed tier table (single source of truth; TASK-039 consumes it). */
export const QUALITY_TIERS: Record<QualityTier, QualitySettings>;

// ── src/worker-rpc.ts (new) — §5.13 ──────────────────────────────────────────
/** §5.13 worker request envelope. `id` correlates request↔response; `token`
 *  is the cancellation token id (see cancel). */
export interface WorkerRequest<TMethod extends string, TParams> {
  readonly id: number;
  readonly method: TMethod;
  readonly params: TParams;
  readonly token: number;
}

export type WorkerResponse<TResult> =
  | { readonly id: number; readonly ok: true; readonly result: TResult }
  | { readonly id: number; readonly ok: false; readonly error: WorkerErrorPayload }
  | { readonly id: number; readonly cancelled: true };

/** §5.13 structured error propagation (no raw Error objects cross the boundary). */
export interface WorkerErrorPayload {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/** The two Phase-3 worker methods (the contract `workers` + `procgen`/`data` share). */
export interface ProcgenGalaxyRequest {
  readonly params: GalaxyGenParams;
}
/** Decode one octree tile .bin (already fetched) into a StarBatch. */
export interface OctreeDecodeRequest {
  readonly tile: OctreeTileManifest;
  readonly idPrefix: string;
  /** The fetched tile .bin as a transferable ArrayBuffer. */
  readonly bin: ArrayBuffer;
}
```

`src/octree.ts`, `src/procgen.ts`, and `src/worker-rpc.ts` import only existing
sibling modules: `BufferSlice` from `./packs`, `ContextId` from `./coords`,
`StarBatch` from `./batches`. `src/index.ts` re-exports all new modules (extend the
existing re-export list).

## Inputs / Outputs

- **Inputs:** none (zero-dependency package by definition, §4).
- **Outputs:** types + constants. Example octree tile manifest entry:
  `{ key: '0/0', isLeaf: false, childMask: 255, pointCount: 4096, centerUnits: [0,0,0], halfExtentUnits: 65536, binUrl: 'tiles/0_0.bin', contentHashSha256: '…', buffers: { positionsPc: {byteOffset:0,byteLength:49152}, … } }`.
  Example lifecycle event:
  `{ phase: 'ready', kind: 'octree', chunkId: '3/427', lod: 3, batch: {…StarBatch…} }`.

## Constraints & Forbidden Actions

- Do not modify any existing `src/*.ts` except `src/index.ts` (re-exports only).
  In particular `bodies.ts`, `coords.ts`, `batches.ts`, `packs.ts`, `orbits.ts`,
  `systems.ts`, `bookmarks.ts`, `frames.ts`, `prng.ts`, and `events.ts` stay
  byte-identical; all existing tests pass unmodified.
- **No new events** in `events.ts`. The streamer's output is the
  `ChunkLifecycleEvent` *record* (consumed via a typed registry in `streaming`,
  §5.8), NOT a new `CosmosEventMap` entry. Adding a `CosmosEventMap` key is a
  separate reviewed task.
- Zero dependencies; no Zod here (validation is pack-build-time in `tools/`, §5.7).
- Plain readonly interfaces; no classes. `octree.ts` may contain the
  encode/decode/child/parent *pure functions* (like `prng.ts`/`frames.ts` carry
  code) but no general spatial library — only the four key helpers above.
- Morton encode/decode use `BigInt` for the interleave (ADR-003 §2): the
  `mortonDecimal` part is the BigInt's base-10 string. Do NOT use `number` for the
  interleaved code (overflows 2^53 above level 10).
- Do not add speculative fields (terrain heightfields, atmosphere LUTs, WebGPU
  types — out of Phase 3 scope).

## Common Mistakes (architecture §5.2, §5.7, §5.8, §5.13)

- Storing absolute positions in f32 anywhere (including GPU buffers — star buffers
  must be context-local). Octree tile positions are RELATIVE to the node center,
  same rule as star packs.
- Loading entire Gaia subset eagerly — must be tiled (the manifest enumerates nodes;
  the loader fetches tiles on demand, TASK-035).
- LOD popping with no hysteresis — n/a in this types-only task; the `lod` field is a
  discrete level the consumer applies hysteresis to (TASK-038).
- Cloning instead of transferring buffers — the `OctreeDecodeRequest.bin` and any
  result buffers are `ArrayBuffer`s meant to be transferred (asserted in TASK-032);
  the type carries a plain `ArrayBuffer` precisely so it is transferable.
- Mixing units — units stay in names (`halfExtentUnits`, `centerUnits`,
  `*Pc`, `rootHalfExtentUnits`).
- Morton bit order ambiguity — x is the least-significant bit of each interleave
  triplet (ADR-003 §2); a transposed order silently corrupts spatial locality.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/core-types test` — new `test/octree.test.ts`,
   `test/procgen-types.test.ts`, `test/streaming-types.test.ts`:
   - Constants: `OCTREE_FORMAT_VERSION === 1`, `MAX_OCTREE_LEVEL === 16`,
     `MAX_POINTS_PER_TILE === 32768`, `MAX_TILE_BYTES === 524288`,
     `INTERNAL_TILE_POINTS === 4096`.
   - Morton round-trip: for 1000 seeded random cells with `level ∈ [0,16]` and
     valid indices, `decodeMortonKey(encodeMortonKey(c))` deep-equals `c`.
   - Morton ordering: `childCell({level:0,ix:0,iy:0,iz:0}, c)` for c∈[0,7] yields
     the 8 unit cells with `(ix,iy,iz)` exactly the bits `(c&1, (c>>1)&1, (c>>2)&1)`;
     `parentCell(childCell(c, k))` deep-equals `c`; `parentCell` at level 0 throws;
     `childCell` at `MAX_OCTREE_LEVEL` throws.
   - Above-2^53 keys: a level-12 cell with large indices encodes to a decimal string
     whose BigInt value `> Number.MAX_SAFE_INTEGER`, and still round-trips.
   - Compile-time shape checks (`// @ts-expect-error`): a `ChunkLifecycleEvent` with
     `phase: 'ready'` requires a `batch`; `OctreeManifest` with the wrong
     `octreeFormatVersion` literal fails; mutating any readonly field fails;
     `WorkerResponse` discriminates on `ok`/`cancelled`.
   - `PROCGEN_GALAXY_DEFAULTS` exact values match ADR-004 §1 (assert each field);
     `QUALITY_TIERS.high.maxRenderedPoints === 2_000_000`,
     `QUALITY_TIERS.low.bloomEnabled === false`,
     tiers ordered so `high ≥ medium ≥ low` on `maxRenderedPoints` and
     `resolutionScale`.
2. All existing `core-types` test suites pass unmodified.
3. `pnpm verify` exits 0 (boundary lint: package still imports nothing).

## Deliverables

- `packages/core-types/src/octree.ts`, `src/procgen.ts`, `src/streaming.ts`,
  `src/quality.ts`, `src/worker-rpc.ts`
  (**No `src/universe.ts`.** Architecture §6 lists a "`universe` context" Phase 3
  deliverable; the `universe` scale context, its unit
  `CONTEXT_UNIT_METERS.universe = 3.0857e22`, and the full four-level frame chain
  ALREADY exist in `coords.ts` — frozen at Phase 0. The §6 line is satisfied by the
  `nav`/`coords` integration in TASK-037, not by a new core-type. Do NOT create
  `src/universe.ts` or add universe-context constants here.)
- `packages/core-types/src/index.ts` (re-exports only)
- `packages/core-types/test/octree.test.ts`, `test/procgen-types.test.ts`,
  `test/streaming-types.test.ts`

## Context Files

- `docs/architecture.md` §5.6 (procgen), §5.7 (data/tiling), §5.8 (streaming),
  §5.13 (workers), §9 (quality tiers), §16 (thaw window)
- `docs/decisions/ADR-003-octree-tiling.md`, `docs/decisions/ADR-004-galaxy-density-wave.md`
- `packages/core-types/src/packs.ts` (`BufferSlice`, `StarPackManifest` layout to
  mirror), `src/batches.ts` (`StarBatch`), `src/coords.ts` (`ContextId`,
  `CONTEXT_UNIT_METERS`), `src/prng.ts` + `src/frames.ts` (code-carrying module
  style to match)
