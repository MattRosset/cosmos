# Task: `tools/pack-octree` — catalog → Morton-keyed octree tiles + manifest

**ID:** TASK-034
**Target package:** `tools/pack-octree` (new) + committed sample pack in `apps/web/public/`
**Size:** M
**Phase:** 3 — lane (data tools; the second of the two chunk producers `streaming` needs)
**Depends on:** TASK-031

## Goal

A reproducible Node build script that performs the build-time spatial tiling of
architecture §5.7: read a star catalog (the existing HYG `.bin` pack as the Phase 3
input — Gaia DR3 is Phase 4, but the format and tooling land now), build a
Morton-keyed linear octree per ADR-003, and emit `.bin` tiles (≤ 512 KB each) +
a JSON `OctreeManifest`. Output is committed; the browser only ever sees the binary
tiles + the manifest (§5.7 "the browser only ever sees binary packs + small JSON
manifests"). The pack is byte-reproducible.

## Frozen Interface

Consumes (do not modify): `OctreeManifest`, `OctreeTileManifest`, `OctreeTileBuffers`,
`OctreeCell`, `MortonKey`, `encodeMortonKey`, `decodeMortonKey`, `childCell`,
`OCTREE_FORMAT_VERSION`, `MAX_OCTREE_LEVEL`, `MAX_POINTS_PER_TILE`, `MAX_TILE_BYTES`,
`INTERNAL_TILE_POINTS`, `BufferSlice`, `StarPackManifest` from `@cosmos/core-types`.

CLI contract:

```
pnpm --filter @cosmos/pack-octree build -- \
  --in apps/web/public/packs/manifest.json \
  --out apps/web/public/packs/octree \
  --root-half-extent 65536 \
  --source hyg-v41-octree
```

Reads the input star pack (manifest + .bin), writes
`apps/web/public/packs/octree/octree.json` (the `OctreeManifest`) and
`apps/web/public/packs/octree/tiles/<level>_<morton>.bin` per node.

## Fixed semantics (transcribe, don't redesign — ADR-003)

- **Root cube** (ADR-003 §1): centered on the context origin (`[0,0,0]`, galaxy
  parsecs), half-extent = `--root-half-extent` (default 65536, must be a power of
  two — fail otherwise). `context: 'galaxy'`.
- **Insertion + split** (ADR-003 §3): insert every input star (absolute galaxy-frame
  parsecs = `originPc + relative`) into the root; **split** a node into 8 children
  (Morton child order, ADR-003 §2) when its point count would exceed
  `MAX_POINTS_PER_TILE` OR its encoded payload would exceed `MAX_TILE_BYTES`,
  whichever binds first, capped at `MAX_OCTREE_LEVEL` (a node at the cap keeps all
  its points even if over budget — document this terminal case).
- **Leaf vs internal payload** (ADR-003 §3): leaves carry all their points; internal
  nodes carry a **deterministic decimated subset** — the brightest
  `INTERNAL_TILE_POINTS` by ascending `absMag` (ties broken by ascending
  `catalogId`, so it is stable and re-pack-identical). This is what lets a node draw
  at coarse LOD before children load.
- **Tile .bin layout** (ADR-003 §3): identical attribute layout/order to
  `StarPackManifest.buffers` — positionsPc (3×count f32, **relative to the node
  center**), absMag (count f32), colorIndexBV (count f32), catalogIds (count u32),
  hipIds (count u32); little-endian, every slice 4-byte aligned. `idPrefix` from
  `--source`'s catalog (carry through the input pack's `catalogIds`/`hipIds`; the
  manifest `idPrefix` = the INPUT pack's idPrefix so `BodyId`s round-trip to the
  same star records).
- **Manifest** (ADR-003 §4): `octreeFormatVersion`, `source`, `context`,
  `rootHalfExtentUnits`, `idPrefix`, and `tiles[]` with `key`, `isLeaf`,
  `childMask`, `pointCount`, `centerUnits`, `halfExtentUnits`, `binUrl`,
  `contentHashSha256`, `buffers`. Tiles listed root-first.
- **Reproducible:** stable key order, no timestamps; `contentHashSha256` is the
  lowercase hex SHA-256 of each tile .bin. Same input + same flags ⇒ byte-identical
  manifest and tiles.

## Inputs / Outputs

- **Inputs:** the committed HYG pack (`apps/web/public/packs/manifest.json` + .bin,
  from TASK-008). A tiny fixture pack lives in `test/fixtures/` for unit tests.
