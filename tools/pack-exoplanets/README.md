# @cosmos/pack-exoplanets

Converts a NASA Exoplanet Archive `pscomppars` CSV export into
`apps/web/public/packs/systems-exo.json` — a `SystemsPackManifest` of real
exoplanet systems within 50 pc, with deterministic procedural synthesis for
all missing orbital and physical data.

## Data Download

Download the CSV from the NASA Exoplanet Archive TAP service (no login required):

```
https://exoplanetarchive.ipac.caltech.edu/TAP/sync?format=csv&query=
  select pl_name,hostname,sy_dist,ra,dec,sy_vmag,st_teff,st_mass,st_rad,
         pl_orbsmax,pl_orbper,pl_orbeccen,pl_orblper,pl_rade,pl_bmasse
  from pscomppars where sy_dist is not null and sy_dist < 50
  and (pl_orbsmax is not null or pl_orbper is not null)
```

Save the result as `pscomppars.csv` (raw CSV — **not committed**).

## Building the Pack

```
pnpm --filter @cosmos/pack-exoplanets build -- \
  --input pscomppars.csv \
  --out apps/web/public/packs \
  --generated-at 2026-06-12T00:00:00.000Z
```

The `--generated-at` flag sets the `generatedAtIso` field in the pack manifest.
Use the same ISO timestamp on rebuilds to get byte-identical output.

## Fallback Table

All fallbacks are deterministic and normative (architecture §5.7).

| Field | Source | Fallback |
|---|---|---|
| `semiMajorAxisAu` | `pl_orbsmax` | Kepler III from `pl_orbper`: `a = ∛(μP²/4π²)` |
| `eccentricity` | `pl_orbeccen` | 0; clamped to [0, 0.95] |
| `inclinationRad` | — (unknowable) | PRNG: `acos(range(−1,1))` |
| `ascendingNodeLongitudeRad` | — | PRNG: `range(0, 2π)` |
| `argumentOfPeriapsisRad` | `pl_orblper` (deg→rad) | PRNG: `range(0, 2π)` |
| `meanAnomalyAtEpochRad` | — (always unknown) | PRNG: `range(0, 2π)` |
| `radiusKm` | `pl_rade × 6371` | `min(pl_bmasse^0.28, 11.2) × 6371`; else `2 × 6371` |
| `surfaceColorLinear` | equilibrium temperature | hot / temperate / cold bands |
| `colorIndexBV` | Ballesteros inversion of `st_teff` | 1.5 |
| `absMag` | `sy_vmag − 5·log10(sy_dist/10)` | 10.0 |

## PRNG Call Order Contract

Each system uses one PRNG seeded from the first 4 bytes (big-endian u32) of
the SHA-256 of the host slug. **The call order below is fixed** — inserting or
reordering draws breaks determinism for all downstream packages:

1. `inclinationRad = acos(prng.range(-1, 1))` — shared system plane
2. `ascendingNodeLongitudeRad = prng.range(0, 2π)` — shared system plane
3. Per planet in sorted `pl_name` order:
   a. If `pl_orblper` is absent: `argumentOfPeriapsisRad = prng.range(0, 2π)`
   b. `meanAnomalyAtEpochRad = prng.range(0, 2π)` — always drawn

## Running Tests

```
pnpm --filter @cosmos/pack-exoplanets test
```

The test suite runs against `test/fixtures/pscomppars-mini.csv` (12 rows, committed)
and also validates the committed `systems-exo.json` pack.
