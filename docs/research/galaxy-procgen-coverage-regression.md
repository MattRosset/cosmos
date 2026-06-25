# Research: Milky Way invisible at the galaxy/far vantage (procgen coverage-fade regression)

Root-cause analysis of a post-M4a regression: flying out to the "Milky Way" vantage
(~49 kpc) shows **no galaxy** — no spiral cloud, no arms/dust lanes, not even the
far-LOD impostor. The screen is black except a tiny dot-cluster (the local catalog
bubble). Written so a fix agent can act without re-deriving the diagnosis.

**Status:** FIXED (2026-06-25) — via distance-driven procgen blend, NOT the coverage
normalization §7 originally proposed (that approach was tried and disproven — see below)
**Found:** 2026-06-25 (manual inspection + live preview measurement)

> **Update 2026-06-25 — the §7 coverage fix was WRONG; the real root cause is deeper.**
>
> §7's primary fix (make `catalogCoverage()` screen-relative) was implemented and then
> **reverted** — it does not work, and the live measurement proved it. With the
> screen-area denominator in place, at the 49 kpc vantage `catalogCoverage()` still read
> **exactly 1.000** (measured via `window.__cosmos`). Why §3b's premise is false:
>
> - The octree is **galaxy-scale-boxed**: `rootHalfExtentUnits = 65536` (≈ 65 kpc) for
>   BOTH `octree/octree.json` (HYG) and `octree-gaia-sample/octree.json`. §3b assumed the
>   octree was "spatially small, a few kpc around Sol" — it is not.
> - Far out the cut collapses to a **handful of COARSE tiles** (the live `drawCalls ≈ 9`
>   confirms it — not hundreds of fine tiles). Each coarse tile is a huge geometric box
>   that is mostly empty of stars but **projects filling the screen**. So `readyWeight`
>   (Σ projected tile area) ≥ `screenArea` → screen-relative coverage clamps to **1** too.
> - Conclusion: **projected tile geometric area is the wrong signal** for a galaxy-scale
>   octree holding Sol-local stars. No normalization of tile area can distinguish near-Sol
>   from 49 kpc, because the coarse boxes geometrically fill the view at every distance
>   inside the galaxy. (A correct coverage signal would need the catalog's *true on-screen
>   point footprint* — e.g. a tight per-tile point bbox emitted by `pack-octree` — which
>   is a data-format change, deferred as the principled long-term fix.)
>
> **The shipped fix (root cause): drive the procgen galaxy by DISTANCE, not coverage.**
> Sol is the galaxy-frame origin (`SOL_POS = [0,0,0]`), so `distFromCenterPc` is 0 at home
> and large far out — a reliable signal. `GalaxyScene` now uses, in galaxy context with a
> controller:
> ```js
> procgenBlend = flying ? Math.min(coverageFade, distanceFade) : distanceFade;
> ```
> Parked at the vantage → `distanceFade(GAL_FADE_LO=18k, GAL_FADE_HI=45k, 49k) = 1` →
> full spiral. Near Sol (parked) → `distanceFade(…, ~0) = 0` → procgen off, catalog owns
> the view. During a `goTo` flight the conservative `min(coverageFade, distanceFade)` blend
> + the `GAL_FLIGHT_DRAW_MAX` cap are **kept unchanged**, so the near-Sol flight budget the
> flythrough4 §5.4 gate (BUG-4) measures cannot regress — the full spiral resolves once the
> camera parks. `policy.ts` / coverage unit tests were reverted to HEAD (coverage is now
> used only by the StarScene monolith gate, where camera-inside near Sol makes its ~1 read
> correct). `pnpm verify` green. NOTE: the headless dev preview cannot render this WebGL
> streaming app (screenshot times out, streaming never ticks), so the 49 kpc visual is
> verified by the user / CT Playwright, not locally.
>
> **§6 (black during flight near Sol) remains a separate deferred item** — the flight keeps
> the conservative blend, so the parked-view fix here does not address the mid-flight black
> frames. It still conflicts with the flythrough4 §5.4 cull gate (one wants a star layer ON
> during the near-Sol flight, the other proves the monolith OFF) and needs its own task.
**Regressed by:** `1f9fbe7` (TASK-052 M4a tier-unification) + `3a646d8` (procgen near-Sol distance guard)
**Last-good:** `b02afa4` (M3 — distance-only procgen fade)
**Related:** `docs/galaxy-rendering-model.md` (the authoritative scale-context + MW render
reference distilled from this investigation — read it first),
`docs/research/phase4-render-tier-handoff.md` (the unification design this implements),
architecture §2 (real vs procedural), §5.8 (`streaming`), ADR-006 §5 (tier unification),
`docs/research/TASK-052-integration-bugs.md`

