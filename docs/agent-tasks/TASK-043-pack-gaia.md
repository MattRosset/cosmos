# Task: `tools/pack-octree` v2 — real Gaia DR3 magnitude-cut subset → octree pack

**ID:** TASK-043
**Target package:** `tools/pack-octree`
**Size:** L
**Phase:** 4 — lane (data tool); chunk producer for the catalog tier
**Depends on:** TASK-042

## Goal

Produce the **real Gaia DR3 bright subset** as an [ADR-003](../decisions/ADR-003-octree-tiling.md)
octree pack, per [ADR-006](../decisions/ADR-006-gaia-subset-tier-unification.md). Extend
the existing `tools/pack-octree` (which already turns a star catalog into Morton-keyed
octree tiles + manifest) with a **Gaia ingest mode**: read a cached Gaia DR3 query
snapshot, apply the magnitude cut, convert to the canonical galactic-Cartesian frame,
dedup against HYG, and emit a reproducible octree pack in the **frozen ADR-003 format**
(no new tile format — ADR-006 §4). Commit a small CI-sized sample pack; the full
~2–3M-star pack is a CDN artifact built out-of-band.

When this lands, `data` v3's existing `loadOctreePack` can load the Gaia pack with **no
loader changes** (same format), and the M4a integration (TASK-052) can stream Gaia tiles
through the existing `render-stars` machinery.

## Frozen Interface

This task **consumes** frozen types/format; it adds a tool entry point, not a package API.

```ts
// Consumed (frozen): the ADR-003 octree types from @cosmos/core-types
import type { OctreeManifest, OctreeTileManifest } from '@cosmos/core-types';
import { encodeMortonKey, MAX_POINTS_PER_TILE, MAX_TILE_BYTES,
         INTERNAL_TILE_POINTS } from '@cosmos/core-types';

// New tool CLI surface (mirror the existing pack-octree CLI; add a `gaia` subcommand):
//   pnpm --filter @cosmos/pack-octree build:gaia -- \
//     --snapshot <gaia-dr3-snapshot.csv> --hyg <hyg-pack-dir> --out <pack-dir> [--sample]
// `--sample` emits the CI sample (region-clipped / tighter cut, ADR-006 §4).
```

The Gaia pack manifest fields are fixed by ADR-006 §4: `source: "gaia-dr3-bright"`,
`context: 'galaxy'`, `idPrefix: "gaia"`, `rootHalfExtentUnits: 65536`,
`octreeFormatVersion: 1`. Tile attribute layout is **identical** to the HYG octree
(ADR-003 §3): `positionsPc` / `absMag` / `colorIndexBV` / `catalogIds` / `hipIds`.

## The Gaia ingest (transcribe ADR-006 §1–§4 — do not redesign)

- **Query (ADR-006 §1):** commit the exact ADQL string to the tool
  (`src/gaia-query.adql`): select `source_id, ra, dec, parallax, phot_g_mean_mag, bp_rp`
  where `phot_g_mean_mag <= 12.5 AND parallax > 0 AND parallax_over_error >= 5`. The build
  reads a **cached snapshot file** (content-hashed); it never hits the network in CI.
- **Conversion (ADR-006 §2):** `d_pc = 1000 / parallax_mas`; ICRS RA/Dec + distance →
  galactic Cartesian pc using the **same transform `tools/pack-stars` applies to HYG**
  (import/reuse it — both catalogs MUST land in the identical frame, ADR-001; do not
  re-derive the rotation); `absMag = phot_g_mean_mag + 5·(log10(parallax_mas) − 2)`;
  `colorIndexBV = clamp(0.85·bp_rp − 0.06, −0.4, 2.0)`.
- **catalogIds (ADR-006 §2):** assign a dense 0-based index per surviving source as
  `catalogIds[i]`; write the original 64-bit `source_id` to a `gaia-sourceids.bin`
  sidecar (BigInt64Array), NOT a tile attribute. `hipIds[i] = 0`.
- **Dedup (ADR-006 §3):** drop a Gaia source within **2 arcsec** AND **0.5 mag** of any
  HYG star (read the HYG pack as build input). Deterministic.
- **Tiling:** reuse the existing pack-octree splitter (Morton keys, `MAX_POINTS_PER_TILE`
  / `MAX_TILE_BYTES` split, `INTERNAL_TILE_POINTS` brightest-N decimation on internal
  nodes). Positions in each tile are **relative to the node center** (ADR-003 §3).
- **Reproducible:** same snapshot + same params → byte-identical tiles + manifest
  (content `contentHashSha256` stable, §11), exactly like the Phase-3 pack-octree output.
- **Attribution (ADR-006 §4):** append/verify the *"ESA/Gaia/DPAC"* credit in
  `ATTRIBUTIONS.md`; the build **fails** if the credit line is absent.

## Inputs / Outputs

- **Inputs:** a committed **small** Gaia DR3 snapshot fixture for tests
  (`test/fixtures/gaia-dr3-mini.csv`, a few hundred rows incl. duplicates of known HYG
  stars to exercise dedup); the committed HYG pack (build input); the real full snapshot
  is supplied out-of-band for the CDN build (not committed).
