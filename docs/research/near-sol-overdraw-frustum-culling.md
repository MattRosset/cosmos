# Near-Sol overdraw: we draw ~700k points to show a few hundred — off-screen (95%) + sub-visible (96%), not LOD redundancy

**Date:** 2026-08-05
**Status:** Findings recorded; fix not yet specced.
**Trigger:** The `flythrough4` near-Sol drop gate (ADR-006 §5.4) fails on branch
`task/gaia-search-by-source-id` after TASK-070. Investigating *why* the near-Sol scene
draws more than the M3 baseline turned into "how much of what we draw near Sol is even
visible?" — every claim below is a live measurement, not a reading of the source.

## TL;DR (all measured, headless dev build, camera parked at Sol = galaxy `[0,0,0.06]`)

- Near Sol the scene draws **704,108 points / 214 draw calls** (`gl.info.render`).
- Layer split: **100% octree.** Procgen is OFF (`procgenOpacity=0`, 0 meshes), the HYG
  monolith is gated OFF (`catalogCoverage=1`). Not one point comes from procgen or the
  monolith. So the near-Sol gate has nothing to do with procgen being drawn.
- **95.5% of those points are outside the camera frustum:** 44.4% *behind* the camera,
  51.1% off to the sides. Only **4.5% (31,710 pts)** are in view. **167 of 213 tiles
  (78%) have zero points on screen** yet draw in full (`frustumCulled = false`).
- Of the 31,710 in-frustum points, only **~1,400 pixels** light up perceptibly
  (luma ≥ 32 of a 640×360 read) — the rest are below the brightness floor. Ratio:
  **~500 drawn vertices per lit pixel.**
- **Brightness is the other, orthogonal lever — and it is bigger than frustum.**
  Replaying the exact shader brightness for all 703,537 drawn points (isotropic, so this
  is "how many stars you'd see looking in EVERY direction, not just the frustum"): at the
  runtime exposure (150) only **942** points reach full brightness, **4,112** are clearly
  visible (bri ≥ 0.1), and even at an absurdly generous floor (bri ≥ 0.004) just **28,989**
  — i.e. **~96% of drawn points emit effectively zero light**, at any camera angle.
  **100% of octree points are sub-3px natural size** (floor-clamped then flux-dimmed):
  the near-Sol field is intrinsically a sub-pixel field. Visible points cluster at
  10–1000 pc; beyond ~1000 pc almost nothing is visible (186 points). This is the user's
  observation confirmed: you can *click* (pick) a Gaia star at ~6000 pc on a black patch of
  screen — it is drawn and paid for, but emits no visible light.
- LOD containment (a coarse ancestor tile drawn together with its finer children):
  **30 of 213 tiles = 14.1%.** Real, but the *minor* lever — caused by `buildCoverage`
  drawing a ready ancestor as a fallback while children stream, on a cut that never
  settles (`inFlight=6` the whole time, `loadedChunks` climbing past 650).

**The dominant waste is drawing what is off-screen, not LOD redundancy.** Frustum
culling alone would cut near-Sol work ~22× (704k → ~32k) before any brightness/LOD work.

## What the near-Sol gate actually is (not a perf gate)

704k points / 214 draws is well under the tier caps (`quality.ts`: high 2M / medium 1M /
low 500k points; `budgets.ts` maxDrawCalls 300) and the measured "handles fine" peak
(~1.1M points in ~10 draws, §5.8). So the failing gate is **not** an FPS gate — it is a
**no-redundancy** gate: ADR-006 §5.4 says unifying the layers near Sol must *lower* the
work vs the M3 monolith baseline (40 draws / 109,971 pts = the HYG field drawn once). The
octree is instead drawing the neighbourhood ~2× and fragmented across 43–214 draws.

## Reference numbers

- **Real catalog near Sol:** the HYG field is **109,399 stars** (`packs/manifest.json →
  count`), Sol-local by construction. The CI Gaia sample adds **135**
  (`octree-gaia-sample/octree.json`). So "what should be near Sol" ≈ **~109.5k unique
  stars** with the sample pack. The M3 baseline (109,971) is exactly this drawn once.
- **What we handle without problems:** ~1.1M points **in ~10 draw calls** (measured
  peak, §5.8 caps gate). The cost that hurts is draw calls + off-screen vertex work, not
  point count per se.

## Root cause, by lever (measured share)

### Lever 1 — no frustum culling (≈95% of the waste)

`selectOctree` (policy.ts:472) descends the tree purely by screen-space error; it never
tests the frustum. The cut therefore contains tiles in **every** direction around the
camera, including directly behind it. `GalaxyScene` mounts create their objects with
`object.frustumCulled = false`, so three.js does not cull them either → all of it draws.

