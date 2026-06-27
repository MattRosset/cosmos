# Research: improving the overlay nebulae (red/green/blue) — diagnosis + how to build a better nebula effect

**Status:** **Tier A IMPLEMENTED (2026-06-27)** — see §7. Tier B/C still open. Self-contained handoff.
**Scope:** the three *overlay* nebula fields (`neb:orion`, `neb:reflection`, `neb:remnant`),
NOT the procgen galaxy dust/HII (that is a separate system — see
`galaxy-transit-procgen-floor-design.md` §10 for why they were confused).
**Captured:** 2026-06-27, close-up of the Orion field from ~130 pc (camera 398 pc from Sol).

---

## 1. What exists today (the code map)

The effect is "layered camera-facing noise billboards, additive, no ray-marching"
(architecture §5.11 — *"not volumetric ray-marching as baseline"*). Three pieces:

| Piece | File | Role |
|---|---|---|
| Field specs + layer scatter | `apps/web/src/glue/nebulae.ts` `FIELD_SPECS` / `buildLayers` | 3 fields, each 12–16 layers scattered in a sphere of radius 55–90 pc |
| Sprite texture | `apps/web/src/glue/nebulae.ts` `createNebulaNoiseTexture` | 128² fBm value-noise, alpha = `(n-0.34)*2.4 - r²·1.5` clamped |
| GPU mount | `packages/render-fx/src/nebula.ts` + `shaders/nebula.{vert,frag}.glsl.ts` | one `InstancedMesh`, 1 instance/layer, additive, `DoubleSide`, per-layer UV rotation by seed |

Data contract: `packages/core-types/src/nebula.ts` (`NebulaLayer`, `MAX_NEBULA_LAYERS = 32`).
Mounted in `apps/web/src/scene/Overlays.tsx` at full `setOpacity(1)` whenever `tier !== 'low'`,
no distance fade. Shared single noise texture across all fields/layers.

**Cost today:** 3 draw calls (one per field), ≤16 instanced quads each, one 128² texture.
Very cheap. That headroom is the opportunity — we are nowhere near the §5.11 overdraw cap.

---

## 2. Why it looks bad (diagnosis tied to the pixels)

Close-up (Orion, ~130 pc) reads as **a mosaic of hard-edged maroon "lily pads"** with a
hot pink core, not a glowing gas cloud. Specific causes, each traceable to code:

1. **Hard, crisp silhouettes ("torn-paper"/cauliflower edges).** The texture alpha is
   `Math.max(0, (n-0.34)*2.4 - r²·1.5)` — a high-contrast (×2.4) threshold with a hard
   floor. Each billboard ends in a sharp cutoff, so the stack reads as overlapping
   *cut-outs* with visible boundaries instead of feathering into one another. `nebulae.ts:153`.
2. **Discrete layers are individually legible.** Only 12–16 big quads (radius 0.45–1.0× the
   field radius = 25–90 pc each), each a different brightness/tint, hard-edged → you see the
   *quads*, like stained glass / a topographic map, not continuous medium. `nebulae.ts:49-71`.
3. **Brightness posterization / contour banding.** Additive stacking of a few hard-edged
   layers produces visible tone *steps* (each added layer is a discrete jump), not a smooth
   gradient. Worse because per-layer `opacity` is high (0.1–0.28) over few layers.
4. **Flat hue.** A field is one base color jittered ±20% (`nebulae.ts:63-67`). Real emission
   nebulae are multi-line: Hα red + [OIII] teal-green + [SII] deep red + blue reflection, with
   spatial separation (ionization fronts), plus a hot blue-white core near the exciting stars.
   The current red field is monochrome maroon → "cotton candy", not gas.
5. **No dust / no negative space structure.** Real nebulae are sculpted by *absorption* —
   dark lanes, Bok globules, pillars threading the emission. Pure additive light can only ADD,
   never carve, so there is no silhouetted dust → no depth, no recognizable structure.
6. **Texture too low-res + repetition.** 128² stretched over a 25–90 pc quad is chunky up
   close; a single shared texture rotated by seed still repeats recognizably across layers.
7. **No softening with proximity / hard field boundary.** The whole field has a defined
   spherical edge and full opacity at any range; there is no aerial-perspective falloff, no
   density taper, so it looks like a solid object you can hit rather than diffuse gas.

The §5.11 "billboards, not volumetrics" doctrine is **sound and worth keeping** — the problem
is not the technique, it is the *parameters and the sprite*. Real telescope-grade nebulae are
routinely faked with exactly this billboard-stack approach; ours just uses too few, too hard,
too monochrome layers.

