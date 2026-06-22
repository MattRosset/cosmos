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

## Gaia DR3 ingest mode (`build:gaia`)

Builds the **real Gaia DR3 bright subset** (ADR-006) into the *same* ADR-003 octree
format — no new tile format. It reads a cached Gaia query snapshot (CSV), converts
each source to the canonical galactic-Cartesian frame, dedups against the HYG pack,
and emits an octree pack + a `gaia-sourceids.bin` sidecar.

```sh
pnpm --filter @cosmos/pack-octree build:gaia -- \
  --snapshot <gaia-dr3-snapshot.csv> \
  --hyg      apps/web/public/packs \
  --out      <pack-dir> \
  [--sample]
```

- **Query (`src/gaia-query.adql`):** the exact ADQL that produces the snapshot
  (`phot_g_mean_mag ≤ 12.5`, `parallax > 0`, `parallax_over_error ≥ 5`). The build
  never hits the network — it reads the committed/cached snapshot only.
- **Conversion (ADR-006 §2):** `d_pc = 1000 / parallax_mas`; ICRS RA/Dec + distance →
  galactic pc via the **same** `tools/pack-stars` rotation (imported, not re-derived);
  `absMag = G + 5·(log10(parallax_mas) − 2)`; `colorIndexBV = clamp(0.85·bp_rp − 0.06,
  −0.4, 2.0)`. Each surviving source gets a dense 0-based `catalogId` (manifest
  `idPrefix = "gaia"`); its 64-bit `source_id` goes to `gaia-sourceids.bin`
  (`BigInt64Array`), not a tile attribute.
- **Dedup (ADR-006 §3):** a Gaia source within **2″** AND **0.5 mag** of an HYG star
  is dropped (HYG stays authoritative for the brightest/named stars).
- **`--sample`:** emits the committed CI sample — region-clipped to
  `≤ 600 pc` from Sol so it stays small. The full ~2–3M-star pack is built by the same
  command on the real snapshot (no `--sample`) and deployed to the CDN out-of-band;
  it is **not** committed.
- **Attribution:** the build fails unless `ATTRIBUTIONS.md` credits *ESA/Gaia/DPAC*.

### How the committed Gaia sample was generated

`apps/web/public/packs/octree-gaia-sample/` was built from the committed fixture
`test/fixtures/gaia-dr3-mini.csv` against the HYG star pack
(`apps/web/public/packs/`):

```sh
pnpm --filter @cosmos/pack-octree build:gaia -- \
  --snapshot tools/pack-octree/test/fixtures/gaia-dr3-mini.csv \
  --hyg      apps/web/public/packs \
  --out      apps/web/public/packs/octree-gaia-sample \
  --sample
```

The output is byte-reproducible (golden hashes in `test/fixtures/gaia-golden-hash.json`).
To regenerate, re-run the command from the repo root and commit the updated directory.
