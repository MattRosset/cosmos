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

## Gaia DR3 Star Catalog

**Source:** ESA Gaia mission, Data Release 3 (`gaiadr3.gaia_source`)  
**URL:** https://gea.esac.esa.int/archive/  
**License:** Free to use with attribution (Gaia data is released for public use)  
**Attribution:** ESA/Gaia/DPAC

This work has made use of data from the European Space Agency (ESA) mission *Gaia*
(https://www.cosmos.esa.int/gaia), processed by the *Gaia* Data Processing and
Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium).
Funding for the DPAC has been provided by national institutions, in particular the
institutions participating in the *Gaia* Multilateral Agreement.

The bright magnitude-cut subset (`phot_g_mean_mag ≤ 12.5`, see
`tools/pack-octree/src/gaia-query.adql`) is converted at build time into the
galactic-Cartesian octree pack `octree-gaia-*`. The full ~2–3M-star pack and the
raw query snapshot are **not** committed; a small region-clipped CI sample lives in
`apps/web/public/packs/octree-gaia-sample/`. To regenerate, see
`tools/pack-octree/README.md`.

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
