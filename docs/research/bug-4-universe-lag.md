# BUG-4 — Universe-view lag: what it is and whether it is still live

**Status: CLOSED (2026-07-01).** Fixed in `1626985` — global procgen draw cap
(`PROCGEN_MAX_DRAW_POINTS = 90_000` via `setDrawFraction`). Handoff:
`docs/agent-tasks/TASK-052-integration-bugs.md` §BUG-4. Implementation detail:
`docs/research/procgen-lod-near-sol.md`.

Research pass (2026-06-28) re-scoping BUG-4 after the procgen-floor + nebula commits that
landed since the original 2026-06-24 measurement. The §3–§6 measurements below are
**historical** (pre-fix). §7 records the resolution + optional future polish.

**TL;DR (original symptom).** BUG-4 was the far-out Milky Way view (`toGalaxy` segment)
costing far more GPU than inner segments because the full ~1.1M-point procedural cloud drew
as **additive sprites** covering the whole disc → massive **overdraw** (fill-rate, not CPU).
On weak HW / SwiftShader that was ~40 ms/frame; on high-end discrete it was sub-vsync.

**TL;DR (resolution).** `1626985` caps drawn points to 90k whenever procgen is on (~12×
fewer fragments). Acceptable spiral read at far vantage; some inter-arm sparsity on high-end
(user-verified 2026-07-01). **Future polish (optional):** distance/tier LOD so `high` tier
gets full cloud at ~49 kpc — see §7 and `integrated-gpu-targeting.md` Step 1.

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

## 2. Mechanism (confirmed in the current code — **historical pre-`1626985`**)

`apps/web/src/scene/GalaxyScene.tsx` (as of 2026-06-28, before the LOD cap):
- In the **universe** context, `procgenBlend` stays `1` (the `if (ctx === 'galaxy')`
  distance-fade block does not apply — from outside, the procgen cloud *is* the galaxy and
  must render at full). So the cloud is fully on.
- `drawFraction` was **hardwired to `1`** (pre-`1626985`). Now capped at
  `PROCGEN_MAX_DRAW_POINTS / batch.count` — see §7.
- The cloud (`createGalaxyPoints`) draws with `AdditiveBlending`, `depthWrite:false` →
  every covered fragment is shaded and blended. **Overdraw cost is per-fragment and largely
  independent of opacity** — even at low `procgenBlend` the fragments still rasterize. From
  the universe vantage the disc fills most of the screen, so the overdraw factor is high.

### Did the recent commits change it? (historical, pre-`1626985`)

Through 2026-06-28 the full 1M draw was preserved on purpose (`51e0f17` dropped only the
in-flight cap). **`1626985` (2026-06-30)** added the global 90k cap — see §7.

## 3. Re-measurement (2026-06-28, AMD Radeon RX 9070 XT — **pre-`1626985`**)

### 3a. Scene work — full cloud at the universe vantage (pre-fix)
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

## 4. Is it still vigente? (historical — pre-`1626985`)

**Was yes — as a latent fill-rate cliff.** Superseded by the global 90k cap (§7).

## 5. Fix direction (historical — pre-`1626985`)

Count-LOD via `setDrawFraction` — the lever that was eventually used, but as a global cap
rather than distance/tier-aware.

## 6. Recommendation (historical — pre-`1626985`)

Lower priority than broken-behaviour bugs unless integrated-GPU targets matter. That
priority call stood until `1626985` landed as a side-effect of the flythrough4 §5.4 fix.

## 7. Resolution + future polish (2026-07-01)

**Shipped (`1626985`):** `PROCGEN_MAX_DRAW_POINTS = 90_000` in `GalaxyScene.tsx` feeds
`setDrawFraction` whenever procgen is on. Same commit that restored flythrough4 near-Sol
budgets. App glue only; no frozen-package change.

**Acceptance:** overdraw cliff addressed on weak HW; Milky Way spiral still reads at ~49 kpc
(user screenshot, high-end PC, 2026-07-01). Decision: leave the global cap as-is; revisit as
optional polish.

**Future polish (optional — not scheduled):**
1. **Distance LOD** — `drawFraction = 1` at ≥ `GAL_FADE_HI_PC`; cap only in the mid band.
2. **Tier LOD** — `high` draws more at far vantage, `low` keeps 90k (`integrated-gpu-targeting.md` Step 1).
3. **Brightest-N** subset instead of uniform prefix (`procgen-lod-near-sol.md` Option A full form).

Knob today: `PROCGEN_MAX_DRAW_POINTS` in `GalaxyScene.tsx`.

See also: `docs/agent-tasks/TASK-052-integration-bugs.md` §BUG-4,
`docs/research/procgen-lod-near-sol.md`, `docs/research/galaxy-transit-procgen-floor-design.md`
(the `drawFraction`/opacity split), and `docs/research/integrated-gpu-targeting.md`.
