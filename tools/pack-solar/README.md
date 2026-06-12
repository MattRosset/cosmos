# @cosmos/pack-solar

Build tool that converts a hand-authored source file into `SystemsPackManifest` JSON
(`systems-sol.json`) for the Sol system: 8 planets + 6 major moons + Saturn rings + Sol disc.

## Build

```
pnpm --filter @cosmos/pack-solar build -- --out apps/web/public
```

Writes `apps/web/public/packs/systems-sol.json`. Exits with error if any referenced
texture file is missing under `apps/web/public/textures/sol/`.

## Texture setup (manual, run once)

The build does **not** fetch textures. Download the 2k texture set from
[Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0, NASA-derived)
and place the raw `.jpg` files in a working directory. Then convert each to KTX2 using
[KTX-Software](https://github.com/KhronosGroup/KTX-Software) `toktx` (tested with
KTX-Software 4.3.0):

```bash
toktx --t2 --encode etc1s --clevel 4 --qlevel 128 --genmipmap \
  apps/web/public/textures/sol/<body>.ktx2 <body>_2k.jpg
```

Required texture filenames (place in `apps/web/public/textures/sol/`):

| KTX2 filename       | Source file          | Body          |
|---------------------|----------------------|---------------|
| `sun.ktx2`          | `sun_2k.jpg`         | Sol disc      |
| `mercury.ktx2`      | `mercury_2k.jpg`     | Mercury       |
| `venus.ktx2`        | `venus_atmosphere_2k.jpg` | Venus    |
| `earth.ktx2`        | `earth_daymap_2k.jpg`| Earth         |
| `mars.ktx2`         | `mars_2k.jpg`        | Mars          |
| `jupiter.ktx2`      | `jupiter_2k.jpg`     | Jupiter       |
| `saturn.ktx2`       | `saturn_2k.jpg`      | Saturn        |
| `saturn_ring.ktx2`  | `saturn_ring_alpha_2k.png` | Saturn ring |
| `uranus.ktx2`       | `uranus_2k.jpg`      | Uranus        |
| `neptune.ktx2`      | `neptune_2k.jpg`     | Neptune       |
| `moon.ktx2`         | `moon_2k.jpg`        | Moon          |

Commit only the `.ktx2` outputs (total payload must be < 6 MB).

## Ephemeris gate reference (test/ephemeris.test.ts)

Position vectors transcribed from JPL Horizons on 2026-06-12:
- URL: https://ssd.jpl.nasa.gov/api/horizons.api
- Ephemeris Type: VECTORS
- Coordinate Center: 500@10 (Sun body-center)
- Reference Plane: ECLIPTIC (mean ecliptic and equinox of J2000.0)
- Output Units: AU-D
- Vector Table: 2 (position only)
- Epochs (TLIST): 2451545.0 (J2000), 2433282.5 (1950-Jan-01), 2469807.5 (2050-Jan-01)
- Bodies: Mercury 199, Venus 299, Earth-Moon Barycenter 3, Mars 499,
          Jupiter 599, Saturn 699, Uranus 799, Neptune 899
