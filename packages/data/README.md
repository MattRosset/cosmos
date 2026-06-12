# @cosmos/data

Loads a star pack (manifest + bin + names) and exposes the uniform body API over it:
record lookup, name search, AABB region queries, and an allocation-free nearest-star query.

Pure TypeScript — runs identically in Node tests and the browser. No Three.js, no React,
no DOM beyond injectable `fetch`.

## Usage

```ts
import { loadStarPack } from '@cosmos/data';

const src = await loadStarPack('/packs/manifest.json');

// Lookup by BodyId
const sirius = src.getBody('hyg:2');

// Name search (prefix matches ranked first, then by brightness)
const results = src.search('sirius', 5);

// AABB region query (absolute galaxy-frame parsecs)
const indices = src.queryRegion([-10, -10, -10], [10, 10, 10], 1000);

// Nearest star (zero allocations — called every frame by nav's speed law)
const nearestIdx = src.nearestStarIndex(0, 0, 0);
```

## API

### `loadStarPack(manifestUrl, opts?): Promise<StarDataSource>`

Fetches and validates a pack. Throws `PackFormatError` when:
- `manifest.packFormatVersion` differs from `STAR_PACK_FORMAT_VERSION` (§11)
- A buffer slice falls outside the bin
- The bin's SHA-256 mismatches the manifest

`opts.fetchImpl` lets you inject a custom `fetch` (e.g. `readFileSync`-backed for Node tests).

### `StarDataSource`

| Method | Notes |
|---|---|
| `batch` | Full `StarBatch` for the renderer (tile-local f32 positions) |
| `getBody(id)` | By `BodyId` (`"hyg:N"`); absolute `positionPc` (f64) |
| `getByIndex(i)` | By batch index; absolute `positionPc` |
| `search(query, max?)` | Case-insensitive substring; `"hip N"` resolves HIP numbers |
| `queryRegion(min, max, cap)` | AABB in absolute galaxy-frame pc; returns indices |
| `nearestStarIndex(x, y, z)` | Absolute galaxy-frame pc; **zero allocations** |

## Spatial index

A uniform grid hash with 25 pc cell size (`Map<number, Uint32Array>`), built once at load.
`queryRegion` walks overlapping cells; `nearestStarIndex` searches expanding cell rings with
an early-out once the best distance is smaller than the nearest ring's minimum distance.

## Systems packs (Phase 2)

### `loadSystemsPack(manifestUrl, opts?): Promise<SystemsSource>`

Fetches and validates a `SystemsPackManifest` JSON file. Throws `SystemsPackFormatError` when:
- `manifest.packFormatVersion` differs from `SYSTEMS_PACK_FORMAT_VERSION` (§11)
- A planet body has `elements.eccentricity ≥ 1` (non-bound orbit)

### `SystemsSource`

| Member | Notes |
|---|---|
| `systems` | All `StarSystemRecord` objects in the pack |
| `getSystem(id)` | By system id (`"sol"`, `"exo:trappist-1"`) |
| `getBody(id)` | Host star (by star id) or planet (by body id) |
| `systemOfBody(id)` | System for any host or planet id |

### `createCombinedSource(stars, systems): CombinedSource`

Merges a HYG `StarDataSource` with one or more `SystemsSource` arrays into a single body
namespace. Performs host deduplication: a pack host whose name case-insensitively matches a
named HYG star resolves to that HYG record (the HYG position is authoritative).

| Member | Notes |
|---|---|
| `getBody(id)` | Star, host, or planet — one namespace; `"exoidx:i"` resolves via batch |
| `search(query, max?)` | Ranked: exact → prefix → substring; stars by absMag, planets alpha |
| `extraHostBatch` | `StarBatch` (`idPrefix "exoidx"`) of unresolved hosts; `null` if all resolved |
| `hostIdByIndex` | Maps `extraHostBatch` index → pack host `BodyId` |
| `canonicalId(id)` | `"exoidx:i"` or pack host id → canonical record id |
| `nearestHostSystem(x,y,z)` | Nearest host by galaxy-frame parsecs; ≤ 10 Hz, allocates |
| `hostPositionPc(systemId)` | HYG position if deduped, pack position otherwise |

## Phase 1 simplification

Decoding happens on the **main thread at load time** (one HYG pack, < 100 ms).
The `worker-data` offload is deferred to the `workers` package in Phase 3.
<!-- TODO(§5.13): move decode + grid build into a dedicated worker pool -->