Confidence: **high** — traced to specific code AND confirmed by live measurement.

---

## 1. Symptom

- Fly out via the "◂ Milky Way" breadcrumb (`goto.viewGalaxy()` → galaxy point
  `[0,0,55_000]`, ends ~49 kpc out). Expected: the whole Milky Way reads as a spiral
  galaxy (procgen cloud + dust-lane arms + far-LOD impostor). Actual: **black**, only a
  tiny cluster of catalog points near screen center.
- The spiral **arms** (dust lanes) and the **impostor** billboard are gone too — i.e.
  the *entire* procgen mount, not just the point cloud.
- A secondary, related symptom (see §6): `goTo` flights near Sol flash **black during
  the flight** then pop in on arrival ("la nave ya no viaja, salta").

---

## 2. Empirical evidence (live preview, `window.__cosmos`)

Boot, near Sol (`galaxy` ctx, camera `[0,0,0.06]` pc):
```
coverage: 1   procgenOpacity: 0   renderedPoints: 1,109,399   drawCalls: 9
```
After "Milky Way" flight, ~49 kpc out (`galaxy` ctx, camera dist 49,000 pc):
```
coverage: 1   procgenOpacity: 0   renderedPoints: 1,109,399   drawCalls: 9   goToActive: false
```
Screenshot at 49 kpc: black frame + a faint central dot-cluster + crosshair. No spiral.

Reading: the procgen mount IS resident and "visible" to the streaming policy (≈1M of
those 1.1M rendered points ARE the procgen cloud), but `GalaxyScene` paints it at
**opacity 0** because `procgenOpacity` (the applied blend) is 0. `coverage` is **1 at
both distances** — it does not discriminate near vs far at all.

---

## 3. Root cause

### 3a. The render-tier blend (proximate cause)
`apps/web/src/scene/GalaxyScene.tsx` (~lines 406-422):
```js
let procgenBlend = 1;
if (ctx === 'galaxy') {
  const cov = streaming.catalogCoverage();
  const coverageFade = Math.max(0, Math.min(1, 1 - cov));        // = 0 when cov = 1
  const distanceFade = smoothstep(GAL_FADE_LO_PC, GAL_FADE_HI_PC, distFromCenterPc);
  procgenBlend = Math.min(coverageFade, distanceFade);           // min() lets cov veto distance
}
// procgen mount: applyFrame(off, v.opacity * opacityBlend, lod, drawFraction)  // opacityBlend≈procgenBlend
// octree  mount: applyFrame(off, v.opacity, lod)                                // no blend
```
At 49 kpc: `cov = 1` → `coverageFade = 0` → `min(0, distanceFade=1) = 0` → the whole
procgen mount (cloud + dust lanes + HII + impostor, all multiplied by this one factor)
is drawn at opacity 0. The `distanceFade` guard added in `3a646d8` (meant to bring the
spiral back far out) **never takes effect**, because `min` with `coverageFade=0` wins.

### 3b. `catalogCoverage()` is the broken input (root cause)
`packages/streaming/src/policy.ts` `buildCoverage()` (~lines 446-488):
```js
let cutWeight = 0, readyWeight = 0;
for (const target of targetList) {
  if (target.kind === 'octree') {
    const px = projectedPixelExtent(target.extentCurrent, max(target.distUnits,1e-9), vh, TAN);
    const area = px * px;
    cutWeight += area;                       // denominator = sum of OCTREE tile areas only
    if (ready) readyWeight += area;          // (or a ready coarse ancestor)
  }
}
_catalogCoverage = cutWeight > 0 ? readyWeight / cutWeight : 0;
```
`cutWeight` and `readyWeight` are both summed **only over the octree cut tiles**. This
answers *"what fraction of the octree is loaded?"* — which is ≈1 almost always — NOT
*"what fraction of the screen does the catalog cover?"*.

