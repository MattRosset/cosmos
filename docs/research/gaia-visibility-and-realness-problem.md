# Gaia visibility & realness — the data behind "real stars I can't see"

A **data-first** investigation of the core product problem surfaced 2026-06-26: the cosmos ships
~3M **real** Gaia DR3 stars, but from inside the galaxy they are (a) near-invisible at the
default exposure, (b) not the dense "galaxy" look (that is procgen), and (c) their *realness*
(identity / search / pick) is not wired to anything the user can reach. So we pay the cost of a
real 3M catalog and cash almost none of its value. This doc measures everything needed to choose
a fix — it does **not** implement one.

> Working state: `App.tsx` `GAIA_OCTREE_MANIFEST_URL` is pointed at the local **3M** pack
> (`/packs/octree-gaia/octree.json`, gitignored) — left wired on purpose; this needs work.
> The committed default is `/packs/octree-gaia-sample/octree.json` (135-star CI stub).
> Prior threads: `gaia-visibility-real-pack-and-perf.md`, `bug-10-streaming-density-wall.md`
> (perf — solved), `docs/agent-tasks/procgen-near-sol-density-blend.md` (the sibling brief).

---

## 0. TL;DR — the numbers that matter

Measured by decoding the full 3M pack (884 tiles, dedup by `catalogId` → **2,961,924 unique**,
matches the `gaia-sourceids.bin` count exactly) + the HYG octree (109,399) and the live render
model (`stars.vert/frag.glsl`). Reproduction script in §7.

1. **90% of the Gaia pack is apparent magnitude 10–14** (telescope-faint). Only **0.9%** is
   brighter than mag 8; **~0.1%** brighter than naked-eye mag 6.
2. **The render model pins everything fainter than ~mag 4.6 to a 1px dot** and scales brightness
   as flux `10^(-0.4·m)·exposure`. At the **default exposure 25**, only **1.6% (47k)** of Gaia is
   individually perceptible; **0.17% (5k)** clearly visible. **98% of the pack draws nothing the
   eye resolves.**
3. **Correction to the session's eyeball claim ("looks like the 120k HYG").** Quantitatively Gaia
   is *not* nothing: at E=25 it adds **~47k perceptible / ~5k clearly-visible** stars on top of
   HYG's 58k / 11k — it **roughly doubles** the perceptible field. But the added stars sit at the
   perceptibility floor (dim), so the *visual* uplift is modest and HYG's brighter stars dominate
   the impression. "Adds little you notice" ✓; "adds nothing" ✗.
4. **The Milky-Way band IS in the real data** — and is Gaia's, not HYG's. Gaia is **1.88×**
   over-concentrated toward the galactic plane (`|b|<15°` holds 48.8% vs 25.9% isotropic); HYG is
   only **1.17×**. Also correcting the session: it is **not** an isotropic local bubble — Gaia
   reaches **kpc** (38% beyond 1 kpc, out to ~10 kpc), where HYG is 96% within 1 kpc.
