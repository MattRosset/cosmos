# ADR-006: Gaia DR3 Subset Definition & Render-Tier Unification

**Status:** Accepted
**Date:** 2026-06-21
**Refines:** architecture §5.7 (Gaia DR3 subset, brightest ~2–5M, spatially tiled into
an octree of `.bin` tiles), §2 (real catalogs for credibility; procedural only beyond
catalog reach; indistinguishable to the renderer), §11 (reproducible packs, attribution)
**Builds on:** [ADR-003](ADR-003-octree-tiling.md) (the frozen octree tile format)
**Formalizes:** [`docs/research/phase4-render-tier-handoff.md`](../research/phase4-render-tier-handoff.md)

## Context

Phase 4 introduces the **Gaia DR3 tiled subset** (architecture §6 Phase 4, §5.7). Two
things must be pinned that span several tasks:

1. **What "the Gaia subset" *is*** — source, magnitude cut, column→unit conversion, and
   dedup against the existing HYG catalog — so `tools/pack-octree` v2 (TASK-043) produces
   a reproducible pack and the loader/streaming consume it without special-casing.
2. **The render-tier unification** — M3 intentionally draws three overlapping star layers
   near Sol (monolithic HYG `StarScene`, streaming octree tiles, procedural Milky Way
   cloud). `phase4-render-tier-handoff.md` flagged that Phase-4 Gaia tiling is the trigger
   to collapse to **one authoritative layer per scale**. That policy is shared by the pack
   (TASK-043), the streaming coverage signal (TASK-044), the M4a integration (TASK-052),
   and the gate's budget assertion (TASK-053).

ADR-003 already froze the octree tile format and explicitly anticipated "Gaia in Phase 4".
**This ADR adds no new tile format** — Gaia reuses ADR-003 to the bit. It pins only the
*Gaia-specific build inputs* and the *tier-unification policy*.

## Decision

### 1. Source & magnitude cut (the subset definition)

- **Source:** Gaia DR3 `gaia_source` via the official ESA Gaia Archive TAP/ADQL service.
  The build pins an **exact ADQL query** (committed in the tool) and a **cached query
  snapshot** (a content-hashed CSV/Parquet the build reads); the live download is a
  separate, manual refresh step (network fetches are not reproducible in CI, §11).
- **Magnitude cut:** phot G mean magnitude **`phot_g_mean_mag ≤ 12.5`**, AND a valid
  positive parallax (`parallax > 0`, `parallax_over_error ≥ 5`). This yields **≈ 2–3M**
  sources — within architecture §5.7's "brightest ~2–5M" and §14's "capped at 5M" budget.
  (The cut is a *number*, frozen here; raising it toward 5M is a future reviewed task.)
- **Required columns:** `source_id`, `ra`, `dec`, `parallax`, `phot_g_mean_mag`,
  `bp_rp` (the BP−RP color), `pseudocolour` not required.

### 2. Conversion to the canonical frame (matches HYG, different columns)

Per body, at **build time** (never runtime, §5.7):

- Distance `d_pc = 1000 / parallax_mas`.
- Equatorial (ICRS) RA/Dec + distance → **galactic Cartesian parsecs** using the same
  ICRS→galactic rotation `tools/pack-stars` already applies to HYG (reuse that transform;
  do not re-derive — the two catalogs must land in the identical frame, ADR-001).
- **Absolute magnitude** `absMag = phot_g_mean_mag + 5·(log10(parallax_mas) − 2)`
  (i.e. `G + 5 − 5·log10(d_pc)`). Documented approximation: Gaia `G` is used directly as
  the visual magnitude proxy (no G→V color term) — consistent with how the renderer treats
  `absMag` as a sizing proxy, §5.9.
- **B–V color index** from `bp_rp` via the pinned linear fit
  `colorIndexBV = 0.85 · bp_rp − 0.06` (documented BP−RP→B−V approximation; one source of
  truth here). Clamp to `[-0.4, 2.0]`.
- **catalogIds:** the Gaia `source_id` is a 64-bit int that does not fit the octree's
  `Uint32Array catalogIds` (ADR-003 §3) — assign a **dense 0-based index** as `catalogIds[i]`
  and set the manifest `idPrefix = "gaia"`, so `BodyId = "gaia:<index>"`. The original
  `source_id` is preserved in a side `gaia-sourceids.bin` (Float64/BigInt64 sidecar, NOT a
  tile attribute) for provenance/search, loaded lazily; it is **not** required by the
  renderer. `hipIds[i] = 0` (Gaia has no HIP; HIP cross-match is out of scope here).

### 3. Dedup against HYG

