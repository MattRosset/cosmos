# @cosmos/pack-constellations

Converts the committed IAU constellation line list
(`src/constellation-lines.dat`) into `apps/web/public/packs/constellations.json`
— a `ConstellationPack` enumerating the 88 IAU constellation stick-figure line
segments as HIP-number pairs. Endpoints are resolved to star positions at
runtime by `@cosmos/data` (TASK-046); this pack stores only HIP references, so
it stays tiny and frame-agnostic (architecture §5.7, §5.12).

## Source Data

`src/constellation-lines.dat` is transcribed from Stellarium's `modern_iau` sky
culture (`skycultures/modern_iau/index.json`), the official IAU constellation
figure set. Licensed CC BY-SA 4.0 by Stellarium contributors — see
`ATTRIBUTIONS.md`.

Format: one constellation per non-comment line —

```
CODE|Name|polyline1;polyline2;...
```

Each `polylineN` is a comma-separated walk of HIP numbers; consecutive HIPs in
the walk are connected by one line segment (a polyline of N stars yields N−1
segments). The `.dat` file is the single source of truth — it is not
regenerated from Stellarium automatically; updating it means re-transcribing
from a newer Stellarium release.

## Building the Pack

```
pnpm --filter @cosmos/pack-constellations build
```

Reads `src/constellation-lines.dat` and `ATTRIBUTIONS.md` (build fails if the
Stellarium/CC BY-SA credit is missing) and writes
`apps/web/public/packs/constellations.json`. Output is sorted by `code` and
contains no timestamps, so rebuilds are byte-identical (§11).

Custom paths:

```
pnpm --filter @cosmos/pack-constellations build -- \
  --input tools/pack-constellations/src/constellation-lines.dat \
  --out apps/web/public/packs \
  --attributions ATTRIBUTIONS.md
```

## Running Tests

```
pnpm --filter @cosmos/pack-constellations test
```

Validates the parser, the pack builder, the attribution check, and the
committed pack (schema validity, 88 unique 3-letter codes, even-length
`hipPairs`, a known Orion segment, reproducibility against a golden SHA-256
hash, and the 128 KB size budget).