5. **But the band can't be surfaced by brightening individual stars.** Median Gaia apparent mag is
   ~11.7; making the *median* star individually perceptible needs exposure **~478** (beyond the
   200 max). The plane over-density is real but mild (1.88×) and faint — it reads as a weak
   gradient, not the dramatic naked-eye band (that is the integrated glow of ~10⁸–10⁹ *unresolved*
   stars → procgen's job).
6. **Realness is unwired on all three axes** (code audit, §5): the `source_id` sidecar is never
   loaded at runtime, Gaia is absent from the search corpus, and pick is geometric (nearest-ray)
   so you cannot target a faint star you cannot see — plus the latent `idPrefix` mis-id bug.
7. **Perf is not the blocker** (§6): the 3M streams in ~10 s, `enforceBudgets` ~2 ms,
   `update()` 2–5 ms, 885 tiles resident, 0 stalls (BUG-10 P0 holds). The problem is entirely
   *visibility + wiring*, not frame time.

**The reframed problem:** Gaia carries real value the current build throws away — **kpc depth**
and a **real (if mild) Milky-Way plane structure** — hidden under an HYG-tuned exposure and an
unwired identity path. The fix is to *surface* what's there, not to add more stars.

---

## 1. The render model (the physics, from the shaders)

`packages/render-stars/src/shaders/stars.{vert,frag}.glsl.ts`:

```
// size (vertex): apparent mag m = absMag + 5·(log10(dPc) − 1)
gl_PointSize = clamp(uBasePointPx · 10^(−0.2·m), uMinPointPx, uMaxPointPx) · uPixelScale
             = clamp(8 · 10^(−0.2·m), 1, 64) · pixelScale      // defaults

// brightness (fragment), additive-blended:
brightness = clamp(10^(−0.4·m), 0, 1) · uExposure              // = flux × exposure
gl_FragColor = vec4(bvColor · brightness, softDiscAlpha · uOpacity)
```

Consequences:
- **Size saturates to the 1px floor for anything fainter than ~mag 4.6** (`8·10^(−0.2·4.6)≈1`).
  So 99%+ of both catalogs are 1px dots; only the few bright stars get bigger.
- **Brightness is the real visibility lever** — pure flux `10^(−0.4m)` times exposure, clamped to
  [0,1] *before* exposure. A mag-12.5 star has flux `10^(−5)`; at E=25 that is `2.5e-4` (black);
  at E=200, `2e-3` (barely). The eye/tonemapper needs ≳`0.01` for an isolated point.
- Output is **linear**; scene-host owns tone mapping, so absolute thresholds below are
  illustrative — the **relative** comparisons (HYG vs Gaia, E=25 vs 200) are tonemap-independent.

---

## 2. What the pack actually contains (decoded, 2,961,924 unique stars)

### 2.1 Apparent magnitude — why it's invisible (Gaia vs HYG)

| app. mag | Gaia (3M) | HYG (109k) |
|---------:|----------:|-----------:|
| <6 (naked eye) | 0.1% | 4.4% |
| 6–8 | 0.8% | 31.8% |
| 8–10 | 8.8% | 54.7% |
| **10–12** | **55.3%** | 7.6% |
| **12–14** | **35.0%** | 1.0% |

HYG is a *bright* catalog (86% brighter than mag 10); **Gaia is the opposite — 90% fainter than
mag 10.** This is by construction: Gaia's unique contribution after the HYG dedup (2″/0.5 mag) is
exactly the faint field HYG lacks.

### 2.2 Absolute magnitude + distance — these are luminous stars, seen far

Gaia abs-mag: 82.6% brighter than absMag 4 (intrinsically luminous — giants / hot MS). They are
apparently faint because they are **far**:

| distance | Gaia | HYG |
|---------:|-----:|----:|
| <300 pc | 16.4% | 71.1% |
| 300–1000 pc | 46.0% | 28.9% |
| 1–3 kpc | 32.0% | ~0% |
| 3–10 kpc | 5.6% | 0% |

**Gaia extends the catalog from HYG's ~1 kpc local sphere out to several kpc.** This is real,
navigable depth HYG does not have — the strongest argument for keeping the 3M (see §8).

### 2.3 Galactic latitude — the band IS in the data (Gaia's, not HYG's)

Isotropic expectation is uniform in `sin|b|`, so `|b|<15°` should hold **25.9%**. Measured:

| \|b\| | Gaia | (iso) | Gaia/iso | HYG |
|------:|-----:|------:|---------:|----:|
| 0–15° | **48.8%** | 25.9% | **1.88×** | 30.3% (1.17×) |
| 15–30° | 24.4% | 24.1% | 1.01× | 24.2% |
| 30–45° | 13.2% | 20.7% | 0.64× | 18.4% |
| 45–90° | 13.6% | 29.4% | 0.46× | 27.1% |

**Gaia is ~1.9× over-concentrated in the galactic plane — a real Milky-Way band in the data.**
HYG barely is (1.17×). So the band exists; the problem (§3) is it isn't rendered visibly.

---

## 3. Visibility vs exposure — the wasted pack, quantified

Counting stars whose isolated-point brightness `B = min(10^(−0.4m),1)·E` clears a threshold
(`0.01` = perceptible, `0.05` = clearly visible):

| | Gaia E=25 | Gaia E=200 | HYG E=25 | HYG E=200 |
|---|---:|---:|---:|---:|
| perceptible (B>0.01) | 47k (**1.6%**) | 614k (20.7%) | 58k (53%) | 105k (96%) |
| clearly vis (B>0.05) | 5k (**0.17%**) | 90k (3.0%) | 11k (10%) | 78k (71%) |

Readings:
- **The default exposure (25) is tuned for HYG, not Gaia.** It surfaces 53% of HYG but only 1.6%
  of Gaia. Raising to the 200 max brings Gaia to 20.7% perceptible — the "field fills in" we saw.
- **Individual brightening can't surface the bulk.** Median Gaia app-mag ≈ 11.7 → perceptible
  needs **E≈478** (> the 200 cap). So even at max, ≥50% of the pack stays sub-perceptible as
  isolated points. The band must come from **additive accumulation** of many sub-threshold stars
  per pixel (a glow), not from making each dot brighter.

---

## 4. Why the band still doesn't *look* like the Milky Way

Two real reasons, both quantified above:
1. **The over-density is mild (1.88×) and faint.** A 2× density bump in a sparse, dim field reads
   as a weak gradient, not the bright naked-eye band — which is the integrated light of **10⁸–10⁹
   unresolved** distant stars, none of which are in a 3M *resolved* subset.
2. **The brightest plane stars are the fewest.** The thin classic band comes from very distant
   plane stars (faintest, `parallax_over_error` cut thins them most), so the band's own stars are
   exactly the ones rendered dimmest.

⇒ The dramatic band is inherently **procgen's** job (the unresolved glow). Gaia's *resolved* band
is a complementary, surfaceable-but-subtle layer. This is the empirical basis for keeping procgen
near Sol (the `procgen-near-sol` brief) **and** for trying to surface Gaia's real plane structure.

---

## 5. Realness is unwired — the identity audit

The `source_id` is what makes a Gaia star *verifiably real*. None of the three paths to it work:

| path | status | evidence |
|------|--------|----------|
| **see → click it** | pick is geometric (nearest star to ray, no brightness gate, `pick.ts:11`) → blind-clicking the faint field grabs a random nearby point, not a chosen star | `packages/render-stars/src/pick.ts` |
| **click → real source_id** | the `gaia-sourceids.bin` sidecar (2.96M ids) is **never referenced in runtime code** (no hit in `apps/web/src` or `packages/data/src`); a picked Gaia star shows `gaia:<denseIndex>`, not the DR3 id | grep; ADR-006 §2 ("loaded lazily") never implemented |
| **search by name/id** | search corpus is `names.json` (named HYG only: Sol, Tau Phe…); Gaia stars have no names and aren't indexed | `packages/ui/src/SearchPalette.tsx`, `names.json` |
| (bonus) latent mis-id | Gaia sharing a tile with HYG gets bodyId `hyg-v41:<id>` not `gaia:<id>` | `octree-combined.ts` `concatBatches`, prior handoff |

ADR-006 **designed** the sidecar for provenance/search; it was never wired. So "real but
unreachable = not having it." Memory: `gaia-realness-unrealized.md`.

---

## 6. Perf baseline — NOT the blocker (3M, live, 2026-06-26)

Fresh reload at Sol, 3M pack, measured via `window.__cosmos.streaming` + `phaseMs` (rAF pumped
inside an eval; the preview tab idles to `hidden`, see `preview-tab-idle-hidden.md`):

| metric | value |
|--------|------:|
| cut (target tiles) | 754 |
| loaded → resident | 464 → **885 / 885** in ~10 s |
| `enforceBudgets` | **~2 ms** (BUG-10 P0 holds; was 384 ms) |
| `update()` total | 4.6 ms loading → **1.9 ms** settled |
| rendered points / draws | 1.81M / 300 (budget full) |
| evictions | 0 (whole pack resident, ~60 MB) |

Streaming and frame time are solved. Every remaining issue is visibility + wiring.

---

## 7. Reproduction

Decode + analysis (Node, no deps) — reads every tile, dedups by dense `catalogId`, emits the
magnitude / distance / latitude / visibility tables. Point at either pack:

```js
// node decode-gaia.cjs apps/web/public/packs/octree-gaia   (or .../octree for HYG)
const fs=require('fs'),path=require('path');
const ROOT=process.argv[2]||'apps/web/public/packs/octree-gaia';
const man=JSON.parse(fs.readFileSync(path.join(ROOT,'octree.json')));
const seen=new Uint8Array(3_200_000); let uniq=0;
for(const t of man.tiles){
  const buf=fs.readFileSync(path.join(ROOT,t.binUrl));
  const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);
  const N=t.pointCount,b=t.buffers,c=t.centerUnits;
  const pos=new Float32Array(ab,b.positionsPc.byteOffset,N*3);
  const am=new Float32Array(ab,b.absMag.byteOffset,N);
  const ids=new Uint32Array(ab,b.catalogIds.byteOffset,N);
  for(let i=0;i<N;i++){ const id=ids[i]; if(seen[id])continue; seen[id]=1; uniq++;
    const x=c[0]+pos[3*i],y=c[1]+pos[3*i+1],z=c[2]+pos[3*i+2];
    const d=Math.hypot(x,y,z)||1e-3, mApp=am[i]+5*(Math.log10(d)-1);
    /* bin mApp, d, asin(z/d), and B=min(10**(-0.4*mApp),1)*E */ }
}
```

Tile format (`octree-decode.ts`): per-tile `bin` holds `positionsPc`(f32×3N, relative to
`centerUnits`), `absMag`(f32×N), `colorIndexBV`(f32×N), `catalogIds`(u32×N), `hipIds`(u32×N) at
the manifest `buffers` byteOffsets. Units = parsecs (`rootHalfExtentUnits=65536`). Internal nodes
carry an LOD subsample (here 536,576 reads) of the leaf points — dedup by `catalogId` for the
true set.

---

## 8. Solution space (data-driven; pick by product intent)

The data converts "what is Gaia for?" into concrete, costed options. They are **not** exclusive
except where noted.

### A. Surface what's already there — exposure (S, cheap, high-leverage)
- **Per-context default exposure.** 25 is HYG-tuned; in galaxy/near-Sol the pack needs ~150–250 to
  reveal Gaia (§3). Raise the galaxy-context default and/or add **auto-exposure** that targets a
  fraction of stars perceptible. Cheap, reversible, immediately makes Gaia visible.
- ⚠ check it does not blow out HYG bright stars (they clamp at brightness 1, so likely fine) and
  does not regress the far-vantage spiral (procgen) look.

### B. Surface Gaia's real band — additive glow / density accumulation (M)
- The plane over-density is real (1.88×) but sub-perceptible per star (§4). A screen-space additive
  accumulation (bloom, or a low-LOD density splat) would let many faint plane stars **sum** into a
  visible **real** band — distinct from procgen's synthetic one. Open question whether this reads
  well or muddies; prototype + screenshot (§9).

### C. Wire the realness — identity (M, independent of visuals)
- Load `gaia-sourceids.bin` lazily; on pick/hover resolve `gaia:<index>` → real `source_id` (link
  to the ESA archive). Add Gaia to search (by `source_id`, maybe by HEALPix/region). Fix the
  `idPrefix` mis-id. Turns "real" from a claim into a feature (§5).

### D. The product fork (decide first — it gates A–C scope)
- **"To roam"** (fly-through/zoom is core) → Gaia earns its 119 MB: its **kpc depth** (§2.2) is the
  payoff. Do A + C, likely B, and design the local fly-through where real parallax is felt.
- **"To contemplate"** (park-and-look) → Gaia's resolved stars add little (§0.3); shrink to a
  credibility-sample, let HYG carry the visible sky and procgen the band. Do minimal C (provenance
  on the few visible).

### E. Procgen stays complementary (not either/or)
- Regardless of A–D, the **dramatic** band is the unresolved glow = procgen (§4). Gaia surfaces the
  *resolved* foreground + depth; procgen the *unresolved* backdrop. This is the original
  architecture §2 intent — now quantified, not assumed.

---

## 9. Open questions / next measurements

1. **A/B the visible uplift.** HYG-only vs HYG+Gaia screenshots at matched exposure/FOV/orientation
   (this session compared qualitatively only) — quantify the actual on-screen difference.
2. **Find the exposure where Gaia's band reads.** Sweep E (or auto-exposure target) at a plane-edge
   orientation; measure plane-vs-pole on-screen brightness ratio; pick the E that surfaces 1.88×.
3. **Does additive accumulation (B) surface the real band** without washing HYG? Prototype + shot.
4. **Tonemap sensitivity.** Re-derive the §3 thresholds against the actual scene-host tonemapper
   (these are linear pre-tonemap) to set the exposure target precisely.
5. **Identity wiring cost** (C): sidecar load + pick→source_id + search-by-id — scope as a task.
6. **Is 3M the right cut?** 90% is mag>10. If "to contemplate", a mag≤10 cut (~10× smaller, ~300k)
   keeps nearly all *visible* stars (§3) at a fraction of the cost — measure the visible-star loss.

---

## 10. Pointers

- Render model: `packages/render-stars/src/shaders/stars.{vert,frag}.glsl.ts`, `star-points.ts`.
- Tile format / decode: `packages/data/src/octree-decode.ts`; manifest `apps/web/public/packs/octree-gaia/octree.json`.
- Pick / search / identity: `packages/render-stars/src/pick.ts`, `packages/ui/src/SearchPalette.tsx`, `apps/web/public/packs/names.json`, `octree-combined.ts`.
- Exposure: `packages/app-state/src/settings.ts` (default 25, max 200).
- Subset definition: ADR-006; sibling brief: `docs/agent-tasks/procgen-near-sol-density-blend.md`.
- Memories: `gaia-realness-unrealized.md`, `procgen-still-belongs-real-density-sparse.md`, `preview-tab-idle-hidden.md`.