---

## 3. Techniques, ranked (what makes billboard nebulae read as gas)

Ordered by impact-per-effort within the §5.11 budget (no ray-marching baseline):

### Tier A — cheap, high impact (sprite + parameters only; no new draw calls)
- **A1. Soft, feathered alpha.** Replace the hard threshold with a smooth windowed falloff:
  `alpha = smoothstep(lo,hi,n) * radialFalloff` where `radialFalloff = smoothstep(1,0.2,r)`
  (soft cosine/`exp(-k·r²)` edge, never a hard `max(0,...)` cutoff). Keeps raggedness via the
  noise but removes the cut-out edges. *(nebulae.ts texture)*
- **A2. Many more, smaller, fainter layers.** Go from 12–16 to ~28–32 layers, each smaller
  (radius 0.15–0.5× field) and much fainter (opacity 0.03–0.08). More overlap = smoother
  integral = no posterization, and small cores build internal lumpiness. Budget allows it
  (cap is 32, cost is trivial). *(nebulae.ts buildLayers)*
- **A3. Higher-res, less-repeating sprite.** 256² (or sample 2–3 octaves in the *shader*
  from a small tile so it never repeats), and use independent per-layer UV *offset* + scale,
  not just rotation, so layers truly differ. *(nebulae.ts + frag shader)*
- **A4. Multi-line color.** Per-field give 2–3 tint targets (e.g. Hα red + [OIII] teal +
  blue reflection) and assign each layer a tint by lerping along a small palette keyed to its
  radius/seed, plus a hot near-white core for the innermost layers. Instantly reads as a real
  nebula. *(nebulae.ts buildLayers colors; data already per-layer)*