- **Outputs:** `apps/web/public/packs/octree/octree.json` + `tiles/*.bin`. With HYG
  (~120k stars) and the default split thresholds the tree is shallow (a handful of
  levels); total committed payload is small. Every tile `.bin` ≤ `MAX_TILE_BYTES`.

## Constraints & Forbidden Actions

- Do not modify any `packages/*` source. Allowed dependencies (this tools package
  only): `zod`, `tsx` (dev), `@cosmos/core-types`. Node ≥ 22 built-ins
  (`node:crypto` for SHA-256, `node:fs`) for everything else.
- Validate the emitted manifest with a Zod schema mirroring `OctreeManifest`
  (`octreeFormatVersion` literal; every tile `.bin` ≤ `MAX_TILE_BYTES`; childMask
  consistent with `isLeaf`; positions within the node cube) — fail loudly.
- No `Math.random()`; no network access in the build.
- Do NOT compute visibility/LOD here — the packer is geometry-only; LOD selection is
  `streaming`'s job (§5.8). Do NOT change the input star pack.

## Common Mistakes (architecture §5.7 — copy kept verbatim)

- Parsing CSV in the browser (do all conversion at build time; the browser only ever
  sees binary packs + small JSON manifests) — here: the octree is built offline; the
  browser fetches tiles + manifest only.
- Mixing units — tile positions are galaxy-context parsecs RELATIVE to the node
  center; never absolute f32 (ADR-003 §3 / §5.2).
- Loading entire Gaia subset eagerly — n/a at build time, but the WHOLE POINT of
  this tool is to make on-demand loading possible; keep tiles ≤ 512 KB.
- Ignoring missing-data flags in real catalogs — carry `hipIds` (0 = none) through
  unchanged; do not synthesize ids.
- Plus: a non-stable decimation tie-break (would change content hashes between
  builds — sort by `(absMag, catalogId)` exactly); forgetting a node at
  `MAX_OCTREE_LEVEL` may legally exceed the point budget (terminal leaf).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/pack-octree test` — `test/pack-octree.test.ts`
   (fixture-driven):
   - **Determinism:** two builds of the fixture pack ⇒ byte-identical `octree.json`
     and every tile `.bin` (compare SHA-256).
   - **Tiling correctness:** every input star appears in exactly one LEAF tile;
     reconstructing absolute positions (`centerUnits + relative`) matches the input
     within f32 epsilon; no leaf exceeds `MAX_POINTS_PER_TILE` unless it is at
     `MAX_OCTREE_LEVEL`; no tile `.bin` exceeds `MAX_TILE_BYTES`.
   - **Morton/keys:** every tile `key` round-trips via `decodeMortonKey`; child
     keys derive from parents via `childCell`; `childMask` bits exactly match the
     children present; manifest is root-first.
   - **Internal decimation:** an internal node carries exactly
     `min(INTERNAL_TILE_POINTS, subtree point count)` points, and they are the
     brightest by `(absMag, catalogId)` — assert against a brute-force selection.
   - **Schema/version:** the emitted manifest validates against the Zod schema;
     `octreeFormatVersion === OCTREE_FORMAT_VERSION`; a hand-corrupted tile size
     fails validation.
   - **Hashes:** each tile's `contentHashSha256` equals the SHA-256 of its `.bin`.
2. Sample octree built from the committed HYG pack and committed under
   `apps/web/public/packs/octree/`; `octree.json` parses; total payload reported in
   the PR.
3. `ATTRIBUTIONS.md` unchanged (octree is derived from HYG, already attributed) —
   verify no new external data was introduced.
4. `pnpm verify` exits 0.

## Deliverables

- `tools/pack-octree/package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`
  (build procedure; how the sample pack was generated)
- `tools/pack-octree/src/build.ts` (octree build, pure & exported),
  `src/encode.ts` (tile .bin packing), `src/schema.ts` (Zod), `src/cli.ts`
- `tools/pack-octree/test/pack-octree.test.ts`,
  `tools/pack-octree/test/fixtures/` (tiny input pack)
- `apps/web/public/packs/octree/octree.json`,
  `apps/web/public/packs/octree/tiles/*.bin` (built, committed)

## Context Files

- `docs/architecture.md` §5.7 (data pipeline + tiling), §11 (versioning, hashing)
- `docs/decisions/ADR-003-octree-tiling.md` (entire — normative)
- `packages/core-types/src/octree.ts`, `src/packs.ts` (manifest layouts to match)
- `tools/pack-stars/` (tool-package layout, determinism + content-hash patterns to
  copy), `tools/pack-solar/` (Zod-validated reproducible-pack patterns)
