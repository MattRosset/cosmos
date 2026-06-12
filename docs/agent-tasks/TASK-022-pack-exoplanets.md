# Task: `tools/pack-exoplanets` — NASA archive → `systems-exo.json` + procedural fill

**ID:** TASK-022
**Target package:** `tools/pack-exoplanets` (new) + committed pack in `apps/web/public/packs/`
**Size:** M
**Phase:** 2 — lane H (data tools; runs after TASK-021 — shared `packs/` dir + ATTRIBUTIONS)
**Depends on:** TASK-018, TASK-021

## Goal

A reproducible Node build script that converts a NASA Exoplanet Archive CSV export
into a `SystemsPackManifest` of real exoplanet systems within 50 pc, with
**deterministic procedural synthesis for incomplete data** (architecture §6 Phase 2,
§5.7 "define documented fallbacks"): every system in the pack ends up fully
renderable — complete `KeplerElements`, radius, and color for every planet — with
every invented value derived from the seeded PRNG keyed by the host name, never
`Math.random()`. The browser never sees CSV. The built pack is committed; TRAPPIST-1
(the M2 tour target) must be in it.

## Frozen Interface

Consumes (do not modify): `SystemsPackManifest`, `StarSystemRecord`, `PlanetRecord`,
`KeplerElements`, `SYSTEMS_PACK_FORMAT_VERSION`, `createPrng`, `hashCombine` from
`@cosmos/core-types`.

CLI contract:

```
pnpm --filter @cosmos/pack-exoplanets build -- --input <path-to-pscomppars.csv> --out apps/web/public/packs
```

Output: `apps/web/public/packs/systems-exo.json` — `SystemsPackManifest` with
`source: "nasa-exoplanet-archive-pscomppars"`.

## Inputs / Outputs

- **Input:** CSV export of the archive's `pscomppars` table (one row per planet,
  composite parameters). Download documented in the README (raw CSV NOT committed):

  ```
  https://exoplanetarchive.ipac.caltech.edu/TAP/sync?format=csv&query=
    select pl_name,hostname,sy_dist,ra,dec,sy_vmag,st_teff,st_mass,st_rad,
           pl_orbsmax,pl_orbper,pl_orbeccen,pl_orblper,pl_rade,pl_bmasse
    from pscomppars where sy_dist is not null and sy_dist < 50
    and (pl_orbsmax is not null or pl_orbper is not null)
  ```

- **Row filtering (fixed):** drop rows with unparseable `ra`/`dec`/`sy_dist`. Group
  rows by `hostname`; one `StarSystemRecord` per host. Sort systems by host slug,
  planets by `pl_name` (stable, reproducible).
- **Id scheme (fixed):** host slug = `hostname` lowercased, spaces → `-`, any char
  outside `[a-z0-9-]` removed. System id `exo:<slug>`; planet id
  `exo:<slug>:<suffix>` where suffix = the portion of `pl_name` after the hostname,
  trimmed/lowercased (e.g. `TRAPPIST-1 e` → `exo:trappist-1:e`).
- **Host star record (fixed):**
  - `positionPc`: RA/Dec are in DEGREES in this table — convert to radians, then
    the same equatorial→galactic conversion as TASK-008 (unit vector × the
    `ICRS_TO_GALACTIC` matrix from `@cosmos/core-types/frames`, × `sy_dist`).
  - `absMag = sy_vmag − 5·log10(sy_dist / 10)`; missing `sy_vmag` → `absMag = 10.0`.
  - `colorIndexBV` from `st_teff` via the inverted Ballesteros (2012) relation —
    solve `T·u² + (2.32T − 9200)·u + (1.054T − 10672) = 0` for the positive root,
    `bv = u / 0.92` (derivation: substitute `u = 0.92·bv` into
    `T = 4600·(1/(u+1.7) + 1/(u+0.62))`; cite TASK-010's LUT as the forward
    direction). Clamp bv to [−0.4, 2.0]. Missing `st_teff` → `bv = 1.5`.
- **Per-planet element completion (fixed; PRNG = `createPrng(seedFromHost)` where
  `seedFromHost` = first 4 bytes of SHA-256 of the host slug, big-endian u32, via
  `node:crypto`; one PRNG per system, consumed in documented call order —
  system-plane draws first, then per-planet draws in sorted planet order):**
  - `μ = (st_mass missing ? 1.0 : st_mass) × 1.32712440018e11` km³/s².
  - `semiMajorAxisAu`: `pl_orbsmax`, else from `pl_orbper` (days) via Kepler III:
    `a_km = (μ·(P·86400)²/(4π²))^(1/3)`, `a_au = a_km / 1.495978707e8`.
  - `eccentricity`: `pl_orbeccen`, else 0. Clamp to [0, 0.95].
  - **Orbit orientation is unknowable from the archive (sky-plane inclination is
    useless in 3D) — synthesize per system:** shared system plane
    `inclinationRad = acos(prng.range(-1, 1))`, shared
    `ascendingNodeLongitudeRad = prng.range(0, 2π)`; per planet
    `argumentOfPeriapsisRad` = `pl_orblper` (deg→rad) when present, else
    `prng.range(0, 2π)`; `meanAnomalyAtEpochRad = prng.range(0, 2π)` always
    (phases are unknown). `epochJD = 2451545.0`.
  - `radiusKm`: `pl_rade × 6371`; missing → `pl_bmasse` present ?
    `6371 × pl_bmasse^0.28` (clamped to ≤ 11.2 R⊕) : `2 × 6371`. Document both.
  - `surfaceColorLinear` from equilibrium temperature
    `T_eq = 278.3 · L^0.25 / sqrt(a_au)` K, with `L = (st_rad² )·(st_teff/5772)⁴`
    (missing st_rad or st_teff → L = 1): T_eq > 1000 → `[0.55, 0.35, 0.20]`;
    200–1000 → `[0.25, 0.35, 0.45]`; < 200 → `[0.75, 0.78, 0.82]`.
  - No textures, no rings, no rotation fields for exo planets in Phase 2.