### Tier B — medium effort, large realism jump
- **B1. Dust as alpha-occlusion, not just additive.** Add a second set of *dark* layers
  rendered in a normal/multiply-ish pass (or premultiplied so they darken) to carve dust
  lanes — the single biggest "this is real" cue. Needs a 2-pass or a sign in the shader.
  (Caveat: pure additive can't darken; this needs a blend-mode change for the dust layers.)
- **B2. Soft-particle depth fade.** Fade billboard alpha as it approaches scene depth so the
  cloud doesn't intersect stars/each other with a hard line (classic "soft particles"). Needs
  the depth texture. Removes billboard-clipping artifacts up close.
- **B3. Mild domain warp / curl in the sprite.** Warp the fBm by a low-freq noise so filaments
  *flow* (curl-like) instead of isotropic blobs — turns "sponge" into "gas".
- **B4. Distance/aerial fade in `Overlays.tsx`.** Taper field opacity by camera distance so
  nebulae bloom in softly instead of full-on at all ranges (also fixes the "solid object" read
  from afar, and is consistent with the procgen contract style).

### Tier C — high effort, only if A+B aren't enough (likely overkill)
- **C1. Raymarched 3D-noise volume** per field (true volumetrics). Best look, but explicitly
  the *non-baseline* per §5.11 / "attempting real volumetrics first" is a listed common
  mistake. Defer.
- **C2. Signed-distance pillars / authored density fields.** Art-directed structure; large.

**Bloom interaction:** §5.11 has selective bloom (threshold on emissive). A bright near-white
core (A4) + bloom would give the glow halo for free — worth verifying the nebula core crosses
the bloom threshold once A4 lands.

---

## 4. Recommended path

**Do Tier A first (one PR, sprite + `buildLayers` params only), measure, then decide on B.**
A1–A4 are all in `glue/nebulae.ts` (texture + layer generation) and maybe a few lines of the
fragment shader for per-layer UV offset — no architecture change, no new draw calls, stays
under `MAX_NEBULA_LAYERS`, deterministic (keep mulberry32). That alone should move it from
"hard maroon lily-pads" to "soft multi-color glowing cloud".

Then capture the same Orion close-up + a mid-distance view and judge whether B1 (dust lanes)
and B4 (distance fade) are worth the extra pass. B1 is the highest-value Tier-B item because
*absorption structure* is what most separates a real nebula photo from additive fog.

Keep C (raymarching) explicitly out of scope unless A+B demonstrably can't reach the bar.

---

## 5. Open decisions for the user (shape the work)

1. **Realism target:** "stylized pretty" (Tier A is plenty) vs "photoreal Hubble-ish"
   (needs Tier B dust + maybe C)? This sets how far to go.
2. **Dust lanes (B1)** require a non-additive pass (a blend-mode/2-pass change to the
   render-fx nebula). OK to extend `createNebula` for a dark pass, or keep strictly additive?
3. **Distance fade (B4):** should nebulae fade with range (bloom-in on approach) or stay
   full-opacity as navigation landmarks?
4. **Count/placement:** keep the 3 committed fields, or is making them look good the only
   ask (no new fields)?

---

## 6. How to reproduce the capture (empirical loop)

- Dev server `pnpm --filter @cosmos/web dev`; preview tab navigates to the real vite port
  (5173 may be taken → it falls through to 5174; point the preview browser there directly).
- Temp dev hook (add to BOTH `__cosmosDev` blocks in `App.tsx`, **remove before commit**):
  ```ts
  gotoNebula: (x, y, z, arrivePc = 160) => {
    const ctrl = controllerHolder.current; if (!ctrl) return;
    const off = Math.max(arrivePc, 1);
    ctrl.goTo({ target:{context:'galaxy',local:[x+off,y,z]},
      lookAtTarget:{context:'galaxy',local:[x,y,z]},
      arrivalDistanceM: CONTEXT_UNIT_METERS.galaxy, durationMs: 1500 });
  }
  ```
  Field origins (galaxy pc): orion `[-110,-380,-120]` r70, reflection `[420,160,90]` r55,
  remnant `[-260,540,-300]` r90. Wake the tab (canvas mousedown), `gotoNebula(...)`, wait
  ~8 s wall-clock (rAF throttled in hidden tab), screenshot. Screenshots are the trustworthy
  signal — the rAF luma probe reads black under throttling (see procgen-floor doc §8 note).

---

## 7. Tier A — implemented (2026-06-27)

Shipped A1–A4 in `apps/web/src/glue/nebulae.ts` (texture + `buildLayers`) and one shader
tweak in `packages/render-fx/src/shaders/nebula.frag.glsl.ts`. No architecture change, no
new draw calls (still 3 fields × ≤32 instanced quads), deterministic. `pnpm verify` green.

What changed:
- **A1 soft alpha**: hard `max(0, …)` cutoff → ragged-but-feathered alpha. Final formula:
  `a = (n - 0.32 - r²·0.85)·2.1`, clamp, `smoothstep` feather, × a `smoothstep01(0.95,0.5,r)`
  window that forces alpha to 0 by r≈0.92 inside the quad.
- **A2 many faint layers**: 12–16 → 28–30 layers, smaller (0.18–0.55× field), fainter
  (opacity 0.04–0.12), centre-biased (`rand^1.6`) for a denser glowing nucleus.
- **A3 sprite**: 128² → 256², 6 fBm octaves, GRID 16; per-layer UV **scale** (zoom-OUT only,
  1.0–1.6×) added to the existing rotation so layers sample different parts and don't repeat.
- **A4 multi-line colour**: each field now has primary + secondary + hot core; layers tint
  core→primary→secondary by radial position, with a `coreBoost` (HDR > 1, additive) so the
  nucleus glows (and crosses the §5.11 bloom threshold).

Two pitfalls hit and fixed (empirically, via Orion close-up screenshots):
1. **Square billboard edges** appeared once alpha was soft — the gaussian wasn't 0 at the quad
   edge and zoom-IN sampled the bright interior at the border. Fix: the `window` that zeroes
   alpha by r≈0.92 **and** restricting the shader UV scale to zoom-OUT only (≥1).
2. **Bokeh "puffs" at distance** — an over-round texture made each layer read as a clean
   circle, so from afar the stack looked like clustered bubbles. Fix: the `- r²·0.85` radial
   bias + higher contrast makes each layer a ragged wisp, not a disc.

Result (screenshots): close-up = soft glowing cloud, hot pink-white core, ragged filaments,
dark voids, magenta→purple gradient (was hard maroon lily-pads). Mid-distance = cohesive
glowing core with wispy halo (was bokeh-circle cluster). Residual: the faint periphery is
still somewhat sparse — the inherent Tier-A billboard limit; denser/photoreal needs Tier B
(dust lanes) or more layers.

**Still open (Tier B/C, separate work):** dust-lane absorption pass (B1 — biggest remaining
realism cue, needs a non-additive pass), distance fade (B4), domain-warp filaments (B3),
soft-particle depth fade (B2). Raymarched volumetrics (C) remain out of scope per §5.11.
