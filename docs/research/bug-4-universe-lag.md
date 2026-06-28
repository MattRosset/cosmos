# BUG-4 — Universe-view lag: what it is and whether it is still live

Research pass (2026-06-28) re-scoping BUG-4 after the procgen-floor + nebula commits that
landed since the original 2026-06-24 measurement. Question from the user: *what does this
bug actually refer to, and is it still vigente?*

**TL;DR.** BUG-4 is the far-out "universe" view (the recorded path's `toGalaxy` segment)
costing far more GPU than the inner segments because the full ~1.1M-point procedural Milky
Way cloud is drawn as **additive sprites** that cover the whole galaxy disc from outside →
massive **overdraw** (a fill-rate cost, not CPU). **It is still structurally present** — the
cloud still full-draws at the universe vantage (`drawFraction` is hardwired to `1`,
`procgenBlend = 1` there) and the recent `51e0f17` commit only removed the *in-flight* draw
cap, explicitly keeping full draw at the resting far vantage. **But whether it manifests as
visible lag is GPU/resolution-dependent.** Re-measured on this dev machine (AMD Radeon RX
9070 XT) the universe frame is the single most GPU-expensive segment — but only **0.37 ms**
median, i.e. invisible here. The original "40 ms" was a real GPU-bound stall on weaker
hardware (and CI SwiftShader). So BUG-4 is a **latent fill-rate cliff**: real, unchanged,
and it will bite on integrated/low-end GPUs, high-DPI/4K, or large windows — just not on a
high-end discrete GPU.

---

## 1. What the bug refers to

The committed flythrough path (`flythrough3-path.json`) descends:
**outside the Milky Way (universe) → spiral arms → star field → Sol → Earth.**
The probe (`?debug=flythrough4`, `Flythrough4Probe.tsx`) splits it into three coarse
segments: `toGalaxy` (the far-out universe view), `toSol`, `toEarth`.

BUG-4 = the `toGalaxy` segment runs much slower than the inner two. The 2026-06-24 handoff
(`docs/agent-tasks/TASK-052-integration-bugs.md` §BUG-4) measured, real-browser Chromium:

| segment | M3 p50 | M4a p50 |
|---------|--------|---------|
| toGalaxy (universe) | 44.3 ms | **40.0 ms** |
| toSol | 16.6 ms | 16.8 ms |
| toEarth | 16.6 ms | 16.7 ms |

and concluded (CPU spans all < 0.3 ms/frame) that it is **GPU fill-rate**, tier-independent
(M3 ≈ M4a), caused by the procgen cloud's overdraw, not point *size* (already clamped via
`uMaxPointPx`) — the cost is the **count** of overlapping additive points filling the disc.

## 2. Mechanism (confirmed in the current code)

`apps/web/src/scene/GalaxyScene.tsx`:
- In the **universe** context, `procgenBlend` stays `1` (the `if (ctx === 'galaxy')`
  distance-fade block does not apply — from outside, the procgen cloud *is* the galaxy and
  must render at full). So the cloud is fully on.