- **Outputs:**
  - CI sample pack committed at `apps/web/public/packs/octree-gaia-sample/`
    (`octree.json` + tiles + `gaia-sourceids.bin`), small enough to commit (ADR-006 §4).
  - The full pack is produced by the same command on the real snapshot → CDN (not in git).
  - `ATTRIBUTIONS.md` Gaia credit.

## Constraints & Forbidden Actions

- Do not modify `packages/core-types` or any other package. **Reuse** the ADR-003 octree
  format + the HYG ICRS→galactic transform; do not invent a Gaia-specific format.
- No network access in tests or CI — read the committed snapshot fixture only.
- No `Math.random()` (the decimation/tiling is deterministic; use any committed seed via
  `createPrng` if a tie-break is needed).
- Do not commit the full multi-MB pack — only the small CI sample (ADR-006 §4). The
  bundle/repo-size discipline is the reason the octree exists (§5.7/§14).
- New dependencies: a CSV/Parquet reader is allowed **only if** one is already used by a
  sibling pack tool (check `tools/pack-stars`/`pack-exoplanets` — reuse their parser).
  Otherwise parse the committed CSV with the existing approach; list any new dep
  explicitly under "Allowed dependencies" or set Status `blocked`.

## Common Mistakes (architecture §5.7, §11; ADR-003/006)

- Parsing CSV in the browser — all conversion is **build-time**; the browser only sees
  binary tiles + JSON manifest.
- Mixing units — parsecs for positions (`positionsPc`), units in names; convert RA/Dec
  (degrees) → radians at the boundary.
- Loading the whole Gaia subset as one tile — it MUST be tiled (≤ `MAX_TILE_BYTES`).
- Putting `source_id` in a `Uint32Array` tile attribute — it overflows 32 bits; use the
  dense index + the BigInt64 sidecar (ADR-006 §2).
- Landing Gaia in a different frame than HYG — reuse the exact HYG transform, or stars
  double up / shift at the tier hand-off (ADR-006 §3 dedup depends on a shared frame).
- Non-reproducible output (timestamps, map iteration order) — sort deterministically so
  content hashes are stable (§11).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/pack-octree test` (Vitest):
   - **Conversion:** a fixture row with known RA/Dec/parallax/G/bp_rp maps to the
     expected galactic-pc position (within 1e-6), `absMag`, and `colorIndexBV` (ADR-006 §2).
   - **Dedup:** a fixture Gaia source placed within 2″/0.5 mag of an HYG star is dropped;
     one just outside the tolerance is kept (ADR-006 §3).
   - **Format conformance:** the emitted sample manifest validates as an `OctreeManifest`
     (`octreeFormatVersion === 1`, `idPrefix === "gaia"`, `rootHalfExtentUnits === 65536`),
     every tile ≤ `MAX_TILE_BYTES` and ≤ `MAX_POINTS_PER_TILE` points, internal tiles have
     `INTERNAL_TILE_POINTS` decimated points, positions are node-relative.
   - **Reproducibility:** building the sample twice yields byte-identical `octree.json` +
     tile `contentHashSha256` values (golden-hash fixture, the procgen/pack-octree
     precedent).
   - **Round-trip with the loader:** `@cosmos/data` `loadOctreePack` (Node `fetchImpl`)
     loads the committed sample without error and a leaf tile decodes to a `StarBatch`
     whose `idPrefix === "gaia"` (proves the format is consumed unchanged).
   - **Attribution:** the build asserts the Gaia credit line is present.
2. `pnpm verify` exits 0; the committed sample pack is present and small (assert sample
   total bytes under a committed budget, e.g. ≤ 512 KB).

## Deliverables

- `tools/pack-octree/src/gaia-ingest.ts` (snapshot read + conversion + dedup),
  `src/gaia-cli.ts` (the `build:gaia` subcommand), `src/gaia-query.adql` (committed query)
- `tools/pack-octree/test/gaia-ingest.test.ts`, `test/fixtures/gaia-dr3-mini.csv`,
  `test/fixtures/gaia-golden-hash.json`
- `apps/web/public/packs/octree-gaia-sample/` (committed CI sample: `octree.json`,
  tiles, `gaia-sourceids.bin`)
- `ATTRIBUTIONS.md` (Gaia/ESA/DPAC credit), `tools/pack-octree/README.md` (Gaia mode)

## Context Files

- `docs/decisions/ADR-006-gaia-subset-tier-unification.md` (§1–§4 — the whole ingest),
  `docs/decisions/ADR-003-octree-tiling.md` (the tile format being reused)
- `docs/architecture.md` §5.7 (data pipeline + tiling), §11 (reproducible packs +
  attribution), §14 (Gaia capped at 5M)
- `tools/pack-octree/` current source (the splitter + manifest writer to extend),
  `tools/pack-octree/README.md`
- `tools/pack-stars/src/` (the HYG ICRS→galactic transform + CSV parser to **reuse**)
- `packages/core-types/src/octree.ts` (the frozen types + constants),
  `packages/data/README.md` (`loadOctreePack` for the round-trip test)