The octree is spatially small: HYG + the committed Gaia *sample* pack span only a few
kpc around Sol. At 49 kpc the entire octree collapses to one coarse tile that is `ready`,
so `cutWeight ≈ readyWeight` → **coverage = 1**, even though that tile subtends a tiny
angular patch of the screen. Coverage **self-normalizes to 1 at every distance**.

Near Sol the conflation is harmless (the catalog genuinely fills the view). Far out it is
false, and via §3a it permanently vetoes the procgen galaxy.

---

## 4. Why it worked before (the exact regression)

M3 (`b02afa4`) drove procgen opacity by **distance only**, with the *same* factor applied
to every mount:
```js
let layerFade = 0;
if (ctx === 'universe') {
  layerFade = 1;                                      // universe → procgen full
} else if (ctx === 'galaxy' && ctrl) {
  layerFade = smoothstep(15_000, 40_000, dist);       // galaxy → distance fade
}
m.applyFrame(off, v.opacity * layerFade, v.lod);
```
At 49 kpc: `smoothstep(15000,40000,49000) = 1` → spiral + arms + impostor at full opacity.
No coverage term existed, so nothing could veto the distance fade.

**The regression, in one line:** TASK-052 (`1f9fbe7`) replaced the distance-driven
`layerFade` with a coverage-driven `procgenBlend = min(1 − catalogCoverage(), distanceFade)`,
and `catalogCoverage()` saturates to 1.0 at all distances → `1 − cov = 0` permanently
suppresses the procgen galaxy far from Sol.

---

## 5. Why the unification was done (do NOT just revert)

Per `docs/research/phase4-render-tier-handoff.md` and ADR-006 §5, M3 shipped **three
overlapping star layers near Sol** (monolith HYG + octree tiles + procgen ~1M points)
that draw the same catalog 2–3×. The goals:
1. One authoritative layer per scale (architecture §2: real catalogs where they exist,
   procedural only beyond catalog reach).
2. Replace M3's **hard-coded distance floors** (`GAL_FADE_LO/HI`, `GAL_PROCGEN_FLOOR`)
   with a signal that makes procgen yield to real Gaia data **as tiles cover the view**.

The design's target model (handoff §3) explicitly **keeps** the impostor + coarse procgen
at the far/universe scale:
```
universe (far)        impostor + coarse procgen     ← MUST be visible
galaxy (mid, arms)    octree tiles                  procgen cross-fades out per coverage
galaxy (near Sol)     octree tiles only             procgen OFF
```
**Conclusion: the far Milky Way disappearing is a real bug, not intended behavior.** The
quick "make distance dominate" patch would work but re-introduces the hard-coded-distance
scheme the unification set out to remove — it discards the benefit (smooth handoff to
Gaia). Fix the broken signal instead.

---

## 6. Secondary bug (same family): black screen during `goTo` flights near Sol

During a `goTo` flight in galaxy context near Sol, **all three** star layers are
simultaneously off:
- **Monolith HYG** (`StarScene.tsx:164-170`) gated off when `catalogCoverage() ≥ 0.9`
  (true near Sol). The gate does not check `goToActive`.
- **Octree mounts** explicitly skipped during flight (`GalaxyScene.tsx:431`
  `if (flying && m.kind === 'octree') continue;`) and new ready chunks deferred
  (`GalaxyScene.tsx:335-340`) — an M3 breadcrumb-freeze perf mitigation (`5a41bcb`) that
  was SAFE in M3 only because the monolith was the always-on fallback.
- **Procgen** distance-suppressed near Sol (`distanceFade → 0` below 18 kpc) and capped to
  `GAL_FLIGHT_DRAW_MAX = 0.2` during flight.

M3 mitigation `GAL_FLIGHT_DRAW_MAX` was flagged "do not remove until replacement exists"
(handoff §2), but M4a removed the *other two* fallbacks (gated the monolith, suppressed
near-Sol procgen) without addressing the flight path → nothing covers the flight → black,
then pop-in on arrival.

Fixing §3b (screen-relative coverage) **partially** helps far-from-Sol flights (coverage
no longer saturates), but near Sol coverage is legitimately ≥0.9, so the monolith stays
gated during the flight. Independent fix needed (see §7, item 4).

---

## 7. Fix plan

