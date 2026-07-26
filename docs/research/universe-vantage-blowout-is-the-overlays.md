# The universe vantage is washed out by the OVERLAY layer — not the dust lanes

**Date:** 2026-07-26
**Status:** isolated by two independent ablations, quantified by framebuffer readback
**Trigger:** the "close the gap" instruction on `universe-vantage-nebula-blowout.md`, whose own
status line said *"cause strongly indicated but not isolated by ablation"*

## Headline — the previous writeup named the wrong layer

`universe-vantage-nebula-blowout.md` attributed the white universe view to the procgen **dust
lanes + HII** sprites (`packages/render-galaxy/src/dust-lanes.ts`). That is **falsified**.

Measured at the settled `◂ Universe` vantage, the wash is produced by two `packages/render-fx`
layers mounted from `apps/web/src/scene/Overlays.tsx`:

1. **the overlay nebula fields** (`createNebula`, `glue/nebulae.ts`) — 98% of the frame's light;
2. **the constellation line-set** (`createLineSet`) — full-viewport sprawl whenever
   constellations are toggled on (they default off, which is why the first observation missed it).

The dust lanes and HII regions render at **the right angular size** up there. Removing them
changes the frame by 0.06%.

## The ablation

No source was edited. The live app's WebGL context was instrumented from the page: `useProgram`
was wrapped to record the bound program, the four `draw*` entry points were wrapped to classify
the program by its vertex-shader source (`getAttachedShaders` → `getShaderSource`) and to
**skip** the draws of a chosen class. Framebuffer statistics come from `gl.readPixels` on the
default framebuffer inside a `requestAnimationFrame` registered outside three's loop — the same
"runs after three's render in the same turn, so the drawing buffer is still valid" trick that
already ships in `apps/web/src/scene/ShaderJitterProbe.tsx:154-156`.

Layer classes, by vertex-shader marker:

| class | marker | real layer |
| --- | --- | --- |
| `overlayNebula` | `aSeed` + `aCenterUnits` | `render-fx` `createNebula` |
| `dustlike:600` / `dustlike:88` | `aCenterUnits` + `aRadius`, by instance count | dust lanes (4×150) / HII (4×22) |
| `points` | `gl_PointSize` | star / procgen point clouds |
| `lineOrImpostor` | `uRenderOffset` only | constellation line-set + galaxy impostor |

### Run A — 882×910 canvas, constellations OFF (default), tier `high`, camera at 0.18 Mpc

Mean luminance over the canvas minus the 60 px HUD bands; "only X" means every other class was
skipped. The HUD floor (everything skipped) is **3.29**.

| only this layer draws | mean luma | lit px (>8) | hot px (>200) |
| --- | --- | --- | --- |
| **overlay nebula** | **250.57** | 100.0% | **98.1%** |
| dust lanes + HII | 3.45 | 0.77% | 0 |
| galaxy impostor | 3.29 (= floor) | 0 | 0 |
| procgen star points | 3.99 | 0.61% | 0.19% |
| nothing (HUD only) | 3.29 | 0 | 0 |

Full frame: **250.58**. Skipping only the overlay nebula: **4.13**. Skipping only the dust/HII:
**250.57** — a change of 0.01, i.e. 0.004% of the effect.

### Run B — 882×415 canvas, constellations ON, tier pinned `high`, camera exactly 0.18 Mpc

| frame | mean luma | lit px | bounding box of lit pixels |
| --- | --- | --- | --- |
| all layers | **234.30** | 260,190 (100%) | 0…881 × 60…354 (whole viewport) |
| − overlay nebula | 4.36 | 4,052 | still whole viewport |
| − overlay nebula − line-set | **3.77** | 1,711 | **411…470 × 179…236 (60 × 58 px)** |

The third row is the point: with both overlay layers gone, everything that remains — procgen
cloud, dust lanes, HII, impostor — collapses to **one bounded 60 × 58 px object at the screen
centre**. That is a correctly-sized Milky Way at 0.18 Mpc.

### Run C — the independent confirmation

At the same vantage, flipping the quality tier alone reproduces the defect: `low` → clean
spiral, `high` → white screen, no other change. `nebulaeAllowed = tier !== 'low'`
(`Overlays.tsx:48`) gates exactly one thing — the overlay nebula layer. Two methods that share
no mechanism agree on the same culprit.

## Why the dust lanes are innocent — and why the arithmetic and the screen agree

The bug class is one unit mismatch, but it lands differently depending on **which** quantities
are wrong.

`OriginManager.toRenderSpace` returns ACTIVE-CONTEXT units. In `universe`, 1 unit = 1 Mpc, so
`pcScales('universe')` is `unitsToPc = 1e6`, `pcToUnits = 1e-6`.