`frustumCulled = false` is **deliberate and correct** given the current design: the
vertex shader positions each point as
`rel = (position + uRenderOffsetHi)*uGuardOne + uRenderOffsetLo`
(`stars.vert.glsl.ts:48`) — the tile's camera-relative position lives in the
`uRenderOffset` **uniform**, while the CPU-side `geometry.position` is tile-local and the
object's `matrixWorld` is identity. three's native cull uses the geometry bounding sphere
× `matrixWorld`, which places every tile at the origin — useless. There is **no** manual
bounding sphere anywhere (grep-confirmed), so no correct cull exists today.

The data to fix it is already computed: `measure()` (policy.ts:268) derives
`camRel = origin.toRenderSpace(tileCenter)` each frame and keeps only its length
(`distUnits`), discarding the vector. A custom frustum test needs that vector + the camera
orientation/FOV — one dot product per tile.

### Lever 2 — brightness floor (~96% of ALL drawn points emit no visible light)

This is orthogonal to frustum (isotropic — holds at any camera angle) and, measured,
*larger*. Replaying the shader brightness
(`m = absMag + 5·(log10(dPc)−1)`; `sNat = base·10^(−0.2m)`; floor/max clamp;
`bri = clamp(10^(−0.4m),0,1)·exposure·(sNat/sRen)²`) over all 703,537 drawn points at the
runtime exposure (150):

| brightness ≥ | points | of 703,537 |
|---|---|---|
| 1 (saturated) | 942 | 0.13% |
| 0.1 (clearly visible) | 4,112 | 0.58% |
| 0.02 | 10,851 | 1.5% |
| 0.004 (absurdly generous) | 28,989 | 4.1% |

`sNat < uMinPointPx(3)` for **100%** of points — the whole near-Sol octree field is
sub-pixel; only the flux-dim survivors read. Visible points (bri ≥ 0.02) by distance:
10–100 pc → 3,963; 100–1000 pc → 6,614; **>1000 pc → 186**. So the far Gaia stars are
drawn-but-black. (These counts are an UPPER bound: pre-tonemap linear brightness, and
`uOpacity` was 0.05 on the sampled mount — the true visible set is smaller. At the user's
"200×" exposure slider the counts scale up but stay well under 100k, matching their
estimate.)

This lever **must not delete stars from the data** — they reappear as the camera
approaches (dPc shrinks → apparent magnitude brightens). The natural, reversible form is a
**per-tile brightness/distance cull**: if a tile's brightest star (min absMag) still
projects fainter than the visibility floor at the tile's current distance, skip the whole
tile — cheap (one test per tile, needs a per-tile min-absMag, precomputable in the pack)
and automatically re-includes the tile on approach.

### Lever 3 — LOD containment (14%, minor)

`buildCoverage` (policy.ts:567-582): when a fine target tile is not yet `ready`, it draws
the nearest **ready ancestor** as a coverage fallback. When a *sibling* fine tile IS ready,
that coarse ancestor overlaps it → parent+child of the same region drawn together.
Measured: 30/213 tiles (9 distinct ancestors double-covered), e.g. `7/1835011` under
`6/229376`. It exists only because the cut never settles near Sol (too many tiles, streaming
never catches up). A settled cut would have ~0 containment.

## Fix direction (not yet specced)

Frustum (≈95% off-screen) and brightness (≈96% sub-visible) are the two big levers, and
they are **orthogonal** — one culls by direction, the other by apparent magnitude. Both
ideally act at the **tile** level in the draw loop (cheap, reversible, no data deletion):

1. **Per-tile frustum cull at DRAW time (low risk, ~95%).** Test each tile against the
   camera using the `camRel` the policy already computes (`measure()`) + camera forward/FOV
   — NOT three's bounding sphere (wrong under the uniform offset). Tiles stay streamed →
   rotating shows them instantly, **no pop-in**. Behind-camera (dot < 0, already 44%) is the
   trivial first cut.
2. **Per-tile brightness/distance cull at DRAW time (low risk, ~96%, orthogonal).** Skip a
   tile whose brightest star (min absMag) is still fainter than the visibility floor at the
   tile's current distance. Needs a per-tile min-absMag (precomputable in the pack). Fully
   reversible: the tile re-includes itself as the camera approaches. This is the lever that
   also kills the "paying for pickable-but-invisible far Gaia stars" the user flagged.
3. **Cull at SELECTION time (deeper, higher risk — defer).** Once 1–2 prove out, also skip
   fetching/mounting tiles that are off-screen AND sub-visible, behind an *enlarged* margin
   so rotation/approach don't pop. Saves network + memory + decode on top of draws.
