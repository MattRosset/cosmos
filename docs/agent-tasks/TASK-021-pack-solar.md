# Task: `tools/pack-solar` — hand-authored solar system → `systems-sol.json` + textures

**ID:** TASK-021
**Target package:** `tools/pack-solar` (new) + committed pack in `apps/web/public/`
**Size:** M
**Phase:** 2 — lane H (data tools)
**Depends on:** TASK-018, TASK-020

## Goal

A reproducible Node build script that turns a hand-authored source file (JPL
approximate ephemerides — "a known published table — agents can transcribe it
verbatim", architecture §5.7) into the `SystemsPackManifest` JSON pack for the Sol
system: 8 planets + 6 major moons + Saturn's rings + the Sol disc record, plus
KTX2-compressed NASA-derived textures. Output is committed; the browser never sees
the source table. The pack's ephemeris accuracy is gated here against JPL Horizons
(the §5.5 "published ephemeris values, 8 planets, J2000 ± 50 yr" test), using
`@cosmos/orbits` as the propagator.

## Frozen Interface

Consumes (do not modify): `SystemsPackManifest`, `StarSystemRecord`, `PlanetRecord`,
`RingSpec`, `KeplerElements`, `SYSTEMS_PACK_FORMAT_VERSION` from `@cosmos/core-types`;
`elementsToPositionAu`, `meanMotionRadPerS`, `AU_KM` from `@cosmos/orbits` (test-time).

CLI contract:

```
pnpm --filter @cosmos/pack-solar build -- --out apps/web/public
```

Writes `apps/web/public/packs/systems-sol.json` and verifies that every
`textures.*Url` referenced by the pack exists under `apps/web/public/textures/sol/`.

## Source data (fixed — transcribe verbatim into `data/solar-system.json`)

**Planet elements** — transcribe Table 1 ("Keplerian elements and rates, valid
1800 AD – 2050 AD") of JPL's *Approximate Positions of the Planets*,
https://ssd.jpl.nasa.gov/planets/approx_pos.html, EXACTLY as published (degrees and
AU, J2000 ecliptic). Keep the table verbatim in `data/solar-system.json` under a
`jplTable1` key (all 6 elements + all 6 centennial rates per planet) so review can
diff it against the source. Transcription checksums (build fails if these don't
match): Mercury `a = 0.38709927`, `e = 0.20563593`, `I = 7.00497902`; Earth(-Moon
barycenter) `a = 1.00000261`, `e = 0.01671123`; Jupiter `a = 5.20288700`.

Build-time conversion (degrees → radians at this boundary ONLY, §5.5):

- `ω = ϖ − Ω` (argument of periapsis from longitude of perihelion),
  `M₀ = L − ϖ` (mean anomaly from mean longitude), all at J2000; normalize to
  (−π, π]; `epochJD = 2451545.0`.
- **Effective μ (document this in code):** `n = dL/dt` from the table's rate column
  (deg/century → rad/s, 1 century = 36525 days), then
  `muKm3S2 = n² · (a · AU_KM)³`. This bakes the table's secular mean motion into
  Kepler's third law so propagation matches JPL rates without storing rates.
  Do NOT use the Sun's GM for planets.

**Moons** — fixed table (a km, e, i deg to ecliptic ≈ parent equator — accepted
Phase 2 approximation, documented), Ω = ω = M₀ = 0, epochJD = 2451545.0, μ = parent
GM below:

| id | parentId | a (km) | e | i (deg) | radiusKm |
|---|---|---|---|---|---|
| sol:moon | sol:earth | 384400 | 0.0549 | 5.145 | 1737.4 |
| sol:io | sol:jupiter | 421800 | 0.0041 | 0.04 | 1821.6 |
| sol:europa | sol:jupiter | 671100 | 0.0094 | 0.47 | 1560.8 |
| sol:ganymede | sol:jupiter | 1070400 | 0.0013 | 0.18 | 2634.1 |
| sol:callisto | sol:jupiter | 1882700 | 0.0074 | 0.19 | 2410.3 |
| sol:titan | sol:saturn | 1221870 | 0.0288 | 0.31 | 2574.7 |

Parent GMs (km³/s²): Sun `1.32712440018e11` (Sol disc only — planets use effective
μ above), Earth `398600.4418`, Jupiter `1.26686534e8`, Saturn `3.7931187e7`.

**Physical/visual table** (radiusKm, rotationPeriodH [negative = retrograde],
axialTiltDeg → converted to radians at build):

| body | radiusKm | rotationPeriodH | axialTiltDeg |
|---|---|---|---|
| sol:mercury | 2439.7 | 1407.6 | 0.03 |
| sol:venus | 6051.8 | −5832.5 | 177.4 |
| sol:earth | 6371.0 | 23.934 | 23.44 |
| sol:mars | 3389.5 | 24.623 | 25.19 |
| sol:jupiter | 69911 | 9.925 | 3.13 |
| sol:saturn | 58232 | 10.656 | 26.73 |
| sol:uranus | 25362 | −17.24 | 97.77 |
| sol:neptune | 24622 | 16.11 | 28.32 |

Saturn ring: `{ innerRadiusKm: 74500, outerRadiusKm: 140220 }`, `ringUrl` texture.
Moons: rotationPeriodH = orbital period (tidally locked — compute `2π/n` at build),
axialTiltRad = 0.

**Sol disc record:** `PlanetRecord`-shaped body `{ id: 'sol:sun', parentId: 'hyg:0',
radiusKm: 695700, unlit: true, rotationPeriodH: 609.12, no elements }` (no elements ⇒
fixed at the system origin). The system's `star` field is the HYG Sol record:
`{ id: 'hyg:0', kind: 'star', name: 'Sol', positionPc: [0,0,0], absMag: 4.83,
colorIndexBV: 0.65 }`.

**Textures** — download manually (documented in README, NOT fetched by the build):
the 2k texture set from https://www.solarsystemscope.com/textures/ (CC BY 4.0,
NASA-derived) for the 8 planets, the Moon, the Sun, and the Saturn ring alpha
strip. Convert each to KTX2 (§9 mandates KTX2/Basis) with KTX-Software's `toktx`
(document the exact installed version in the README):

