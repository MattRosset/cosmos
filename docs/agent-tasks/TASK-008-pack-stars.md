# Task: `tools/pack-stars` — HYG v4.1 catalog → `stars.bin` pack

**ID:** TASK-008
**Target package:** `tools/pack-stars` (new) + committed pack in `apps/web/public/packs/`
**Size:** M
**Phase:** 1 — lane A (data)
**Depends on:** TASK-007

## Goal

A reproducible Node build script that converts the HYG v4.1 star catalog CSV
(~120k stars) into the binary pack format defined in `core-types/packs.ts`:
`stars.<hash8>.bin` + `manifest.json` + `names.json`, written to
`apps/web/public/packs/`. The built pack (~2.5 MB) is committed so downstream tasks
and CI never need the raw CSV. The browser must never see CSV (§5.7) — all parsing,
validation, and unit conversion happens here, at build time.

## Frozen Interface

Consumes (do not modify): `StarPackManifest`, `BufferSlice`, `STAR_PACK_FORMAT_VERSION`
from `@cosmos/core-types`.

CLI contract:

```
pnpm --filter @cosmos/pack-stars build -- --input <path-to-hygdata_v41.csv> --out apps/web/public/packs
```

- `manifest.json` — a `StarPackManifest` (binUrl/namesUrl relative to the manifest).
- `stars.<hash8>.bin` — little-endian, slices in this order, each 4-byte aligned:
  `positionsPc` (f32 ×3N) → `absMag` (f32 ×N) → `colorIndexBV` (f32 ×N) →
  `catalogIds` (u32 ×N) → `hipIds` (u32 ×N). `<hash8>` = first 8 hex chars of the
  SHA-256 of the bin content (content-hashed filenames, §11/§12).
- `names.json` — `Record<string, string>` mapping catalog id (decimal string) →
  display name. Name preference order per star: `proper` → `bf` (Bayer/Flamsteed)
  → `gl` (Gliese). Stars with none of these are omitted (HIP search is handled
  numerically via `hipIds` in `data`, not via this file).

## Inputs / Outputs

- **Input:** HYG v4.1 CSV (`hygdata_v41.csv`, public domain, from
  https://github.com/astronexus/HYG-Database — document the download in the README;
  the full CSV is NOT committed). Relevant columns:
  `id, hip, proper, bf, gl, dist, mag, absmag, ci, rarad, decrad`.
- **Row filtering (fixed):** drop rows with `dist ≥ 99999` (HYG's missing-parallax
  placeholder) or unparseable `rarad`/`decrad`/`absmag`. Missing `ci` → `0.0`.
  Missing `hip` → `0`. Keep Sol (`id = 0`). Sort output by `id` ascending
  (stable, reproducible).
- **Coordinate conversion (fixed — transcribe verbatim):** equatorial unit vector
  `e = [cos(decrad)·cos(rarad), cos(decrad)·sin(rarad), sin(decrad)]`, then galactic
  `g = R·e` with the J2000 ICRS→galactic rotation matrix
  ```
  R = [ -0.0548755604  -0.8734370902  -0.4838350155 ]
      [  0.4941094279  -0.4448296300   0.7469822445 ]
      [ -0.8676661490  -0.1980763734   0.4559837762 ]
  ```
  `positionPc = dist × g` (heliocentric galactic Cartesian, parsecs). Math in f64;
  downcast to f32 only when writing the buffer. `originPc = [0, 0, 0]` (Sun —
  Phase 1 convention from TASK-007).
- **Output example:** Sirius row → position with `|p| ≈ 2.64 pc`, galactic
  longitude ≈ 227.2°, latitude ≈ −8.9°.

## Constraints & Forbidden Actions

- Do not modify any `packages/*` source.
- Allowed dependencies (this tools package only): `zod`, `csv-parse`, `tsx` (dev).
  Node ≥ 22 built-ins (`node:crypto` for SHA-256, `node:fs`) for everything else.
- Validate every parsed row with a Zod schema (range checks: `dist ∈ (0, 99999)`,
  `ci ∈ [-1, 4]`, finite angles) — fail the build loudly on schema violations,
  except the documented drop rules above.
- Reproducible: same input file → byte-identical bin + identical manifest
  (no timestamps, no `Math.random()`, stable ordering).
- Degrees never enter the pipeline — HYG provides `rarad`/`decrad`; use those columns
  only (§5.5 radians doctrine).
- Tools packages are exempt from browser boundary rules but must not import Three.js
  or React.

## Common Mistakes (architecture §5.7 — copy kept verbatim)

- Parsing CSV in the browser (do all conversion at build time; the browser only ever
  sees binary packs + small JSON manifests).
- Mixing units (mandate: parsecs for interstellar — encode units in names).
- Ignoring missing-data flags in real catalogs — the `dist ≥ 99999` placeholder is
  exactly this; dropping those rows is the documented fallback.
- Plus: hashing the manifest into its own `contentHashSha256` (hash the .bin only);
  forgetting 4-byte alignment padding between slices.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/pack-stars test` — runs the packer against a committed
   fixture CSV (`test/fixtures/hyg-mini.csv`, ~12 rows copied verbatim from HYG v4.1,
   including Sol, Sirius, Vega, Rigil Kentaurus, and one `dist = 100000.0` row):
   - Output manifest validates against `StarPackManifest` shape; placeholder row
     dropped; counts and slice offsets/alignment exactly match the layout above.
   - Galactic conversion: Sirius at l = 227.2° ± 0.3°, b = −8.9° ± 0.3°;
     `|position|` equals the CSV `dist` within 1e-3 relative for every star.
   - Known distances within 1% (§5.7): Sirius ≈ 2.64 pc, Vega ≈ 7.68 pc,
     Rigil Kentaurus ≈ 1.32 pc.
   - Determinism: two consecutive runs produce identical SHA-256.
   - `names.json` maps Sirius's catalog id to "Sirius"; unnamed star omitted.
2. The full pack is built from the real CSV and committed:
   `apps/web/public/packs/manifest.json`, `stars.<hash8>.bin`, `names.json`;
   bin size < 3.5 MB; star count recorded in the PR description.
3. `ATTRIBUTIONS.md` created at repo root crediting HYG (public domain) per §11.
4. `pnpm verify` exits 0.

## Deliverables

- `tools/pack-stars/package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`
- `tools/pack-stars/src/convert.ts` (row parse/validate/convert, pure & exported),
  `src/write-pack.ts` (binary layout + hashing), `src/cli.ts`
- `tools/pack-stars/test/pack-stars.test.ts`, `test/fixtures/hyg-mini.csv`
- `apps/web/public/packs/manifest.json`, `stars.<hash8>.bin`, `names.json` (built)
- `ATTRIBUTIONS.md` (repo root)
  (`pnpm-workspace.yaml` already includes `tools/*` — do not touch it.)

## Context Files

- `docs/architecture.md` §5.7 (data pipeline), §11 (build-time pipeline, licensing)
- `packages/core-types/src/packs.ts` (from TASK-007 — the binding format)
- `docs/agent-tasks/TASK-007-core-types-thaw.md` (originPc convention)