4. **Settle the cut / containment (minor, 14%).** Once 1–3 shrink the cut, containment
   should fall out; if not, skip an ancestor fallback whose descendants are already ready.

## Far-Sol park (measured — same pattern, more extreme)

Flew to a galaxy park **5,850 pc** from Sol (`goTo` to `[6000,0,0]`, arrival ~150 pc;
arbitrary target — the sample pack has no real Gaia that far, but the *regime* — Sol-local
octree seen from far out — is exactly TASK-070's black-screen case). Settled, tier low:

- Scene still draws **736,013 points / 219 calls** — as much as near-Sol.
- **206 of 214 tiles (96%) are fully off-screen**; of 645,442 octree points **0.3%
  (1,813) are in the frustum**, 98% are *behind* the camera (the park faces away from Sol,
  so the Sol-local catalog is at the camera's back), the rest lateral → **99.7% off-screen.**
- Brightness: **5 points** clear `bri ≥ 0.02`, **0** clear `bri ≥ 0.1` → **~0% visible.**
  At 5,850 pc every Sol-local star is far enough to be black.
- Procgen is (correctly) fading in here (opacity 0.028, 3 meshes) — the far vantage is its
  job; that part is by design, not waste.

So the overdraw pattern **holds far-Sol and is worse**: ~736k points drawn, essentially
none visible. A per-tile brightness cull would skip almost the entire Sol-local octree at
this distance — which is *also* the cheapest cure for TASK-070's black screen (the collapse
only happened because the point cap tried to keep those invisible tiles under budget; if
they're culled as invisible, there is nothing to collapse). One fix (per-tile frustum +
brightness cull) plausibly closes **both** near-Sol overdraw and far-Sol black-screen, and
would let the TASK-070 procgen-cap exclusion be reverted. (The behind-camera 98% is
orientation-specific; the ~0% brightness result is isotropic and is the robust finding.)

## Relationship to TASK-070 (the thing that surfaced this)

TASK-070 excluded procgen's nominal 1M from the `enforceBudgets` point cap globally, to
stop a far-Sol Gaia park from collapsing the octree to root (black screen). That is why the
near-Sol point cap stopped shedding octree tiles and the gate broke. But this investigation
shows the point cap was the **wrong instrument** either way: it counts total points (2M
headroom) and can't see that 95% of them are off-screen. A frustum cull attacks the real
cost directly and is regime-agnostic (near AND far), so it may make the procgen-cap hack
unnecessary. **Not verified far-Sol yet** — see kill conditions.

## Not proven / kill conditions (do not build past these without a number)

- **Far-Sol measured with an arbitrary target, not a real Gaia star.** The 5,850 pc park
  used `[6000,0,0]` (the sample pack has no Gaia that far). The regime is representative
  (Sol-local octree from far out) and the ~0% brightness result is isotropic, but a park on
  a REAL far Gaia (full CDN pack) is the honest confirmation before reverting the TASK-070
  cap hack. The "one fix closes both" claim is measured-plausible, not yet proven end-to-end.
- **Frustum cull correctness under the shader.** The draw-time cull must use the real
  camera-relative tile position (uRenderOffset / camRel), NOT three's bounding sphere.
  A naive `frustumCulled = true` would cull wrongly (all tiles read as at-origin).
- **Rotation latency if culling in selection.** Lever 2 must be validated against a fast
  camera spin (pop-in / black) before shipping; measure re-stream latency.
- **Brightness LOD reversibility.** Any brightness-gated cull must be proven to restore
  stars on approach/exposure — do not measure "fewer points" as success (global rule 3).

## Method notes (reproducibility)

- Headless Playwright against the dev server; app parked at the initial galaxy camera
  (`[0,0,0.06]`, i.e. at Sol) with the octree streamed for ~15s. Preview-pane rAF is
  throttled when hidden (`preview-tab-idle-hidden`), so measurement ran under Playwright
  where rAF is live.
- Layer split + lit pixels: temporary `window.__dbg = {gl,scene,camera,streaming,...}` hook
  in `GalaxyScene` (reverted after each run), `gl.render` + `gl.info.render`, `readPixels`
  luma buckets.
- Containment: parsed the octree `chunkId`s (`"level/mortonCode"`); B descends A iff
  `codeB >> (3·(levelB−levelA)) === codeA`.
- Frustum: projected every octree point (via `octreePickHolder` batches) into camera frame
  using the flight controller's position + orientation quaternion and the camera FOV/aspect
  — deliberately NOT three's matrices (the shader's uniform offset makes them wrong).
- Scripts under the session scratchpad (`measure-layers2 / measure-visible /
  measure-containment / measure-frustum .mjs`).