```
toktx --t2 --encode etc1s --clevel 4 --qlevel 128 --genmipmap \
  apps/web/public/textures/sol/<body>.ktx2 <body>_2k.jpg
```

Commit only the `.ktx2` outputs. Galilean moons + Titan get no texture
(`surfaceColorLinear` fallbacks: io `[0.80,0.70,0.35]`, europa `[0.75,0.72,0.65]`,
ganymede `[0.55,0.50,0.45]`, callisto `[0.40,0.36,0.32]`, titan `[0.80,0.60,0.25]`,
moon — has texture).

## Inputs / Outputs

- **Inputs:** `tools/pack-solar/data/solar-system.json` (hand-authored, committed).
- **Outputs:** `apps/web/public/packs/systems-sol.json` — a `SystemsPackManifest`
  with `source: "jpl-approx-pos-1800-2050"`, exactly 1 system (`id: 'sol'`),
  15 bodies (sun disc + 8 planets + 6 moons); committed `.ktx2` textures, total
  texture payload < 6 MB.

## Constraints & Forbidden Actions

- Do not modify any `packages/*` source.
- Allowed dependencies (this tools package only): `zod`, `tsx` (dev),
  `@cosmos/core-types`, `@cosmos/orbits` (devDependency, tests only). Node ≥ 22
  built-ins for everything else.
- Validate the authored source AND the emitted pack with Zod schemas (radians in
  output: `|i| ≤ π`, `e ∈ [0, 1)`, `a > 0`; fail loudly).
- Reproducible: same input → byte-identical JSON (stable key order via a fixed
  serializer, no timestamps except `generatedAtIso` — which MUST be taken from the
  source file, not `new Date()`).
