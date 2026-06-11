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
