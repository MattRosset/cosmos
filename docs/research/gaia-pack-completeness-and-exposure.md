# Gaia pack completeness (MAXREC holes), the full 4.7M rebuild, exposure & perf

Companion to `gaia-visibility-and-realness-problem.md`. That doc measured *why Gaia isn't seen*;
this one records what we **did** about it in the 2026-06-26 session: diagnosed + fixed a coverage
defect in the pack, landed the exposure fix (Option 1), and validated performance with the full
catalog. All measurements are reproducible (scripts/queries in §6).

> Working state (uncommitted, local): `App.tsx` `GAIA_OCTREE_MANIFEST_URL` → `/packs/octree-gaia`
> (now the **4.63M** pack, gitignored); `GalaxyScene.tsx` has `GALAXY_FIELD_EXPOSURE_BOOST`. The
> committed default URL is still the 135-star sample.

---

## 0. TL;DR

1. **The "marked line" was NOT a HYG+Gaia merge bug** — it was **coverage holes** in the 3M Gaia
   pack. The ESA async `MAXREC = 3M` truncated the `G ≤ 12.5` subset (~4.7M), and because the Gaia
   `source_id` is ≈ HEALPix-ordered, the cutoff dropped **contiguous sky regions** → hard empty
   wedges → a straight density edge in the render. Diagnosed by a sky-map of decoded positions
   (empty cells at galactic l≈270–330°; sharpest longitude jump **4.0×**).
2. **Fixed by rebuilding from the COMPLETE subset.** Re-pulled all **4,683,171** sources (`G ≤ 12.5`,
   `parallax > 0`, `parallax_over_error ≥ 5`) in **2 magnitude tranches** (each < 3M, under MAXREC),
   concatenated, rebuilt → **4,629,554 stars** (53,617 dedup vs HYG), **1267 tiles**, all-sky
   complete: **zero empty cells, longitude jump 1.2×**. The marked line is gone (data + visual).
3. **Option 1 (exposure) implemented.** `GALAXY_FIELD_EXPOSURE_BOOST = 6` in `GalaxyScene` boosts
   **only the octree field** (default slider 25 → effective ~150) so Gaia is visible **without
   touching the control**; StarScene/SystemScene/procgen untouched, slider stays a relative trim.
   Typecheck green, verified live.
4. **Optimal cut tracks exposure:** `cut ≈ 5 + 2.5·log10(E)`. The cut is a *cost* lever, exposure a
   *visibility* lever — independent (a brighter cut removes only already-invisible faint stars). The
   deep pack is over-built for static viewing but **justified by the telescope feature** (faint
   stars become the zoom payoff — `telescope-effect-magnitude-reveal.md`).
5. **Perf fully maintained with 4.63M:** 163 fps static, moving, AND during a 40 kpc `goTo` flight;
   evictions fire correctly (residency 1268→140 tiles, 1128 evictions, **0 thrash**); `enforce`
   ≤5 ms. The BUG-10 P0 O(n) enforce scales; the 1.5× bigger pack cost ~1 ms.

---

## 1. The marked-line diagnosis — sky-map of decoded positions

A user saw a **sharp straight diagonal edge** in the star field and suspected the two packs weren't
merging. A straight edge ⇒ a *plane in 3D projected to a line*. To test data-vs-render, decoded the
Gaia octree's actual positions and binned them on-sky in galactic (l, b) (`§6` `sky-map.cjs`).

**3M pack (truncated) — holes:**
```
  b\l :     0    30    60    90   120   150   180   210   240   270   300   330
 -15..0:  148k    2k   50k  118k   86k   56k   72k   99k   58k     .     .   87k
-45..-30:   21k   22k   23k   21k   20k   15k   19k   21k    7k     .     .    0k
```
`.` = **empty cell**. Whole longitude strips (l ≈ 270–330°, and a depressed l ≈ 30–60°) are empty at
low latitudes — not astronomy (Gaia is all-sky; the plane should be dense at every longitude). The
real galactic plane *does* show (b≈0 densest), so the physics is right; **chunks of sky are simply
missing**. Sharpest adjacent-longitude jump: **4.0×**. The marked line = the edge of a hole.

**Cause:** the pack was built from a `MAXREC = 3M`-capped ESA async result (2.96M of 4.7M). Gaia
`source_id` encodes HEALPix position, so truncating the result by source_id ≈ truncating by sky
region → a contiguous missing wedge. (The prior thread's "all-sky, RA 0–360 verified" check was too
coarse to catch the interior holes.) **Not** BUG-8 / the combine — this is the Gaia octree decoded
alone, no HYG involved.

---

## 2. The full 4.7M rebuild

