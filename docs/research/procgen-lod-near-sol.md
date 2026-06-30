# Procgen LOD near Sol — the real cause of the broken `flythrough4` §5.4 gate, and how to fix it

**Status:** **IMPLEMENTED (Option A, 2026-06-30)** — `GalaxyScene.tsx` caps the drawn
procgen cloud points to `PROCGEN_MAX_DRAW_POINTS = 90_000` via `setDrawFraction` (a
uniform prefix of the well-mixed placement sequence), at full opacity, distance-
independent. App-glue only; no frozen package, no regeneration, no determinism change.
Measured `flythrough4` `toSol` `scenePts`: `1,004,802 → 94,802 / 94,802 / 90,571`
(chromium/webkit/firefox, all ≤ 109,971 budget); m4a + the gate's procgen-fade clause
still pass. Supersedes the diagnosis in
`docs/research/nav-camera-roll-and-ci-deploy-findings.md` **Part 3a**, which named the
wrong layer (an empirically-decomposed root cause + the LOD design follow).

**Open / tunable:** the visual density of the 90k-capped cloud at the cloud-hero
mid-band was NOT screenshot-verified (the heavy 3D scene would not render in the local
preview; CI's breadcrumb-perf is the visual budget gate). `PROCGEN_MAX_DRAW_POINTS` is a
single knob — if the arms read too sparse, raise it and pair with §5 Option C (narrow the
§5.4 assertion to the sub-`GAL_FADE_LO_PC` band) so the gate stays green. §6 (dense-Gaia
push-down decimation) is still open + latent.

**TL;DR:** CI has been red on `main` since 2026-06-27. The failing assertion
(`e2e/tests/flythrough4.spec.ts:154`, "near-Sol budgets drop vs M3 baseline") fails
because the **procedural Milky Way cloud renders its full 1,000,000 points** in the
`toSol` segment. Procgen has **no working LOD** — it always renders `starCount` points
whenever it is visible, at any distance. The `flythrough4` near-Sol scene-point count
went `572 → 1,004,802` not because of the Gaia push-down (BUG-8), but because the
procgen-floor fix (B+E, 2026-06-27) lowered `GAL_FADE_LO_PC` from `18_000` to `1_500`
to kill the mid-transit black band — which keeps the un-LOD'd 1M cloud lit much closer
to Sol, right across the band the `toSol` segment spans.

---

## 1. The failing gate

```
e2e/tests/flythrough4.spec.ts:154  flythrough4: near-Sol budgets drop vs M3 baseline
  Error: near-Sol total scene points ≤ M3 baseline (ADR-006 §5.4 drop — monolith culled)
  Expected: <= 109971
  Received:    1004802          ← all three browsers, deterministic
```

`peakScenePoints` is `gl.info.render.points` (Flythrough4Probe.tsx:307) — the TOTAL
points three.js draws across every draw call in the frame, maxed over the `toSol`
descent segment. The M3 baseline is `109,971` (the always-on HYG monolith dominates;
`flythrough4-m3-baseline.json`). When the baseline was recorded (2026-06-24) the **M4a
`toSol` value was `572`** (monolith culled, octree-only) — a clean win. It is now
`1,004,802`.

---

## 2. Empirical decomposition — the 1M is procgen, not Gaia

The CI streaming log line for the same segment:

```
[flythrough4:toSol] ... streamPts=1004231 streamDraws=2  scenePts=1004802 sceneDraws=36
```

`streamDraws=2` — only **two** visible streaming chunks summing to 1,004,231 points.
The committed packs make this decomposition exact:

| layer | points | source |
|---|---|---|
| procgen Milky Way cloud | **1,000,000** | `MILKY_WAY_STAR_COUNT` (`local-group.ts:13`) |
| HYG octree root tile | 4,096 | `octree-gaia` HYG pack, root `pointCount` |
| Gaia sample | 135 | committed `octree-gaia-sample` (135 stars) |
| **total** | **1,004,231** | = `streamPts` exactly |

The `scenePts` (1,004,802) is the same plus the constellation overlay + exo hosts
(~571, matching the old clean `572`). **The HYG monolith is correctly gated off**
(`StarScene.tsx:164` — `catalogCoverage() ≥ 0.9` near Sol hides it).

This refutes Part 3a: the committed Gaia pack is the **135-star sample**, so the Gaia
push-down (BUG-8) cannot produce 1M points here. With the real dense pack it would —
that is a *separate, latent* problem (§6) — but it is **not** what is failing CI today.

---

## 3. Why procgen has no LOD (structural)

The streaming policy *computes* a procgen LOD but **never applies it to the point
count**:

- `selectProcgen` (`policy.ts:515`) derives a discrete `lod` from the projected pixel
  extent and writes `c.level = lod`, **but `c.pointCount` is never touched.**
- `ensureProcgenChunk` (`policy.ts:337`) fixes `pointCount: params.starCount` — the full
  1M, for the life of the chunk.
- The worker `generate()` (`packages/procgen/src/galaxy.ts:106`) uses
  `count = p.starCount` — full 1M, independent of any LOD. The `lod` never reaches the
  worker.
- The render side hard-codes `drawFraction = 1` (`GalaxyScene.tsx:466`). A previous
  attempt to tie `drawFraction` to the fade blend was **deliberately reverted** because
  it re-created **P2** (dim few-point cloud under full-opacity nebula sprites —
  "nebulas without stars"); see `galaxy-transit-procgen-floor-design.md §5E/§8`.

Net: **whenever the procgen layer is on, it renders all 1,000,000 points**, at every
distance and LOD. The only lever today is binary on/off via opacity.

---

## 4. Why it regressed `572 → 1,004,802` (the real bisect)

The probe's procgen visibility is **distance-driven** (`GalaxyScene.tsx:440-452`):
with a flight controller present it uses
`procgenBlend = smoothstep(GAL_FADE_LO_PC, GAL_FADE_HI_PC, distFromCenterPc)`.
Below `GAL_FADE_LO_PC` the whole procgen layer is hidden; above it the **full 1M cloud
draws**.

- **When the baseline was recorded (2026-06-24):** procgen near Sol faded via the old
  *coverage* path (cov→1 near Sol ⇒ procgen 0). `toSol` peak = octree only = **572**.
- **The procgen-floor fix (B+E, 2026-06-27, `galaxy-transit-procgen-floor-design.md`)**
  switched the in-galaxy fade to distance and **lowered `GAL_FADE_LO_PC` from `18_000`
  to `1_500`** to close the **P1 black band** (nothing rendered between where the real
  catalog goes sub-pixel ≈1.5–2.5 kpc and where procgen used to switch on at 18 kpc).

Lowering the floor to 1.5 kpc means the un-LOD'd 1M cloud now stays lit through almost
the entire `toSol` approach band. The `peakScenePoints` over `toSol` therefore catches
procgen at full 1M. Part 3a's bisect to `1073dbfa`/`b205215` caught commits in the same
2026-06-27 cluster but attributed the mechanism to the octree push-down; the actual
lever is the `GAL_FADE_LO_PC` lowering interacting with **procgen having no LOD**.

**The conflict is structural, not a typo:** the P1 fix *requires* procgen lit closer to
Sol; the §5.4 gate *requires* few points near Sol. Both are right. The missing piece
that reconciles them is a real procgen LOD — "lit closer" must stop meaning "1M points".

---

## 5. Design options for procgen LOD

Goal: in the inner/mid band the procgen cloud renders **far fewer points** while still
reading as a star field (no P1 black band, no P2 nebulas-without-stars), and the §5.4
near-Sol budget is met again.

### Option A — Distance/SSE-decimated point count, brightest-N (recommended)

Give the procgen chunk a real LOD point count, the same way ADR-003 §3 decimates octree
*internal* tiles (brightest-N by absolute magnitude):

1. In `selectProcgen`, map the projected pixel extent / distance to an **effective point
   count** `nEff = clamp(starCount, MIN, …)` that *drops as the camera enters the disc*
   (the inner band needs the fewest — the real catalog owns those pixels). Write it to
   `c.pointCount` so the budget/stats and `gl.info.render` all reflect the real cost.
2. Pass `nEff` (or a stride) to the worker; `generate()` produces a **deterministic
   brightest-N subset**. Two sub-choices:
   - **Generate-then-keep-brightest-N:** simplest, but still allocates/places 1M before
     trimming (saves draw + GPU upload, not generation CPU).
   - **Generate only N:** cheaper, but must stay reproducible. The seeded placement
     sequence is order-stable (ADR-004), so a **prefix of length N** is deterministic;
     to keep it *brightest*-biased, generate full then keep top-N, or pre-sort the
     deterministic stream by magnitude at build/first-gen and cache. Decide in review.
3. **Keep opacity = the fade blend, independent of N** (do NOT re-tie draw count to
   opacity — that was the reverted P2 cause). Brightest-N at *full* opacity keeps the
   bright stars that read as a field; only the dim floor thins. No nebulas-without-stars.

Why brightest-N specifically: a uniform random thin (a plain stride) at low N makes the
cloud visibly sparse/flickery; keeping the brightest preserves the perceived field with
the fewest points — exactly the octree internal-tile rationale, reused.

**Budget impact:** with `nEff` capped at, say, ≤100k in the inner band, `toSol`
`scenePts` ≈ octree (~5k) + nEff (≤100k) ≤ 109,971 ⇒ the §5.4 gate passes and stays
meaningful.

### Option B — Procgen point count scales with `(1 − coverage)` or with the fade blend

Tie `nEff` to how much the cloud is *supposed* to be contributing: as the real catalog
covers / as the blend ramps down, drop the count too (not just alpha). Cleaner coupling
to the existing fade, but **higher P2 risk** — must still keep nebula sprite opacity and
star count moving together, and coverage is the signal the floor doc already found
"unusable in-galaxy" (saturates to ~1). Distance (Option A) is the more reliable driver
here.

### Option C — Don't touch procgen; fix the test boundary

Argue the §5.4 gate measures the wrong span: the `toSol` *segment* starts out in the
mid-band where procgen legitimately full-draws, so the peak is not really "near Sol".
Restrict the near-Sol assertion to the sub-`GAL_FADE_LO_PC` tail (where procgen is off),
where M4a is still ~572. **Cheapest (test-only), green immediately, no risk to P1/P2.**

But it leaves the real cost in place: a 1M-point cloud full-drawn through the whole
mid-band transit on every approach. On the integrated-GPU floor (Iris Xe / M1,
`hardware-target-floor`) that is the latent BUG-4 universe-lag class — invisible on the
RX 9070 XT, real on the target hardware. So C unblocks CI but does not fix the perf
debt; it should be paired with A as the real fix, or explicitly deferred with a logged
follow-up.

**Recommendation:** **Option A** (real procgen LOD, brightest-N, count-not-opacity),
optionally with a small piece of **C** (tighten the gate to the band the design actually
intends as "near Sol") so the assertion measures the inner approach rather than the
mid-band where full-draw is by design. A alone fixes both the gate and the perf debt; C
alone fixes only the gate.

---

## 6. The separate, latent issue — dense Gaia push-down has no decimation

Independent of the procgen failure: when `GAIA_OCTREE_MANIFEST_URL` (`App.tsx:122`) is
swapped from the 135-star sample to the real pack (`octree-gaia` 5.3M / `octree-gaia-1m`
1.2M), the BUG-8 push-down (`octree-combined.ts:103 pushDownToCell`) **conserves every
point** of a shallow source's leaf into the descendant cut cells with **no decimation**.
Near Sol the cut descends to leaves ⇒ near-full-resolution Gaia (~1M) renders, and the
high-tier streaming cap is 2M (`budgets.ts:20`), so `enforceBudgets` does not collapse
it. This is a real near-Sol cost that will surface the moment the dense pack is wired
(e.g. before loading the 5.7M sample the user asked about). It needs its own LOD/SSE
tuning pass (the SSE threshold `DEFAULT_SSE_THRESHOLD_PX = 8` and/or a near-field
decimation on push-down). **Not the current CI failure** — but the same class, and worth
fixing alongside A so "load the big Gaia pack" doesn't immediately re-break the gate.

---

## 7. Concrete next steps (when we implement)

1. **A:** add `nEff` to `selectProcgen` (distance/SSE → point count), thread it to the
   worker, keep brightest-N + full-opacity; set `c.pointCount = nEff` so stats/`gl.info`
   reflect it. Re-measure `flythrough4` `toSol` `scenePts`.
2. Guard against P1/P2: confirm via the luminance probe (the floor doc's method) that the
   mid-band still shows stars+nebulas together and no black band, at the reduced N.
3. **C (optional):** restrict the §5.4 near-Sol assertion to the sub-`GAL_FADE_LO_PC`
   tail, OR re-record the M4a-expected near-Sol number with LOD on and assert against it.
4. Verify the §5.8 hard caps (inFlight ≤6, points ≤2M, draws ≤300) and the procgen
   determinism golden hash (ADR-004) still hold.
5. Then rebase PR #1 (`fix/nav-antipodal-orientation-roll`) onto the green `main` — it
   inherits the fix; its own diff is unrelated (nav only).
6. **Deferred / separate:** §6 dense-Gaia push-down decimation; the `Deploy` workflow
   no-op (Part 3b of the nav doc — `gh variable set CLOUDFLARE_ACCOUNT_ID`).