- **Output example:** TRAPPIST-1 → `exo:trappist-1`, 7 planets b–h, host
  `|positionPc| ≈ 12.4`, all elements finite and complete.

## Constraints & Forbidden Actions

- Do not modify any `packages/*` or other `tools/*` source.
- Allowed dependencies (this tools package only): `zod`, `csv-parse`, `tsx` (dev),
  `@cosmos/core-types`. Node ≥ 22 built-ins for everything else.
- Zod-validate every parsed row (finite ranges; `sy_dist ∈ (0, 50]`); fail loudly
  outside the documented drop rules.
- Reproducible: same input CSV → byte-identical JSON (stable ordering, fixed key
  order, `generatedAtIso` taken from a `--generated-at <iso>` CLI flag, not the
  wall clock; the committed pack records the flag value used).
- `Math.random()` is banned (lint + doctrine §8.6) — every synthesized value comes
  from the seeded PRNG in the documented call order.
- Degrees exist only at the CSV boundary (`ra`, `dec`, `pl_orblper`).

## Common Mistakes (architecture §5.7 — copy kept verbatim)

- Parsing CSV in the browser (do all conversion at build time; the browser only
  ever sees binary packs + small JSON manifests).
- Mixing units (mandate: parsecs for interstellar, AU intra-system — encode units
  in names).
- Ignoring missing-data flags in real catalogs (exoplanets often lack inclination —
  define documented fallbacks) — this whole task is that rule; every fallback above
  is normative, not a suggestion.
- Plus: seeding per planet instead of per system (sibling planets must share an
  orbital plane); consuming PRNG draws in a data-dependent order (breaks
  determinism when the archive adds a column — the call order above is fixed).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/pack-exoplanets test` — runs the packer against a
   committed fixture CSV (`test/fixtures/pscomppars-mini.csv`, ~12 rows copied
   verbatim from a real export: all 7 TRAPPIST-1 planets, Proxima Cen b, tau Cet e,
   one row missing `pl_orbsmax` but having `pl_orbper`, one missing `pl_orbeccen`,
   one missing `pl_rade` and `pl_bmasse`):
   - Manifest validates (type + Zod); TRAPPIST-1 has 7 planets with the exact ids
     `exo:trappist-1:b` … `:h`; host `|positionPc| = 12.4 ± 0.4` pc.
   - Kepler-III fallback: the period-only row's `semiMajorAxisAu` matches a
     hand-computed literal in the test (±1e-6).
   - All planets of one system share `inclinationRad` and
     `ascendingNodeLongitudeRad`; two different hosts get different planes.
   - Every fallback rule above exercised and asserted (e → 0, radius defaults,
     color bands, absMag default).
   - Determinism: two runs byte-identical; changing one host's slug changes only
     that system's synthesized values.
   - bv inversion: `st_teff = 5772` → bv = 0.65 ± 0.05 (round-trips TASK-010's
     forward formula).
2. The full pack is built from the real CSV and committed:
   `apps/web/public/packs/systems-exo.json` < 1.5 MB; system + planet counts
   recorded in the PR description.
3. `ATTRIBUTIONS.md` updated: NASA Exoplanet Archive (operated by Caltech/IPAC
   under contract with NASA) citation per §11.
4. `pnpm verify` exits 0.

## Deliverables

- `tools/pack-exoplanets/package.json`, `tsconfig.json`, `vitest.config.ts`,
  `README.md` (TAP download procedure, fallback table, PRNG call-order contract)
- `tools/pack-exoplanets/src/convert.ts` (row → records, pure & exported),
  `src/synthesize.ts` (fallback rules, pure & exported), `src/schema.ts`, `src/cli.ts`
- `tools/pack-exoplanets/test/pack-exoplanets.test.ts`,
  `test/fixtures/pscomppars-mini.csv`
- `apps/web/public/packs/systems-exo.json` (built, committed)
- `ATTRIBUTIONS.md` (updated)

## Context Files

- `docs/architecture.md` §5.7 (data pipeline, missing-data doctrine), §11
- `docs/agent-tasks/TASK-008-pack-stars.md` (galactic conversion, determinism)
- `docs/agent-tasks/TASK-021-pack-solar.md` (systems-pack conventions to match)
- `packages/core-types/src/systems.ts`, `src/frames.ts`, `src/prng.ts`