**Dust lanes / HII — uniformly wrong, therefore angularly right.** `GalaxyScene.tsx:566-568`
converts the offset to parsecs, and `buildDustLanes` supplies centres and radii in parsecs. The
shader then treats *all three* as context units. Every length in the layer — centre, offset and
radius — is inflated by the same 1e6. A perspective projection is invariant under a uniform
scaling of the whole scene about the eye, so the **angular** size is unchanged; only the depth
value moves, and the camera's far plane is effectively infinite here (measured from the
projection matrix: `near = 1.0e-6`, `far = ∞`), so nothing is clipped. Measured proof: the dust
layer's lit-pixel bounding box is **119 × 120 px, centroid (440.2, 454.5)**, against the
known-correct (post-TASK-081) procgen cloud's **131 × 126 px, centroid (440.4, 455.1)**. They
sit on top of each other.

**Overlay nebula / line-set — non-uniformly wrong, therefore blown out.** `Overlays.tsx:129`
and `:116` pass `toRenderSpace`'s output **raw**, in context units, with no `unitsToPc`
conversion. But the per-instance data is parsecs: `nebulae.ts:129` sets
`radiusUnits = spec.radiusPc * (0.18 + 0.37 · rand)`, and `glue/overlays.ts:43-44` copies
`segmentsPc` straight into `segmentsF32`. So the **offset is right and the geometry is 1e6×
too big**. Measured `uRenderOffset` read back off the GPU at the 0.18 Mpc vantage:

```
neb:orion       [-0.00011, -0.00038, -0.18012]   (universe units — correct)
neb:reflection  [ 0.00042,  0.00016, -0.17991]
neb:remnant     [-0.00026,  0.00054, -0.18030]
```

against `aRadius` values of **9.9 … 49.5** in the same units. A billboard whose half-width is
~25 units, centred 0.18 units in front of the eye, covers the viewport many times over — the
camera is *inside* it. Correct would be `70 pc × 1e-6 = 7e-5` units, an angular half-size of
~4e-4 rad ⇒ **0.06–0.22 px**: at 180 kpc a 70 pc nebula is sub-pixel and should be invisible.

This is why the naive "it should be far away and small" derivation felt wrong. It is right —
for the dust lanes, which is not the layer that blows up.

## Where the defect is, precisely

| site | offset unit passed | geometry unit | outcome outside `galaxy` |
| --- | --- | --- | --- |
| `GalaxyScene.tsx:279-283` (dust, HII, impostor) | parsecs | parsecs | uniform ⇒ angularly correct, depth 1e6× off |
| `Overlays.tsx:116` (line-set) | **context units** | parsecs | **1e6× oversized in `universe`** |
| `Overlays.tsx:129` (nebula) | **context units** | parsecs | **1e6× oversized in `universe`** |
| `StarScene.tsx:177-192`, `GalaxyScene.tsx:539` | parsecs + `setContextScale` | parsecs | correct (TASK-081) |

`Overlays.tsx` is the only remaining per-frame callback in the app that hands a renderer a raw
`toRenderSpace` result. It is also the only one whose `origin`/`controllerRef` are already in
scope for `pcScales`, so the fix is the shipped TASK-081 pattern verbatim.

## The direction reverses in `system` context (derived, NOT measured)

`pcScales('system').pcToUnits ≈ 206,265`, so the same mismatch makes the overlay geometry
206,265× **too small** there — the nebulae and constellation figures should vanish rather than
swell. From Earth, `neb:orion` (70 pc at ~415 pc) subtends ~19°, so this is a real loss, not a
cosmetic one. **This half is arithmetic, not measurement**: the live attempt failed because the
`flythrough3` probe's render loop is not running once it settles at Earth (zero draw calls
captured over several seconds, `readPixels` all black while the composited image persists), so
no frame was available to read. Re-derive before relying on it.

## Two traps this investigation walked into — worth keeping

1. **A per-layer measurement is not a claim about the frame.** This is the second time in three
   days. `galaxy-impostor-scale-is-inert.md` measured the impostor and concluded the universe
   view was fine; `universe-vantage-nebula-blowout.md` then looked at the frame but attributed
   it by elimination *within the procgen mount*, never asking what else was on screen. The
   overlay layer is mounted by a different component and was outside both frames of reference.
   The cheap general fix is the one used here: classify **every draw call** in the frame, then
   subtract.
2. **The quality tier can make a visual gate vacuous.** `nebulaeAllowed = tier !== 'low'`. When
   the preview tab was throttled the `PerformanceMonitor` dropped to `low`, the nebula layer
   stopped drawing, and the universe vantage looked *correct* — the defect vanished for reasons
   unrelated to the code under test. Any deterministic gate on this defect must pin the tier
   (`window.__cosmosDev.setTier('high')`, wired at `StarApp.tsx:498`) or it can pass on a slow
   CI runner while the bug is fully present.

## Related

- `docs/agent-tasks/TASK-085-overlay-context-scale.md` — the executable fix
- `docs/research/universe-vantage-nebula-blowout.md` — the writeup this corrects
- `docs/research/star-sprite-goes-dark-on-system-entry.md` — TASK-081, where the class was found
- `docs/research/galaxy-impostor-scale-is-inert.md` — the impostor half (TASK-082)
