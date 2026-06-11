# @cosmos/pack-stars

Build-time tool that converts the HYG v4.1 star catalog CSV into the binary pack format
consumed by the Cosmos web app (`apps/web`).

## Usage

```bash
# One-time: download the catalog (not committed — see ATTRIBUTIONS.md at repo root)
curl -L -o hygdata_v41.csv \
  https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv

# Build the pack (outputs to apps/web/public/packs/)
pnpm --filter @cosmos/pack-stars build -- \
  --input /absolute/path/to/hygdata_v41.csv \
  --out /absolute/path/to/apps/web/public/packs
```

The `--input` and `--out` arguments require absolute paths when invoked via pnpm
(the working directory shifts to the package root at runtime).

## Output

- `stars.<hash8>.bin` — little-endian binary, slices in order:
  `positionsPc` (f32×3N) → `absMag` (f32×N) → `colorIndexBV` (f32×N) →
  `catalogIds` (u32×N) → `hipIds` (u32×N).  `<hash8>` = first 8 hex chars of the
  SHA-256 of the bin content (content-addressed filename, reproducible builds).
- `manifest.json` — `StarPackManifest` (from `@cosmos/core-types`).
- `names.json` — `Record<string, string>` mapping catalog id → display name
  (proper name preferred over Bayer/Flamsteed over Gliese; unnamed stars omitted).

## Row filtering

Silently dropped:
- `dist ≥ 99999` (HYG's missing-parallax placeholder)
- Unparseable `rarad`, `decrad`, or `absmag`
- `ci` outside `[-1, 4]` (handful of carbon stars / Mira variables in the catalog)

All other anomalies fail the build loudly via Zod validation.

## Coordinate system

Equatorial (ra/dec) → heliocentric galactic Cartesian, in parsecs.
Coordinates use the J2000 ICRS→galactic rotation matrix (IAU 1958).
Math is done in f64; values are downcast to f32 only when writing the buffer.
Sol is placed at the galactic origin `[0, 0, 0]`.

## Running tests

```bash
pnpm --filter @cosmos/pack-stars test
```

The test suite runs against `test/fixtures/hyg-mini.csv` (~12 rows including Sol,
Sirius, Vega, Rigil Kentaurus, and one `dist=100000` placeholder row).
