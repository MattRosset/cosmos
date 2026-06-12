# Third-Party Data Attributions

## HYG Star Database v4.1

**Source:** https://github.com/astronexus/HYG-Database  
**File used:** `hyg/CURRENT/hygdata_v41.csv`  
**License:** Public Domain (Creative Commons CC0)  
**Author:** David Nash (astronexus)

The HYG database combines data from the Hipparcos catalog (ESA), the Yale Bright Star
Catalog, and the Gliese Catalog of Nearby Stars. The combined catalog is released to
the public domain under CC0.

The raw CSV (`hygdata_v41.csv`) is **not** committed to this repository. The derived
binary pack (`apps/web/public/packs/stars.*.bin`) is committed and is itself public
domain by virtue of its source data. To regenerate the pack, see
`tools/pack-stars/README.md`.

---

## JPL Approximate Planetary Ephemerides

**Source:** E.M. Standish, "Keplerian Elements for Approximate Positions of the Major
Planets", JPL Solar System Dynamics Group  
**URL:** https://ssd.jpl.nasa.gov/planets/approx_pos.html  
**License:** Public domain (NASA/JPL government work)

Table 1 element values (valid 1800 AD–2050 AD) are transcribed verbatim into
`tools/pack-solar/data/solar-system.json` and converted at build time into the
`systems-sol.json` pack. See `tools/pack-solar/README.md`.

---

## NASA Exoplanet Archive — Planetary Systems Composite Parameters (pscomppars)

**Source:** NASA Exoplanet Archive, operated by the California Institute of Technology
(Caltech/IPAC) under contract with NASA as part of the Exoplanet Exploration Program  
**URL:** https://exoplanetarchive.ipac.caltech.edu/  
**Table:** `pscomppars` — one row per planet, composite best-value parameters  
**License:** Public domain (NASA government work; see archive data use policy)  
**Attribution:** NASA Exoplanet Archive, Caltech/IPAC

The query used to generate the data pack covers systems within 50 pc with at least
one measurable orbital parameter. The raw CSV (`pscomppars.csv`) is **not** committed.
The derived pack `apps/web/public/packs/systems-exo.json` is committed and is itself
public domain by virtue of its source data. To regenerate, see
`tools/pack-exoplanets/README.md`.

Missing orbital and physical parameters are filled deterministically using a
seeded PRNG keyed by host slug (see `tools/pack-exoplanets/src/synthesize.ts`).

---

## Solar System Scope Textures (2k)

**Source:** https://www.solarsystemscope.com/textures/  
**License:** Creative Commons Attribution 4.0 International (CC BY 4.0)  
**Attribution:** Solar System Scope (solarsystemscope.com), NASA-derived imagery

The 2k planet/moon/ring texture images (`.jpg`, `.png`) are **not** committed to this
repository. They are converted to KTX2/ETC1S format and committed as
`apps/web/public/textures/sol/*.ktx2`. The KTX2 files are derived works under the same
CC BY 4.0 license. See `tools/pack-solar/README.md` for conversion instructions.
