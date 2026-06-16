# @cosmos/pack-octree

Build-time spatial tiling of star catalogs into Morton-keyed octree tiles, per
architecture §5.7 and ADR-003.

## What it produces

- `octree.json` — `OctreeManifest`: lists every node in the tree (root first),
  with Morton key, child-presence bitmask, point count, tile URL, SHA-256 hash,
  and per-attribute buffer slices.
- `tiles/<level>_<mortonDecimal>.bin` — one `.bin` per node, same binary layout
  as `StarPackManifest.buffers` (positions relative to the node center).

The output is byte-reproducible: same input + same flags → identical manifest and
tiles.

## Build procedure

```sh
pnpm --filter @cosmos/pack-octree build -- \
  --in  apps/web/public/packs/manifest.json \
  --out apps/web/public/packs/octree \
  --root-half-extent 65536 \
  --source hyg-v41-octree
```

## How the committed sample pack was generated

The sample octree in `apps/web/public/packs/octree/` was built from the HYG v4.1
star pack (`apps/web/public/packs/manifest.json`, ~109 k stars) using the command
above. It produces 9 tiles (root + 8 leaf octants):

| Level | Tile | Points | Bytes |
|-------|------|--------|-------|
| 0     | root (internal) | 4 096 (decimated) | 114 688 |
| 1     | 8 leaves | 11 949–16 361 each | ≤ 458 KB |

Total payload: ~3.1 MB for all tiles.  Every tile is ≤ 512 KB.

To regenerate (e.g. after a catalog update), re-run the build command above from
the repo root and commit the updated `apps/web/public/packs/octree/` directory.
Attribution: HYG data is already credited in `ATTRIBUTIONS.md`.