### Primary fix — make `catalogCoverage()` screen-relative (`packages/streaming/src/policy.ts`)
In `buildCoverage()`, normalize against the **screen area**, not the sum of octree tile
areas, so coverage means "fraction of the frustum the catalog actually fills":
- Compute a screen-area denominator from the viewport (e.g. `(viewportWidthPx *
  viewportHeightPx)`, or `viewportHeightPx²` as a square proxy consistent with the
  pixel-extent units already used). `update()` receives `viewportHeightPx`; width can be
  derived from the SSE aspect already in `sse.ts` (`STREAM_TAN_HALF_FOV`) or threaded
  through — pick the lowest-friction source and document the choice.
- Keep `readyWeight` as the area actually covered by ready (or ready-ancestor) tiles.
- `_catalogCoverage = clamp(readyWeight / screenArea, 0, 1)`.
- Near Sol: tiles fill (and overflow) the screen → coverage clamps to ≈1 → procgen OFF.
- Far out: tiles subtend a tiny patch → coverage ≈ small → `1 − cov` large → procgen ON.

Watch for: overlapping tiles double-count area (acceptable — it only pushes coverage UP
near Sol, where we want ≈1, and the clamp caps it). The camera-inside-the-octree case
near Sol should comfortably exceed the screen area → clamp to 1.

### Verify thresholds that consume coverage
2. **Monolith gate** (`StarScene.tsx:69` `MONOLITH_COVERAGE_GATE = 0.9`): re-confirm it
   still trips near Sol with the new semantics (it should — coverage ≈1 there) and
   releases far out (desired — the local monolith bubble is harmless far away).
3. **e2e** (`e2e/tests/m4a.spec.ts`) asserts on `catalogCoverage` / `renderedPoints` /
   `procgenOpacity`. Re-run; adjust expected coverage values / `MONOLITH_COVERAGE_GATE`
   if the new (correct) numbers move. The m4a/flythrough4/soak4 gates are the guardrails.

### Secondary fix — flight fallback near Sol (§6)
4. Keep a star layer alive during `goTo` near Sol. Cleanest: do not gate the HYG monolith
   while `goToActive` — `StarScene` already holds `controllerRef`, so add `&& !flying` to
   the gate at `StarScene.tsx:166-168`. (Alternative: stop skipping octree during flight,
   but that risks re-introducing the `5a41bcb` breadcrumb-freeze stall — prefer the
   monolith-fallback approach.) Can ship separately from the primary fix.

### Optional cleanup
5. Once coverage is screen-relative, reconsider whether the `min(coverageFade,
   distanceFade)` in `GalaxyScene.tsx` still needs the `distanceFade` term, or whether
   coverage alone now expresses the intent (handoff §4 wanted coverage to *replace*
   `GAL_FADE_LO/HI`). Likely the distance guard can be simplified/retired — but verify
   near-Sol procgen stays off before removing it.

---

## 8. Verification plan (live preview, `window.__cosmos`)

Measure `coverage` / `procgenOpacity` / `renderedPoints` at three camera distances and
confirm the spiral is visible far out (screenshot):

| Vantage | Expected coverage | Expected procgenOpacity | Galaxy visible? |
|---|---|---|---|
| Near Sol (`[0,0,0.06]`) | ≈ 1 | ≈ 0 | catalog field (no procgen) |
| ~25 kpc | mid (≈0.3–0.7) | mid | partial spiral fading in |
| ~49 kpc ("Milky Way") | low (≪ 0.5) | high (→ distanceFade) | **full spiral + arms + impostor** |

Drive the camera with the "◂ Milky Way" / "◂ Galaxy" breadcrumb buttons (`viewGalaxy` /
`enterGalaxy`). Also confirm §6: a `goTo` near Sol no longer flashes black mid-flight.

Then run the deterministic gates: `pnpm verify` + the m4a/flythrough4/soak4 e2e specs.

---

## 9. Files likely touched

| File | Change |
|---|---|
| `packages/streaming/src/policy.ts` | `buildCoverage()` → screen-relative normalization |
| `apps/web/src/scene/GalaxyScene.tsx` | (optional) simplify `min(coverageFade, distanceFade)` |
| `apps/web/src/scene/StarScene.tsx` | (secondary) `&& !flying` on the monolith gate |
| `e2e/tests/m4a.spec.ts` | adjust coverage/opacity expectations to new semantics |
| `packages/streaming/test/*` | update/extend coverage unit tests for the new denominator |