- `drawFraction` is **hardwired to `1`** (`const drawFraction = 1;`, line ~466). The comment
  is explicit that it is a *perf-only* knob deliberately left at 1: opacity (`procgenBlend`)
  is the sole visual fade so stars + nebula sprites fade together (avoiding the "nebulas
  without stars" P2 regression). So all ~1.1M points are submitted whenever the layer is on.
- The cloud (`createGalaxyPoints`) draws with `AdditiveBlending`, `depthWrite:false` →
  every covered fragment is shaded and blended. **Overdraw cost is per-fragment and largely
  independent of opacity** — even at low `procgenBlend` the fragments still rasterize. From
  the universe vantage the disc fills most of the screen, so the overdraw factor is high.

### Did the recent commits change it?
No — they preserved it on purpose:
- **`51e0f17`** (procgen floor B+E) **dropped only the in-flight draw cap**
  (`GAL_FLIGHT_DRAW_MAX`). Its own comment: *"The resting far vantage already full-draws the
  1M-point cloud continuously, so full draw in the mid-band during flight adds no new worst
  case."* i.e. the universe-vantage full draw (the BUG-4 case) was already there and was kept.
- **`4929d6d`** (nebula Tier A) added more faint additive layers, but those are the local
  `NEBULA_FIELDS` (≤ 600 pc near Sol), capped off on the `low` tier; they are not the
  galaxy-scale universe overdraw and subtend little from the ~49 kpc vantage.

## 3. Re-measurement (2026-06-28, AMD Radeon RX 9070 XT, ANGLE/D3D11)

### 3a. Scene work — unchanged, full cloud at the universe vantage
`?debug=flythrough4` (m4a), per-segment peak `gl.info.render`:

| segment | peak scene points | procgen opacity | sceneDraws |
|---------|------------------:|:---------------:|:----------:|
| **toGalaxy** | **1,109,970** | **1 → 1** | 47 |
| toSol | 1,109,970 | 0 → 1 | 47 |
| toEarth | 109,970 | 1 → 1 | 36 |

The universe segment draws the full ~1.11M-point cloud at opacity 1 — exactly the BUG-4
load. (toSol peaks at the same count at segment entry, but its procgen fades to 0 by Sol.)

### 3b. rAF-paced frame interval — floors at vsync, cannot see the cost here
The probe records wall-clock frame *interval*, which is rAF/vsync-paced. On this 164 Hz
display every segment read **p50 ≈ 6.1 ms** — and raw idle rAF cadence is also 6.1 ms
(measured), so 6.1 ms is the **vsync floor**, not the render cost. Holds even at 4× pixels:

| viewport | toGalaxy p50 | toSol p50 | toEarth p50 |
|----------|:------------:|:---------:|:-----------:|
| 961×946 (0.9 MP) | 6.1 ms | 6.1 ms | 6.1 ms |
| 2560×1440 (3.69 MP) | 6.1 ms | 6.1 ms | 6.0 ms |

→ on this GPU the render fits under one refresh even at 3.7 MP; the frame-interval metric is
blind to sub-refresh differences. (Methodology note for anyone re-checking: **FPS/frame
interval on a fast GPU will not show this bug or its fix** — see §5.)

### 3c. True GPU cost — EXT_disjoint_timer_query around the scene render
Temporary instrument (a `TIME_ELAPSED_EXT` query bracketing the probe's `gl.render`, since
reverted) — GPU ms per segment:

| segment | GPU p50 | GPU p95 | GPU max | n |
|---------|:-------:|:-------:|:-------:|--:|
| **toGalaxy (universe)** | **0.369 ms** | 1.10 ms | **4.16 ms** | 50 |
| toSol | 0.019 ms | 1.34 ms | 1.67 ms | 434 |
| toEarth | 0.053 ms | 0.14 ms | 0.18 ms | 490 |

**The mechanism is confirmed and live:** the universe segment is the most GPU-expensive by
far — ~7–19× the inner segments' median, and the highest peak (4.16 ms). That is exactly the
additive-overdraw signature of BUG-4. It is simply **negligible in absolute terms on this
GPU** (0.37 ms). (Instrument caveat: the timer query serialises the pipeline and slowed the
run; `toGalaxy` only banked 50 samples. The relative ordering is robust; treat the absolute
sub-ms numbers as order-of-magnitude.)

## 4. Is it still vigente?

**Yes — as a latent fill-rate cliff, not as lag on this machine.**
- **Structurally:** unchanged. Full ~1.1M additive points at the universe vantage,
  `drawFraction = 1`, no count-LOD. Confirmed in code and by the scene-point peak.
- **As experienced lag:** hardware- and resolution-dependent. Fill-rate cost ≈
  `covered_pixels × overdraw × per-fragment_shading`. The RX 9070 XT has enormous fill rate,
  so 0.37 ms; an integrated / low-end GPU has ~10–100× less fill throughput, which turns the
  same draw into ~4–37 ms (and the 4.16 ms peak into 40 ms+) — matching the original report
  and CI SwiftShader (software raster, where fill is the dominant cost). High-DPI/4K or a
  maximised window scales `covered_pixels` and pushes the same way.

So: if the target includes laptops/integrated GPUs/4K, **BUG-4 is real and worth fixing**.
If the audience is high-end discrete GPUs only, it is currently invisible.

## 5. Fix direction (unchanged in shape; now with a verification caveat)

**Count-LOD the procgen cloud at universe scale.** The lever already exists and is plumbed:
`cloud.setDrawFraction(drawFraction)` in `makeProcgenMount.applyFrame`
(`GalaxyScene.tsx`), currently fed a constant `1`. Drawing a fraction of the 1.1M points
when far out (the silhouette still reads at that distance) directly cuts the overdraw.

Constraints / traps:
- **Keep opacity as the visual fade.** `drawFraction` must stay a *perf-only* knob —
  tying it to `procgenBlend` re-creates the P2 "nebulas without stars" regression
  (`51e0f17`). Reduce *count* by distance, independent of the opacity blend.
- **`render-galaxy` is a frozen package** (`createGalaxyPoints`/`setDrawFraction`). If the
  fix needs more than feeding a `<1` fraction from the glue (e.g. a smarter stride that
  preserves the disc shape), it touches frozen code → **its own reviewed commit/task**
  ([[frozen-package-defects]]).
- **Verify on the right hardware.** Frame interval / FPS on a fast GPU will not move (§3b) —
  the win is sub-vsync there. Verify with a GPU timer query (as in §3c), under SwiftShader
  (CI; software raster exaggerates fill so the delta is visible), or on an integrated-GPU
  profile. Confirm the spiral silhouette still reads after the count cut
  ([[verify-render-before-perf]]).

## 6. Recommendation

- BUG-4 does **not** block CI (it is a known perf characteristic, not a regression) and is
  invisible on high-end GPUs. It is **lower priority than the broken-behaviour bugs** unless
  low-end/integrated/4K targets matter.
- If pursued: it is the most visible single perf win on weak hardware, the gate
  (`flythrough4`) already isolates the `toGalaxy` segment, and the `drawFraction` lever is
  ready — but budget it as a frozen-package change with hardware-appropriate verification,
  not a frame-interval check.
- **The fix is now folded into the integrated-GPU strategy** (BUG-4's `drawFraction` becomes a
  per-tier knob — Step 1): see `docs/research/integrated-gpu-targeting.md`, which also holds
  the M1 validation playbook and the reusable GPU-timer-query instrument.

See also: `docs/agent-tasks/TASK-052-integration-bugs.md` §BUG-4,
`docs/research/galaxy-transit-procgen-floor-design.md` (the `drawFraction`/opacity split),
and the memory notes [[verify-render-before-perf]], [[frozen-package-defects]].