**Exact counts** (ESA TAP `COUNT(*)`, `§6`):
| cut | count |
|-----|------:|
| `G ≤ 12.5` (full subset) | **4,683,171** |
| `G ≤ 11.0` | 1,228,160 |
| `G ≤ 11.5` | 1,937,516 |
| `G ≤ 12.0` | 3,025,260 |

**Paging under MAXREC** — split at 11.5 so each query < 3M:
- Tranche A: `G ≤ 11.5` → 1,937,516
- Tranche B: `11.5 < G ≤ 12.5` → 2,745,655

Downloaded both via the ESA async TAP (CSV, ~185 MB + ~264 MB), concatenated (B minus header) →
4,683,171 rows. Built with `tools/pack-octree build:gaia` (the committed stack-overflow + dedup-index
fixes make a 4.7M build tractable). Result: **4,629,554 surviving stars** (53,617 dropped: HYG dedup
within 2″/0.5 mag + parallax clip), **1267 tiles**, `rootHalfExtentUnits = 65536`.

**Verification — holes gone:**
| metric | 3M (truncated) | 4.63M (complete) |
|--------|---------------:|-----------------:|
| empty sky cells | several (l≈270–330) | **0** |
| sharpest longitude jump | 4.0× | **1.2×** |
| stars | 2,961,924 | **4,629,554** |

The sky-map is now smooth across all longitudes; the galactic plane is dense everywhere (b≈0 rows
57k–179k). Visually the diagonal edge is gone — a smooth field with only the real plane gradient.

---

## 3. Option 1 — exposure boost (implemented & verified)

**Problem (from the visibility doc §3):** default exposure 25 is HYG-tuned; it leaves ~98% of the
Gaia field sub-threshold. **Fix:** `GALAXY_FIELD_EXPOSURE_BOOST = 6` in
`apps/web/src/scene/GalaxyScene.tsx`, multiplied into the octree mount's `setExposure` (both the
initial mount and the store-subscription path), exactly like the procgen `CLOUD_EXPOSURE_BOOST`.

- **Scope:** only the galaxy octree field. StarScene (near-Sol HYG), SystemScene (atmosphere) and
  the procgen cloud are untouched. The slider stays a *relative* trim on top of the boosted base.
- **Value choice (measured live):** ×4 (eff ~100) reveals stars but they sit at the dim floor (mag
  8.5–10, brightness ~0.01) → subtle. Effective ~150–200 "reads as a rich sky". ×6 → eff ~150 at the
  default slider: Gaia clearly visible untouched, headroom left, bright stars clamp (flux 1) so no
  blow-out. `web` typecheck green.

This is the *static* form of the **telescope effect** (`telescope-effect-magnitude-reveal.md`): the
same `uExposure` lever, made dynamic (FOV/zoom-coupled) there.

---

## 4. Optimal cut vs exposure (the cut/cost lever)

A brighter magnitude cut does **not** add visibility — it removes faint stars that were already
invisible. The visible set is fixed by the bright end (post-HYG-dedup). The cut is a **cost** lever;
exposure is the **visibility** lever. But the *optimal* cut depends on the chosen exposure, because
exposure sets the visibility threshold `m < 5 + 2.5·log10(E)`:

| default exposure | matched cut (mag) | stars (full rebuild) | size |
|-----------------:|------------------:|---------------------:|-----:|
| 25× | 8.5 | 75k | 3 MB |
| 100× | 10.0 | 455k | 18 MB |
| 150× (our default) | 10.4 | 716k | 29 MB |
| 200× | 10.75 | 975k | 39 MB |

So **for static viewing** the full 4.63M / ~90 MB is over-built (at eff-150 only ~0.7M are
individually visible; the rest only feed additive glow). **Two reasons to keep it deep anyway:**
(a) the **telescope feature** makes the faint tail the zoom payoff; (b) **completeness** — a
`G ≤ 11` cut (1.24M) also conveniently fits under MAXREC in *one* query (no paging, no holes), so if
the product goes "contemplate" (no telescope), `G ≤ 11` is the clean cheap+complete pack.

---

## 5. Performance validation — 4.63M pack (live, 2026-06-26)

Measured via `window.__cosmos.streaming` (`phaseMs`) + rAF frame-interval timing inside an eval
(preview tab woken per `preview-tab-idle-hidden`). Preview is **not** vsync-capped (baseline 163 fps).

| scenario | fps | enforce / update | residency |
|----------|----:|-----------------:|-----------|
| **static at Sol** | 163 | 3.1 / 3.4 ms | 1268 tiles, 0 evict |
| **moving (Shift+W, 240f)** | 163 | ≤5 / ≤5.3 ms | 1268 stable, inFlight 0, 0 evict |
| **goTo flight Sol→40 kpc** | ~163 (worst frame 23 ms) | ≤4.1 ms | **1268→140, 1128 evict, inFlight 0** |

