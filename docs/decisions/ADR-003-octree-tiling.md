# ADR-003: Octree Tiling & Morton-Key Scheme for Streamed Catalogs

**Status:** Accepted
**Date:** 2026-06-15
**Refines:** architecture §5.7 (octree of `.bin` tiles, ≤ 512 KB each), §5.8 (Morton-keyed linear octree)

## Context

Phase 3 introduces spatially-streamed content: build-time octree tiles for large
catalogs (Gaia in Phase 4, but the format and loader land now) and procedurally
generated galaxy chunks. Architecture §5.7 fixes the *envelope* ("octree of `.bin`
tiles ≤ 512 KB each") and §5.8 fixes the *keying family* ("linear octree keyed by
Morton codes per scale context") but leaves the exact key encoding, root cube
extent, level cap, split policy, and tile payload undefined. `tools/pack-octree`
(producer), `data` v3 (loader), and `streaming` (consumer) must all agree on these
to the bit or they cannot interoperate. This ADR pins them once so the three tasks
can be written and executed independently against a frozen contract.

## Decision

### 1. Per-context, cube-rooted octree

One octree per scale context (`galaxy` first; the format is context-agnostic). The
root is an axis-aligned cube in that context's units (parsecs for `galaxy`),
centered on the context origin, with **half-extent `rootHalfExtentUnits`** declared
in the manifest. A node at level `L` (root = level 0) spans a cube of side
`2 × rootHalfExtentUnits / 2^L`. Galaxy-context Phase 3 default:
`rootHalfExtentUnits = 65536` pc (covers the Milky Way disc, ≈ 30 kpc radius, with
headroom; a power of two so cell sizes are exact f64).

### 2. Morton key (encoding is frozen)

A node is identified by `(level, ix, iy, iz)` where `ix, iy, iz ∈ [0, 2^level)` are
the cell indices along +x, +y, +z from the **min corner** of the root cube
(min corner = center − `rootHalfExtentUnits` on each axis). The **Morton code** is
the bit-interleave of `ix, iy, iz` (x = least-significant of each triplet), 21 bits
per axis maximum (so `level ≤ 21`; Phase 3 caps at `MAX_OCTREE_LEVEL = 16`). The
**MortonKey** stored and transmitted is a string `"<level>/<mortonDecimal>"`, e.g.
`"3/427"` — a string because Morton codes above level 10 exceed `Number.MAX_SAFE_INTEGER`
when interleaved across 3 axes, and JSON/Map keys must stay exact. Bit-interleave is
computed with the standard "magic number" spread on each axis as a `BigInt`
(level ≤ 16 ⇒ ≤ 48 bits) then `.toString(10)`. The decode is the inverse spread.
**Child enumeration order** is the canonical Morton order: child `c ∈ [0,7]` sets
`ix' = ix*2 + (c & 1)`, `iy' = iy*2 + ((c >> 1) & 1)`, `iz' = iz*2 + ((c >> 2) & 1)`.

### 3. Split policy & tile payload

A node is **split** (has children, no points of its own) when its catalog point
count would exceed `MAX_POINTS_PER_TILE = 32768` OR its encoded payload would exceed
`MAX_TILE_BYTES = 512 * 1024` (the §5.7 hard cap), whichever binds first. **Leaf**
tiles carry points; **internal** tiles carry a decimated representative subset
(brightest-N by absolute magnitude, `INTERNAL_TILE_POINTS = 4096`) so a node can be
drawn at coarse LOD before its children load. Each tile's `.bin` has the **same
attribute layout as `StarPackManifest.buffers`** (positionsPc / absMag /
colorIndexBV / catalogIds / hipIds), positions **relative to the tile node's center**
in context units, little-endian, every slice 4-byte aligned. Reusing the star-pack
layout means `render-stars` consumes octree tiles unmodified.

### 4. Manifest

The octree manifest is a single JSON file listing every node: its `MortonKey`,
`pointCount`, `isLeaf`, child presence bitmask (`childMask: 0–255`), the tile's
`binUrl` + per-attribute `BufferSlice`s + `contentHashSha256`, and the node center +
half-extent in context units (derivable from the key + root, but stored for loader
simplicity and validation). The manifest carries `octreeFormatVersion` (loaders
reject mismatches, §11) and the root parameters.

### 5. Screen-space-error LOD (consumer side)

`streaming` selects the cut of the tree to render by **screen-space error**:
a node is "good enough" when its projected node size in pixels ÷ its point spacing
is below a threshold; otherwise descend to children. Eviction is LRU on loaded
tiles, never evicting a node on the current cut or an ancestor of it (§5.8: never
evict the chunk the camera is inside). This ADR fixes the *format and keys*; the
exact SSE threshold and budget numbers live in `streaming` (TASK-038) and §9.

## Alternatives Considered

- **Numeric Morton codes (single `number`):** breaks past level 10 for 3-axis
  interleave (exceeds 2^53); rejected in favor of the `"level/decimal"` string.
- **k-d tree / BVH instead of octree:** §5.8 mandates a Morton-keyed linear octree;
  not re-litigated.
- **One giant tile streamed by HTTP range:** violates the ≤ 512 KB §5.7 cap and the
  cancel-stale-requests doctrine (§5.8); rejected.
- **Variable root extent per axis (AABB, not cube):** non-cube cells make Morton
  cell sizes anisotropic and SSE math axis-dependent; rejected for a cube root.

## Consequences

- `core-types` (TASK-031) owns `MortonKey`, the encode/decode helpers, the octree
  manifest/tile-manifest types, and the constants in §1–§4 above — one source of
  truth shared by producer, loader, and consumer.
- `tools/pack-octree` (TASK-034) is reproducible: same catalog + same root params →
  byte-identical tiles and manifest.
- `data` v3 (TASK-035) loads tiles on demand and rejects `octreeFormatVersion`
  mismatches; it never loads the whole tree eagerly (§5.7).
- `streaming` (TASK-038) must not be built before two chunk producers exist
  (octree tiles + procgen), per architecture §7.
- The internal-tile decimation rule (brightest-N) is deterministic and must match
  between packer and any future re-pack so content hashes stay stable.