A Gaia source is **dropped from the pack** when it duplicates an HYG star already shipped:
match on angular position within **2 arcsec** AND magnitude within **0.5 mag** of an HYG
entry. (HYG is the brighter, named, hand-curated set — it stays authoritative for the
nearest/brightest stars and their names; Gaia fills the fainter field.) The dedup uses the
HYG pack as build input; the rule is deterministic so the pack stays reproducible.

### 4. Pack output, reproducibility & distribution

- Output is an **ADR-003 octree pack** (manifest + tiles), `source: "gaia-dr3-bright"`,
  `context: 'galaxy'`, `idPrefix: "gaia"`, **same `rootHalfExtentUnits = 65536` pc** as the
  HYG octree so the two trees share a frame.
- **Reproducible:** same cached snapshot + same build params → byte-identical tiles +
  manifest (content hashes stable, §11), exactly like `tools/pack-octree` Phase-3 output.
- **Distribution:** the full ~2–3M pack is **too large to commit** (the reason the
  octree/streaming infra exists). Git holds a **small committed CI sample** (a
  magnitude-tightened or region-clipped subset, ≤ a few hundred KB, like the existing
  `tools/pack-octree` sample) under `apps/web/public/packs/octree-gaia-sample/`; the full
  pack is built and deployed to the CDN out-of-band (§12 "data packs deploy independently").
- **Attribution (§11):** Gaia is free *with attribution* — `ATTRIBUTIONS.md` and the
  in-app About panel must credit *"ESA/Gaia/DPAC"*. The build fails if the credit line is
  absent (a tool assertion).

### 5. Render-tier unification policy (formalizes the handoff doc)

Target model (one authoritative source per scale; `phase4-render-tier-handoff.md` §3):

```
Scale / context        Authoritative source        Procgen role
─────────────────────────────────────────────────────────────────
universe (far)         impostor + coarse procgen    far-LOD billboard (KEEP)
galaxy (mid, arms)     octree tiles (HYG + Gaia)     cross-fade out as tiles cover the cut
galaxy (near Sol)      octree tiles only             OFF (opacity 0, mount hidden)
system / planet        system pack + local tile      OFF
```

Rules, binding on TASK-052 and asserted by TASK-053:

1. **Coverage-gated procgen fade.** Procgen-cloud opacity → 0 when the octree provides
   ready tiles for the full visible cut (no pending/in-flight gaps). The enabling
   primitive is a **streaming "catalog covers the cut" signal** (TASK-044) replacing the
   hard-coded `GAL_PROCGEN_FLOOR` from M3.
2. **No catalog drawn twice.** The monolithic M2 `StarScene` (HYG `stars.bin`) is gated or
   retired once octree tiles (HYG + Gaia) provide the same coverage — do not draw the same
   stars as both a monolith and tiles.
3. **Single `StarBatch` contract.** The renderer is unchanged; only the *producer*
   (octree tile vs procgen vs legacy monolith) switches by policy. Gaia tiles render via
   the existing `render-stars` point machinery (ADR-003 §3: tiles reuse the star-pack
   layout).
4. **Acceptance = budgets improve.** On the M3 flight path, `renderedPoints` and draw
   calls **near Sol** must **drop** versus the M3 baseline (fewer redundant layers), never
   rise — even though Gaia adds far more total stars to the field. This is the gate's
   measurable success criterion (TASK-053).

## Alternatives Considered

- **Synthetic dense catalog instead of real Gaia:** would exercise the streaming path but
  forfeits the §2 credibility goal; rejected (real DR3 chosen).
- **A new Gaia-specific tile format:** ADR-003 was authored to absorb Gaia unchanged;
  a second format would fork the loader/streaming; rejected.
- **64-bit `source_id` as the catalog id:** the tile attribute is `Uint32Array` (ADR-003);
  widening it would break the frozen format. Dense index + sidecar chosen instead.
- **Merging `StarScene` + `GalaxyScene` into one React tree:** the handoff doc §6 calls
  this out as a separate design task; policy-level unification (one layer draws per scale)
  is sufficient for M4a and avoids a risky refactor; deferred.

## Consequences

- `tools/pack-octree` v2 (TASK-043) gains a Gaia ingest mode transcribing §1–§4; it reuses
  the HYG ICRS→galactic transform and emits an ADR-003 pack; commits the CI sample +
  attribution.
- `streaming` v1.1 (TASK-044) exposes the §5.1 coverage signal additively (no change to
  budgets/eviction).
- The M4a integration (TASK-052) applies §5's policy: coverage-gated procgen fade, gate the
  HYG monolith, render Gaia tiles through the existing star machinery.
- The Phase-4a gate (TASK-053) asserts §5.4 (near-Sol budgets drop vs M3) and the
  attribution presence.
- Raising the magnitude cut, changing the conversion fits, or the dedup tolerances changes
  pack hashes — a new reviewed task, not a silent tweak.