Flight detail (cut/residency track the view as you fly out, evictions reclaim left-cut tiles, no
re-load churn):
| dist | cut | loaded | evictions | inFlight | update |
|-----:|----:|-------:|----------:|---------:|-------:|
| 177 pc | 1094 | 1268 | 0 | 0 | 3.5 ms |
| 14.5 kpc | 226 | 356 | 912 | 0 | 0.2 ms |
| 40 kpc | 107 | 140 | 1128 | 0 | 0 ms |

**Verdict:** the full catalog does not degrade anything. Static, moving, and the demanding long
flight all hold ~163 fps; residency is bounded and drops correctly on flyout (no leak); evictions
fire; **no thrash** (inFlight 0). The BUG-10 P0 O(n) `enforceBudgets` scales — the 1.5× larger pack
cost ~1 ms on the static enforce (2 → 3 ms). Baselines: 135-sample 164 fps, 3M 164 fps, 4.63M 163 fps.

---

## 6. Reproduction

**Sky-map (holes detector)** — `sky-map.cjs`: decode every tile, dedup by `catalogId`, bin galactic
(l,b) from positions (`l=atan2(y,x)`, `b=asin(z/r)`), print a 12×12 grid + sharpest longitude jump.
Point at `apps/web/public/packs/octree-gaia`.

**Exact counts (ESA TAP sync):**
```sh
curl -s "https://gea.esac.esa.int/tap-server/tap/sync" \
 --data-urlencode REQUEST=doQuery --data-urlencode LANG=ADQL --data-urlencode FORMAT=csv \
 --data-urlencode "QUERY=SELECT COUNT(*) FROM gaiadr3.gaia_source WHERE phot_g_mean_mag<=11.5 AND parallax>0 AND parallax_over_error>=5"
# (ADQL 2.0 here: no FLOOR/CASE in GROUP BY — use separate COUNT queries per threshold)
```

**Paged full pull (async, each tranche < MAXREC 3M):**
```sh
# submit (returns job URL in Location header); repeat for B with phot_g_mean_mag>11.5
curl -s -D - "https://gea.esac.esa.int/tap-server/tap/async" \
 --data-urlencode REQUEST=doQuery --data-urlencode LANG=ADQL --data-urlencode FORMAT=csv --data-urlencode PHASE=RUN \
 --data-urlencode "QUERY=SELECT source_id,ra,dec,parallax,phot_g_mean_mag,bp_rp FROM gaiadr3.gaia_source WHERE phot_g_mean_mag<=11.5 AND parallax>0 AND parallax_over_error>=5"
# poll <job>/phase → COMPLETED; then curl --compressed <job>/results/result -o snapshotA.csv
cp snapshotA.csv snapshot-full.csv && tail -n +2 snapshotB.csv >> snapshot-full.csv   # concat
```

**Build:**
```sh
pnpm --filter @cosmos/pack-octree build:gaia -- \
  --snapshot "$ABS/snapshot-full.csv" \
  --hyg      "$ABS/apps/web/public/packs" \
  --out      "$ABS/apps/web/public/packs/octree-gaia"     # absolute paths (pnpm --filter cwd)
```

**Perf:** `GALAXY_OCTREE_MANIFEST_URL` → the local pack, then in the live app pump rAF inside a
`preview_eval` recording `performance.now()` deltas + `window.__cosmos.streaming.phaseMs`; for the
flight, `.click()` the `◂ Milky Way` breadcrumb (`hud-breadcrumb-exit`) and sample through it.

---

## 7. Status / open items

- **Done:** holes diagnosed + fixed (4.63M complete pack), Option 1 exposure boost landed + verified,
  perf validated.
- **Uncommitted code:** `GalaxyScene.tsx` boost (taste-tunable ×6), `App.tsx` local-pack URL (must
  NOT commit — gitignored pack). Decide whether to ship the boost.
- **Pack distribution:** the 4.63M pack (~90 MB GPU, ~1267 tiles) is local/gitignored. For deploy:
  R2/CDN + `VITE_GAIA_OCTREE_URL` (see `gaia-visibility-real-pack-and-perf.md` §8), or ship the
  `G ≤ 11` single-query complete pack if "contemplate".
- **Next:** the telescope effect (`telescope-effect-magnitude-reveal.md`) — makes the deep pack pay
  off; and the identity wiring (visibility doc §5) so a zoomed-in star is clickable/real.
- **Cut decision** is now: telescope → keep deep (4.63M); contemplate → `G ≤ 11` complete (1.24M).