- Degrees may exist ONLY in `data/solar-system.json` and the conversion module.
- No `Math.random()`; no network access in the build (textures are pre-downloaded).

## Common Mistakes (architecture §5.5, §5.7 — copy kept verbatim)

- Degrees vs. radians (standardize on radians internally, convert at data-pack
  boundary) — ω and M₀ are DERIVED (ϖ − Ω, L − ϖ) before conversion; deriving after
  unit conversion is fine too, but mixing the two corrupts angles silently.
- Mixing units (mandate: AU intra-system, km for planet-local — encode units in
  type names) — moon `a` is given in km and MUST be converted to AU
  (`a_km / AU_KM`) since `KeplerElements.semiMajorAxisAu` is AU.
- Ignoring missing-data flags in real catalogs — n/a here; instead: do not invent
  elements for the Sol disc (it is positionally fixed; `elements` absent).
- Plus: using the Sun's GM instead of the effective μ (orbits drift vs. JPL within
  decades); forgetting that the table row is the EARTH-MOON BARYCENTER (accepted
  Phase 2 approximation for Earth — document it).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/pack-solar test`:
   - Pack validates against the Zod schema and the `SystemsPackManifest` type;
     body count, ids, and parent links exactly as specified; determinism — two
     builds byte-identical.
   - Transcription checksums above match.
   - **Ephemeris gate (§5.5):** for each of the 8 planets, at JD 2451545.0 (J2000),
     2433282.5 (1950-01-01) and 2469807.5 (2050-01-01): propagate with
     `elementsToPositionAu` and compare against heliocentric J2000-ecliptic
     position vectors transcribed from JPL Horizons
     (https://ssd.jpl.nasa.gov/horizons/app.html — Ephemeris Type: *Vector Table*,
     Coordinate Center: `@sun` [500@10], Reference Plane: *ecliptic x-y*, exact
     query settings recorded in a comment block in the test file, vectors pasted
     as literals). Tolerance: **|Δr| < 0.1% of the body's semi-major axis**. If an
     outer planet exceeds 0.1% while Mercury–Mars pass, set this task `blocked`
     with the measured deltas in the Notes column and stop — do not loosen the
     threshold unilaterally (README rule 5).
   - Moon sanity: sol:moon period from `2π/n` ∈ [27.2, 27.5] days; Io ≈ 1.77 d,
     Titan ≈ 15.9 d (±1%).
   - Every `textures.*Url` in the pack resolves to an existing committed file.
2. Pack + textures committed; `systems-sol.json` < 64 KB; textures < 6 MB total.
3. `ATTRIBUTIONS.md` updated: Solar System Scope textures (CC BY 4.0), JPL SSD
   approximate ephemerides (§11 licensing).
4. `pnpm verify` exits 0.

## Deliverables

- `tools/pack-solar/package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`
  (texture download + `toktx` procedure, Horizons transcription procedure)
- `tools/pack-solar/data/solar-system.json` (hand-authored source incl. `jplTable1`)
- `tools/pack-solar/src/convert.ts` (table → records, pure & exported),
  `src/schema.ts` (Zod), `src/cli.ts`
- `tools/pack-solar/test/pack-solar.test.ts`, `test/ephemeris.test.ts` (Horizons
  vectors as literals)
- `apps/web/public/packs/systems-sol.json`,
  `apps/web/public/textures/sol/*.ktx2` (built, committed)
- `ATTRIBUTIONS.md` (updated)

## Context Files

- `docs/architecture.md` §5.5 (validation criteria), §5.7 (solar system pipeline),
  §9 (KTX2 mandate), §11 (licensing)
- `docs/agent-tasks/TASK-018-core-types-phase2-thaw.md` (element-axes convention)
- `packages/core-types/src/systems.ts`, `src/bodies.ts`, `src/orbits.ts`
- `tools/pack-stars/` (tool-package layout, determinism patterns to copy)
