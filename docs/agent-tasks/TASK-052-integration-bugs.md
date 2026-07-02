# TASK-052 M4a Integration — Bug Investigation & Status (handoff)

Single source of truth for the M4a integration bug sweep: root-cause investigation +
current status of every bug + what's done vs pending + next steps. Bugs 1–5 were found by
manual inspection; bugs 6–7 were surfaced by the TASK-053 phase-4a gate run. Deeper
pre-fix analysis of 1–5 also lives in `docs/research/TASK-052-integration-bugs.md`.

Status legend: `open` · `fixed` · `improved` · `deferred`

**Sweep closure (2026-07-01):** 14/15 tracked items **closed** on `main`. **BUG-2**
(functional blockers) fixed in working tree (2026-07-02, TASK-053 session — uncommitted);
**BUG-2d** (tour UX polish) deferred to a future tour-redesign task. BUG-4 closed via
`1626985` (global procgen cap); optional distance/tier LOD documented as future polish,
not scheduled.

## Status summary

| Bug | What | Status | Owner area / notes |
|-----|------|--------|--------------------|
| **6** | Octree tiles never load (`fetch` Illegal invocation) → coverage 0 | ✅ **fixed + committed** (`f8e6d89`) | `packages/data`; re-measured on the scripted path → coverage 1.0, tiles load, procgen fades (validated) |
| **3** | Cinematic view can't be closed (button covered) | ✅ **fixed + committed** (`f8e6d89`) | `ui.css` z-index + `App.tsx` Esc |
| **1** | Nebulae render as flat green bokeh discs | 🟡 **improved + committed** (`f8e6d89`, `4929d6d`) | Tier-A overhaul in `glue/nebulae.ts` + shader tint; fine polish → **separate task**. Research: `docs/research/nebula-visual-quality.md` |
| **2** | Guided tour gets stuck / Saturn won't move | 🟡 **functional fix (local, 2026-07-02)** | Option B shipped: dwell auto-advance, `GRAND_TOUR` Sol→Betelgeuse→TRAPPIST-1, galaxy framing standoff. **UX polish → BUG-2d (deferred).** Research: `docs/research/TASK-052-integration-bugs.md` §BUG-2/§2d |
| **2d** | Tour UX: screen jumps + letterbox flicker | ⏸️ **deferred** | User-observed post-fix (2026-07-02). Tour *works* (advances, stays galaxy-scale) but does not read as a continuous cinematic flyover. Intentionally out of scope until a dedicated tour-redesign task. See §BUG-2d |
| **4** | Universe / Milky Way view GPU lag (procgen overdraw) | ✅ **fixed + committed** (`1626985`) | Global `PROCGEN_MAX_DRAW_POINTS=90k` via `setDrawFraction` — cuts 1.1M→~90k whenever procgen is on. Resolves the fill-rate cliff on weak HW; spiral still reads at far vantage (user-verified high-end). **Future polish:** distance/tier LOD so high-end gets full cloud at ~49 kpc — see §BUG-4 + `procgen-lod-near-sol.md` §Future |
| **G** | flythrough4 gate broken 3 ways (path ENOENT + degenerate baseline + metric misses the monolith) | ✅ **fixed + committed** (`ec51eeb`) | C1 path→`__dirname`, C3 metric→`gl.info.render` on toSol, C2 baseline re-recorded. Green on chromium+webkit+firefox in CI. See §Gate health |
| **S** | soak3/soak4 churn gate broke (`requestsIssued>100` → got 8) | ✅ **fixed + committed** (`4d13f77`) | side-effect of the BUG-6 fix: tiles load+cache instead of re-request storm. Proxy re-targeted to `loadedMax>loadedMin`. See §Gate health |
| **5** | Labels jitter when camera moves | ✅ **fixed + committed** (`4606a55`) | per-frame imperative projection replaces the 10 Hz `setInterval`+React-state path. App glue only (`glue/overlays.ts`, `scene/Overlays.tsx`, `hud/Hud.tsx`); `ui` untouched. See §BUG-5 |
| **7** | Labels never render in the DOM (e2e) | ✅ **fixed + committed** (`3322b87`) | Boot orientation frames none of the labelled giants → 0 in-frustum. e2e reorients via `__cosmosDev.focusFirstLabel`; latent behind-camera phantom-label bug fixed in projection. See §BUG-7 |
| **8** | Gaia never renders inside the galaxy (combine drops a source) | ✅ **fixed + committed** (`b205215`; invariant `4708461`) | push-down at load time in `glue/octree-combined.ts`; unit tests + TASK-058 `assertTileContributions`. Research: `docs/research/bug-8-combine-drops-source.md`. See §BUG-8 |
| **9** | Procgen Milky Way never renders (empty overview / "Milky Way black") | ✅ **fixed + committed** (`77db8ed`) | procgen fade now DISTANCE-driven, not `1−coverage` (which saturates ≡1 inside the galaxy-scale octree). Verified: spiral visible at the parked ~49 kpc vantage; CI green. Known follow-up: spiral pops in on arrival (off during flight to protect flythrough4 §5.4) — the §6 deferred item. See `docs/galaxy-rendering-model.md` + `docs/research/galaxy-procgen-coverage-regression.md` |
| **10** | Dense (~3M) Gaia pack thrashes streaming → hang on move | ✅ **P0 fixed + committed** (`5dedef1`); P1/P2 = agent briefs | Real cause was `enforceBudgets` **O(cut²)** collapse (99.6% of frame), NOT unbounded residency (re-measured: bounded). 384 ms→1.9 ms, **1.2→164 fps** on the 3M. See §BUG-10 |
| **T** | Galaxy breadcrumb transit renders black (~90 % of flight) | ✅ **fixed + committed** (`df3e77c`, `1073dbf`, `51e0f17`) | distance-driven procgen during flight + Gaia octree kept visible + procgen floor (B+E). Design: `docs/research/galaxy-transit-procgen-floor-design.md` |
| **E** | Gaia catalog stars near-invisible at default exposure | ✅ **fixed + committed** (`dabb99f`) | catalog-field exposure boost. Research: `docs/research/gaia-pack-completeness-and-exposure.md` |
| **F** | m4a guided-tour e2e flake (step-0 cinematic mount race) | ✅ **fixed + committed** (`2021026`) | retry step-0 until controller mounts — CI stability only; underlying BUG-2 product defects remain. Research: `docs/research/m4a-tour-cinematic-flake-rootcause.md` |

## Committed state (2026-07-01)

On `main` (integration-bug sweep + post-sweep fixes), in chronological order:

**2026-06-24 — initial sweep + gates**
- `f8e6d89` fix m4a (BUG-1/3/6), `bde7dbd` perf pack-octree, `b473317` test phase-4a,
  `129299d` docs, `86c3fd3` chore gitignore.
- `ec51eeb` flythrough4 gate correct & green (Gate **G**: C1+C2+C3).
- `4d13f77` soak3/soak4 churn proxy fix (Gate **S**).
- `3322b87` **BUG-7** — m4a overlay label gate green.
- `77db8ed` **BUG-9** — Milky Way spiral at far vantage.
- `5dedef1` **BUG-10 P0** — `enforceBudgets` O(n²)→O(n).

**2026-06-25…27 — labels, nebula, galaxy transit, Gaia visibility**
- `4606a55` **BUG-5** — per-frame imperative label projection.
- `4929d6d` **BUG-1** Tier-A nebula visual overhaul.
- `df3e77c`, `1073dbf`, `51e0f17` **T** — breadcrumb transit visibility (procgen fade +
  Gaia visible during flight + procgen floor).
- `dabb99f` **E** — Gaia catalog exposure boost.
- `1626985` **BUG-4** — procgen LOD cap (`PROCGEN_MAX_DRAW_POINTS=90k`); also unblocks
  flythrough4 §5.4 near-Sol budget (same commit).

**2026-06-28…07-01 — combine, diagnostics, tour flake**
- `b205215` **BUG-8** — push-down combine (shallower catalog no longer dropped).
- `c6dc9ed` TASK-057 streaming error phase (structural fix for BUG-6 silent-storm class).
- `4708461` TASK-058 — `assertTileContributions` invariant on combine (BUG-8 class).
- `076ef80` TASK-059 error gate e2e.
- `2021026` **F** — m4a tour step-0 cinematic mount retry.

**CI status (2026-07-01):** all tracked gate specs green on `main` — m4a (×4 incl. tour),
flythrough4 (×3 browsers), soak3/soak4, error-gate, `pnpm verify`. The 2026-06-24 push
surfaced 6 failures; gates **G** + **S** cleared 5, **BUG-7** cleared the last.

## Recommended next steps (priority order, updated 2026-07-01)

**DONE — gates G/S, BUG-4/5/7/8/9/10 P0, transit T, exposure E, tour flake F.** See table.
**Sweep status: 15/16 tracked items closed** (BUG-2 functional); **BUG-2d** UX polish
deferred by product decision (2026-07-02).

**BUG-2 functional fix (landed 2026-07-02, TASK-053 session — uncommitted):**
- `dwellMs` auto-advance driver in `App.tsx` (pause/resume + dwell timer).
- `GRAND_TOUR` rewritten: Sol → `hyg:27919` (Betelgeuse) → TRAPPIST-1 (no `sol:saturn`).
- `TOUR_FRAMING_STANDOFF_PC` + `minStandoffPc` on splines — tour stays in galaxy context
  (does not auto-descend into the solar system like `goto` Sol does).
- `m4a.spec.ts` asserts auto-advance to step 1 after dwell.

**Deferred — BUG-2d (tour UX polish, NOT blocking TASK-053):**
- User report (2026-07-02): visible **screen jumps** between steps — does not feel like
  travelling smoothly to each star; **cinematic letterbox turns on and off** (flicker)
  across spline → orbit → next-step transitions.
- Root cause (code reading, no new profiling): per-step `playSpline`/`cancelCinematic`
  handoffs, letterbox tied to each spline (`letterbox: true`) not the whole tour, large
  inter-star distances with short fly-to splines, galaxy framing standoff vs orbit radius
  changes. Expected side-effect of Option B minimal fix — not the future tour design.
- **Decision (2026-07-02, user):** accept for Phase 4a gate closure; fix properly in a
  later **guided-tour redesign** task (continuous path, stable letterbox for tour duration,
  optional galaxy→system descent). See `docs/research/TASK-052-integration-bugs.md` §2d.

**Optional follow-ups (not blocking — polish / future tasks):**
- **BUG-4 polish** — distance/tier-aware procgen LOD: full cloud at far vantage on `high`,
  keep 90k cap on `low`/integrated. See `procgen-lod-near-sol.md` §Future + `integrated-gpu-targeting.md` Step 1.
- **BUG-1** nebula fine polish (iterative tuning loop).
- **BUG-10 P1/P2** — eviction count backstop + cut/frustum optimisation (agent briefs exist).
- **BUG-8 follow-up** — per-point catalog identity in combined tiles (`idPrefix` mixing;
  rendering correct, picking/labels wrong for Gaia-in-HYG tiles).
- **Gaia pack deploy (production)** — env-configurable manifest URL (TASK-065) + upload
  the ~4.7M pack to CDN/R2 so **deployed builds** serve the full catalog. Local dev has
  already exercised dense packs; CI/commit default remains the 135-star sample.

---

## BUG-1 — Nebula rendering looks wrong (green bokeh blobs)
- **Status:** IMPROVED + committed (`f8e6d89` initial fix, `4929d6d` Tier-A overhaul).
  Bokeh-disc read is FIXED; further visual polish DEFERRED to a separate iterative task.
- **Root cause:** the sprite (`createNebulaNoiseTexture`, `apps/web/src/glue/nebulae.ts`)
  was a plain radial gradient (no noise), and the shader's only per-layer variation is a UV
  *rotation* — a no-op on a radially symmetric texture → ~16 identical soft discs stacked
  additively = bokeh circles.
- **Fix applied (glue only, NOT the frozen `render-fx`):** replaced the gradient with a
  deterministic fBm value-noise field, and shape the alpha as `(noise − 0.34)·2.4 − r²·1.5`
  so the silhouette is RAGGED (filaments fade at different radii per direction) instead of a
  clean circle. Verified live at 30 pc + 161 pc + boot: reads as an irregular filamentary
  cloud with a bright core, not overlapping discs. The noise also makes the shader's
  per-layer UV rotation meaningful (varies each layer).
- **Deferred polish (separate task — knobs are in `glue/nebulae.ts`):**
  - Faint value-noise "cellularity" visible in extreme close-ups (GRID/octaves; consider
    gradient/Perlin noise or higher base GRID for smoother wisps).
  - Far/boot-distance brightness + tint balance (additive `CLOUD`/opacity tuning).
  - Optional: per-layer UV offset/scale in `render-fx` (frozen) for more variety.
- **Suspect/owning area:** `apps/web/src/glue/nebulae.ts` (sprite + field specs),
  `packages/render-fx` nebula shader (frozen — only if per-layer variance is pursued).

## BUG-2 — Guided tour gets stuck / doesn't advance — 🟡 FUNCTIONAL FIX (2026-07-02)

- **Status:** **functional blockers fixed** in working tree (TASK-053 session; see table).
  **BUG-2d** UX polish deferred — tour works but does not read as a polished flyover.
- **Original repro (pre-fix):**
  1. Click "Guided tour".
  2. Camera flies to the solar system, shows a distant view — then **gets stuck flying
     in circles** there.
  3. Navigating to Saturn: **the view does not move.**
- **What shipped (Option B):** dwell auto-advance (`App.tsx`), distinct-star `GRAND_TOUR`,
  galaxy framing standoff (`glue/tours.ts` `TOUR_FRAMING_STANDOFF_PC`). Tour no longer
  enters the solar system (unlike search/goto Sol). e2e: step-0 → step-1 auto-advance.
- **Research:** `docs/research/TASK-052-integration-bugs.md` §BUG-2 (2a/2b root cause),
  §2d (post-fix UX observations).

## BUG-2d — Tour UX: jumps + letterbox flicker (deferred)

- **Status:** ⏸️ **deferred** — documented user observation; not blocking TASK-053 / Phase 4a.
- **User report (2026-07-02, post BUG-2 fix):**
  - Between steps the view **jumps** rather than feeling like a continuous flight to the
    next star.
  - **Cinematic / letterbox mode flickers** — turns on and off during the tour instead of
    staying on for the whole experience.
- **Likely cause (code reading, confidence medium):**
  - Each step is an independent `playSpline` → optional `orbitBody` → dwell timer →
    `cancelCinematic` + next `playSpline` — hard cuts, not one continuous spline path.
  - Letterbox is per-spline (`buildFlyToSpline({ letterbox: true })`), so it drops between
    spline end, orbit, and the next spline start; `cinematicActive` in `__cosmos` mirrors
    that and appears to flicker in the HUD.
  - Galaxy-scale framing (`TOUR_FRAMING_STANDOFF_PC` ≈ 0.045 pc) prevents context switch
    but changes arrival geometry vs the old close approach — reads as a pop, not a glide.
  - Inter-star legs (Sol → Betelgeuse → TRAPPIST-1) span huge distances with a fixed
    ~6 s spline — not a authored “fly through the field” path.
- **Fix direction (future tour-redesign task, NOT now):**
  - One tour-level letterbox flag for the whole run (not per-step splines).
  - Single continuous camera path or cross-fade between authored segments.
  - Revisit galaxy→system descent and step content when the real educational tour is designed.
- **Decision (2026-07-02):** user accepts current behaviour for gate closure; polish when
  the tour is redesigned “for real.”

## BUG-3 — Cinematic view cannot be closed (UI button covered) — ✅ DONE
- **Status:** ✅ FIXED + committed (`f8e6d89`), confirmed shipped in code (`ui.css`
  `.cosmos-ui-overlays` z-index 101 + `App.tsx` Esc handler exits cinematic first). No
  longer an open bug — kept here only as a record. Two parts:
  1. `.cosmos-ui-overlays` z-index 90→101 (`packages/ui/src/ui.css`) so the controls
     (incl. the "Cinematic" toggle) paint above the letterbox bar.
  2. `Esc` exits the cinematic letterbox first (`apps/web/src/App.tsx` keydown handler).
  Verified in-browser: with cinematic ON the "Cinematic" button is the top element at its
  own center (`elementFromPoint` → BUTTON) and clickable; `Esc` clears the letterbox +
  store. `ui` is a frozen package (the z-index change is CSS-only, no API change).
- **Repro:** Open Cinematic → the cinematic overlay (letterbox?) covers the UI toggle,
  so there is no way to close it.
- **Notes:** Close/exit control is occluded or removed by the cinematic chrome.
  Need an always-on-top exit affordance (or Esc to exit).
- **Suspect area:** TASK-051 cinematic mode letterbox, TASK-050 overlay/tour chrome z-order.

## BUG-4 — Universe / Milky Way view GPU lag — ✅ FIXED (`1626985`)

- **Status:** FIXED + committed. The procgen cloud is capped to `PROCGEN_MAX_DRAW_POINTS =
  90_000` via `setDrawFraction` whenever the layer is on (~8% of the 1.1M cloud). App glue
  only (`GalaxyScene.tsx`); `setDrawFraction` already existed in `render-galaxy`. CI green;
  spiral readable at the ~49 kpc Milky Way vantage (user-verified on high-end hardware, 2026-07-01).
- **What it was:** GPU fill-rate overdraw — the full ~1.1M-point procedural Milky Way cloud
  drawn as additive sprites filling the disc from the far vantage (`toGalaxy` flythrough4
  segment). CPU was innocent (<0.3 ms/frame spans); the original ~40 ms p50 was pure GPU on
  weak hardware / SwiftShader. Tier-independent (M3 ≈ M4a). Research trail:
  `docs/research/bug-4-universe-lag.md` (pre-fix measurement, 2026-06-28).
- **Fix shipped (`1626985`, same commit that restored flythrough4 §5.4):** distance-
  independent cap at 90k points through the existing `setDrawFraction` knob. Opacity
  (`procgenBlend`) remains the sole visual fade — draw count is perf-only (avoids P2
  "nebulas without stars"). Reconciles "procgen lit closer to Sol" (transit fix T) with the
  near-Sol point budget gate.
- **Acceptance:** on integrated/weak GPUs the overdraw cliff is gone (~12× fewer fragments).
  On high-end discrete the spiral still reads; some inter-arm sparsity is visible — acceptable
  for now (decision 2026-07-01: leave as-is, revisit as polish).
- **Future polish (optional, not a bug):** the global 90k cap penalizes the Milky Way hero
  shot on GPUs that could afford the full cloud. Better shape (documented, not scheduled):
  1. **Distance LOD** — full `drawFraction` at ≥ `GAL_FADE_HI_PC` (~49 kpc); cap only in the
     mid band where the real catalog + procgen overlap.
  2. **Tier LOD** — wire `useQuality().tier` so `high` draws more at far vantage, `low`
     keeps 90k (`integrated-gpu-targeting.md` Step 1).
  3. **Brightest-N subset** instead of a uniform prefix (Option A in `procgen-lod-near-sol.md`).
  Knob today: `PROCGEN_MAX_DRAW_POINTS` in `GalaxyScene.tsx`.

## Gate health — flythrough4 acceptance gate is broken 3 ways (NEW, 2026-06-24)
The TASK-053 agent's `e2e/tests/flythrough4.spec.ts` ran in CI for the FIRST time on the
2026-06-24 push (it was untracked until committed in `b473317`). Re-measurement surfaced
three chained defects — **none fix in isolation**, so P1 resolves all three together.
- **C1 · path bug (breaks CI now).** `BASELINE_PATH` (spec line ~39) is built from
  `process.cwd()` assuming the repo root, but CI runs `pnpm --filter @cosmos/e2e exec
  playwright …` with cwd = `e2e/`, so it resolves to `e2e/apps/web/src/scene/…` →
  **`ENOENT` at `fs.readFileSync`** → the test throws on all 3 browsers. Fix: resolve the
  path relative to the spec file (`__dirname`/`import.meta.url`), not `process.cwd()`.
- **C2 · degenerate baseline.** The committed `flythrough4-m3-baseline.json` (`nearSol`
  1,000,000 pts / 1 draw) was recorded 2026-06-22 **with BUG-6 present** — octree dead,
  so it is the procgen cloud only. With BUG-6 fixed the real near-Sol is ~1.11M / 10 draws,
  so fixing C1 alone makes the gate FAIL (1.11M > 1M). Must re-record.
- **C3 · metric misses the win.** The near-Sol gate asserts `renderedPoints ≤ M3 baseline`,
  but the redundant layer the unification removes is the **HYG monolith drawn by StarScene**,
  which is NOT counted in `streaming.stats.renderedPoints`. Measured: M3 near-Sol 1,113,495
  vs M4a 1,113,630 — M4a is **135 pts HIGHER** (exactly the 135-star Gaia CI sample the
  combined octree adds), same draw count. So as written, the gate cannot see the saving and
  trends the wrong way. Decision needed: count the monolith in the probe's near-Sol metric
  (so M3's redundant layer shows up), or re-target the gate to a metric that captures the
  unification (e.g. total scene draw calls including the monolith). Then re-record (C2).

**RESOLUTION (`ec51eeb`).** C1 → resolve `BASELINE_PATH` from `__dirname`. C3 → the probe
now captures `gl.info.render` scene totals (`peakSceneDrawCalls`/`peakScenePoints`), and
the drop is asserted on the **toSol** segment only (galaxy context, where the monolith
coverage-gate fires; toEarth is system context and redraws the monolith in both tiers,
washing the win out). C2 → re-recorded M3 toSol `sceneDraws=40 scenePts=109,971`; M4a culls
the monolith → `39 / 572` (clean drop, huge margin on points). Green on all 3 browsers + verify.

## Gate health — S · soak3/soak4 churn proxy broke (NEW, 2026-06-24)
- **Symptom:** soak3 AND soak4 failed `expect(requestsIssued).toBeGreaterThan(loops*20)`
  (= 100) — observed `requestsIssued=8`. The heap-plateau assertion (the real goal) PASSED
  (`fittedRise=0.0%`).
- **Root cause:** **a side-effect of the BUG-6 fix.** Before it, octree tiles never loaded
  (fetch threw) and were re-requested ~6/frame, so `requestsIssued` was a ~14k storm and the
  churn gate keyed on it. With BUG-6 fixed, tiles load once and persist in a bounded cache:
  `requestsIssued` is small (≈ unique tiles, ~8) while the genuine load↔release signal is now
  the ready-set oscillation the old comment had *avoided* (`loaded=2..10`). The gate depended
  on the bug's symptom.
- **Fix (`4d13f77`):** re-target the churn proxy from `requestsIssued > loops*20` to
  `loadedMax > loadedMin` (ready set grows on approach, shrinks on exit) + a `requestsIssued
  > 0` liveness floor + the existing `inFlightMax >= 2`. Gate on the correct deterministic
  proxy, no coping tooling ([[ci-test-infra-philosophy]]). Green: soak3 + soak4 on chromium.

## BUG-5 — Labels jitter when camera moves — ✅ FIXED (`4606a55`)
- **Status:** FIXED + committed. `pnpm verify` green; verified live in-browser.
  App-glue only — no frozen package touched (`ui` `LabelLayer` left as-is; the app's HUD
  now owns an imperative label host).
- **Root cause (as researched):** labels were projected on a `setInterval` at
  `LABEL_PROJECT_INTERVAL_MS` (100 ms ≈ 10 Hz) and pushed through React state
  (`subscribeLabels`→`setLabels`), while the scene renders at ~60 Hz. Between projections
  the DOM labels were frozen in pixel space → they visibly stepped/swam relative to their
  targets whenever the camera moved.
- **Fix (split membership from position):**
  - `glue/overlays.ts`: replaced the `ProjectedLabel[]` snapshot pub/sub with a `LiveLabel`
    buffer. `publishLabelSet`/`subscribeLabelSet` carry only the label SET (membership —
    rare: overlay load or the Labels toggle), pre-sorted by priority. `liveLabels()` is a
    shared buffer whose `xPx`/`yPx`/`visible` are mutated in place.
  - `scene/Overlays.tsx`: the world→screen projection moved OUT of the `setInterval` and
    INTO the existing per-frame `useFrameContext(…, PRIORITY_RENDER)` callback — it mutates
    the live buffer in place every frame (zero allocation, §9). A small effect drives
    membership off the overlay store (`publishLabelSet` on toggle/overlay change).
  - `hud/Hud.tsx`: `LabelLayerHost` is now imperative (the `SpeedReadout` pattern). React
    renders only the SET of `<span>` nodes (rare); a per-frame rAF loop reads `liveLabels()`
    and writes each node's `left`/`top`/`visibility` directly — zero React renders, never
    re-renders the Canvas (§5.12). De-clutter cap (`LABEL_MAX_VISIBLE=24`) applied in the loop.
- **Verified live (real Chromium preview):** with Labels on + camera strafing, the focused
  label's `style.left` changed on **39 of 39** consecutive frames (smooth monotonic drift),
  `longestStaticRun=0` — i.e. per-frame tracking, no 10 Hz staircase. Toggling Labels off
  clears the DOM (`.cosmos-ui-label` → 0, matches the `m4a.spec.ts` overlays assertion). No
  console errors. (Was related to BUG-7, now fully decoupled — BUG-7 was boot-orientation,
  not cadence.)
- **Files:** `apps/web/src/glue/overlays.ts`, `apps/web/src/scene/Overlays.tsx`,
  `apps/web/src/hud/Hud.tsx`.

## BUG-6 — Octree tiles never load (`fetch` Illegal invocation) → coverage always 0 — ✅ FIXED (`f8e6d89`)
- **Status:** FIXED + committed (`packages/data/src/octree.ts`). Verified live: coverage 0 →
  **1.0**, octree tiles load, procgen fades to 0. TASK-057 adds structural error handling so
  tile-load failures are no longer silently swallowed (the BUG-6 storm class).
- **Was:** blocks the Phase 4a gate (ADR-006 §5.4) AND fails the pre-existing `m4a.spec.ts`
  "tier unification" test → a real defect, not a harness artifact.
- **Root cause (measured live, not theory):** `OctreeSourceImpl.loadTile`
  ([octree.ts:130](packages/data/src/octree.ts:130)) called `this._fetchImpl(binUrl)` — i.e.
  the real browser `fetch` invoked with the `OctreeSourceImpl` instance as receiver →
  **`TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`**. So EVERY tile
  load rejects. The manifest fetch ([octree.ts:196](packages/data/src/octree.ts:196)) does a
  bare `fetchImpl(url)` (receiver = undefined) which `fetch` tolerates — that's why
  manifests load 200 but tiles never do. The streaming policy SWALLOWS the rejection
  ([policy.ts:325](packages/streaming/src/policy.ts:325) `.catch(() => onError(c))`), so the
  8 cut tiles near Sol are re-requested ~6/frame forever (a silent failed-request storm),
  `loadedChunks` stays 1 (procgen only), `catalogCoverage` stays 0, the procgen never fades.
- **Fix:** call through an unbound local (`const fetchImpl = this._fetchImpl; await
  fetchImpl(binUrl, …)`), matching the working manifest call. One line.
- **Why undetected:** unit tests inject a mock `fetch`; a mock called as a method does NOT
  throw (only the real browser `fetch` enforces the Window receiver). And no gate asserted
  octree tiles actually reach `ready` (`loadedChunks ≡ 1` was tolerated through M3 + M4a).
  Follow-up: the gate should assert catalog tiles load (cf. [[ci-test-infra-philosophy]]).
- **Knock-on:** also reduces overdraw near Sol (procgen now fades when catalog covers).
  The TASK-053 `flythrough4` near-Sol baseline was re-recorded after BUG-6 + BUG-4 fixes.

## BUG-7 — Labels never render in the DOM (overlay e2e fail) — ✅ FIXED (`3322b87`)
- **Status:** FIXED + committed (app glue only). `m4a.spec.ts` overlays passes; full m4a
  (×4) + `pnpm verify` green.
- **Root cause (measured, not theory — instrumented `publishLabels`/the projection and
  dumped NDC for all 40 labels at boot):** it was the test-environment tension, NOT a
  gating bug. The label set = the 40 brightest *named* stars = intrinsically luminous
  giants (Rigel, Deneb, Alnilam…), all hundreds of pc out and scattered across the sky.
  The boot vantage (`NavDriver.INITIAL_CAMERA`, identity orientation, 0.06 pc from Sol)
  frames an arbitrary patch of sky in which **none** of those giants land inside the
  screen frustum → every label projects in-front-but-off-screen (or behind), so
  `LabelLayer` (which filters to `visible`) renders nothing. Both the old and the corrected
  projection compute 0 visible at boot — correctly. The user saw labels jitter because they
  had *flown/rotated* the camera onto stars (BUG-5); the pristine boot orientation simply
  shows none. (The `z ≈ 1` I first saw was rounding of ~0.999, not far-plane clipping — the
  far plane is `1e9`; that red herring is recorded so it isn't re-chased.)
- **Fix (two parts, app glue only):**
  1. **e2e determinism (the actual gate fix):** added `__cosmosDev.focusFirstLabel()` (same
     dev-hook pattern as `setTier`/`startTour`) which `goTo`s + `lookAtTarget`s the brightest
     label, stopping ~1 pc short so it reorients toward the star and stays in galaxy context.
     The overlays spec calls it before asserting the `.cosmos-ui-label` DOM, so the gate no
     longer depends on the boot orientation. ([[ci-test-infra-philosophy]]: gate on a
     deterministic state, not on luck-of-the-boot-vantage.)
  2. **latent projection bug (found while debugging, fixed):** the `visible` test used a
     plain `.project()` + NDC-box check; a point *behind* the camera divides by a negative
     `w`, which can sign-flip its x/y back into `[-1,1]` and surface a phantom label for a
     star that is behind you. Now resolve view space first and gate on the camera-space sign
     (`z < 0 ⇒ in front`) before the NDC bounds. No regression for on-screen labels.
- **Files:** `apps/web/src/App.tsx` (dev hook ×2 scenes + Window type), `apps/web/src/scene/
  Overlays.tsx` (projection), `e2e/tests/m4a.spec.ts`.
- **Related:** BUG-5 (same projection path) is the per-frame-cadence jitter fix — also
  closed (`4606a55`). BUG-7 was never about cadence.

## BUG-8 — Gaia never renders inside the galaxy (combine drops a source) — ✅ FIXED (`b205215`)
- **Status:** FIXED + committed + gated by deterministic unit tests (`pnpm verify` green).
  TASK-058 (`4708461`) adds `assertTileContributions` as a runtime invariant on the combine
  path. App glue only (`apps/web/src/glue/octree-combined.ts`); no frozen package touched.
  Full write-up: `docs/research/bug-8-combine-drops-source.md`.
- **Symptom:** inside the galaxy you see the HYG catalog (~120k) but **zero Gaia**, despite
  BUG-6 (tile loads) being fixed. The streaming catalog tier is `HYG ∪ Gaia` (deduped) and
  should show both — Gaia adds the faint nearby stars HYG lacks; it is *most* expected near
  Sol where the sample is region-clipped (≤600 pc).
- **Root cause (deterministic, read + reproduced by test):** the shared Morton FRAME does
  not imply a shared tree SHAPE. `buildOctree` splits by density (`MAX_POINTS_PER_TILE =
  32768`): HYG (~109k) subdivides into 8 level-1 leaves; the Gaia CI sample (135 pts) stays
  a **single root-level leaf**. `combineOctreeSources.mergeNode` OR-ed the child masks, so
  the combined root is **interior** (inherits HYG's children). The policy's SSE descent
  skips the interior root tile and loads the finer leaves — but Gaia's points live ONLY in
  the root tile, which is never in the cut ⇒ **Gaia is never loaded**. Generic defect:
  `combineOctreeSources` silently drops the points of whichever source terminates (is a
  leaf) at a shallower level than the other. **Bidirectional** — with the full Gaia pack
  (denser than HYG, ADR-006) HYG's leaves would be the ones orphaned under Gaia's deeper
  cut, so HYG would vanish where Gaia is dense. This is the form that matters for the
  Cloudflare/production deploy.
- **Fix:** push-down at load time. When loading a cut node, each source contributes either
  (a) its own tile at that key, or (b) the subset of its deepest LEAF-ancestor's points that
  fall inside the cut cell, rebased to the cell centre. Octree cells partition space ⇒ each
  pushed point lands in exactly one cut cell (no double draw). Decoded ancestor tiles are
  cached so the shared ancestor is fetched once across sibling cut cells.
- **Test / proof (`apps/web/src/glue/octree-combined.test.ts`, new vitest setup for the
  app):** reproduces the loss (Gaia orphaned under HYG leaves) AND the mirror (a shallow
  leaf source pushed 2 levels into a deeper cut, order-independent), plus far-view root +
  single-source pass-through. Against the ORIGINAL combine, the two push-down tests FAIL;
  with the fix all pass. Coverage of `octree-combined.ts` 90%+, gated in `pnpm verify`.
- **Known follow-up (latent, pre-existing — flagged, NOT fixed here):** `concatBatches`
  merges HYG + Gaia points into one `StarBatch` with a single `idPrefix` (= the first
  source's). So Gaia points sharing a tile with HYG get bodyId `hyg-v41:<gaiaId>` instead of
  `gaia:<gaiaId>` → wrong identity for picking/labels. Positions/colours/magnitudes are all
  correct, so it does not affect *rendering* (the BUG-8 goal). Fixing it needs `StarBatch`
  to carry per-point catalog identity (touches frozen core-types/render contracts) → its own
  task.
- **Cloudflare:** the fix is pure bundle glue → it deploys automatically with the app; the
  bidirectional push-down is exactly what keeps HYG visible once a real (denser) Gaia pack
  is served. If production should serve a real Gaia pack from a CDN/R2 rather than the
  committed 135-star sample, the remaining step is to make `GAIA_OCTREE_MANIFEST_URL`
  (`apps/web/src/App.tsx:115`) env-configurable (`VITE_*`) — open decision, not done.

## BUG-10 — Dense (~3M) Gaia pack thrashes streaming → hang on move — ✅ P0 FIXED
- **Status:** **P0 fixed + committed** (`5dedef1` `perf(streaming): rewrite enforceBudgets
  O(n²)→O(n)`). Full investigation + live numbers: `docs/research/bug-10-streaming-density-wall.md`.
- **Real root cause (measured, not the original guess):** 99.6% of the frame was
  `enforceBudgets` ([policy.ts](../../packages/streaming/src/policy.ts)), an **O(cut²)** collapse —
  per `while` iteration it re-scanned the whole coverage list (`sumCoveragePoints`) and called
  `parentKey` (Morton decode+encode, string ops) per element to find the deepest collapsible node.
  A 754-node cut (the 3M pack near Sol) ⇒ ~384 ms/frame ⇒ **~1.2 fps even static**. The render was
  0.1 ms; selection 0.1 ms. The original handoff's framing (unbounded loaded-tile count + push-down
  per-tile cost) was **wrong on both counts**: residency is bounded (see P1 below), and the
  push-down is now shipped separately as BUG-8 (`b205215`).
- **Fix:** rewrote `enforceBudgets` as an O(cut) deepest-first bucket-by-level collapse with
  incremental `pts`/`draws` totals — same greedy semantics, each node visited O(1) times.
  Re-measured on the 3M at Sol: enforce **384 ms → 1.9 ms**, update total **385 → 2.0 ms**,
  **1.2 → 164 fps** (== the 135-star baseline). Added read-only diagnostics
  (`cutSize`/`pendingCount`/`trackedChunks`/`evictionsTotal`/`phaseMs()`) on `StreamingStats`,
  mirrored to `window.__cosmos.streaming`. `@cosmos/streaming` 28/28 + `pnpm verify` green.
- **P1 (low-priority hardening) — evict-by-count backstop.** Re-measured residency by flying
  Sol→18 kpc: `evictionsTotal` 0→699, resident `tracked` 885→186, fade tail shrinking — **no
  leak; the graceful step-6 evict bounds residency on motion.** The only residual is the
  byte-gated LRU being unreachable (<17M resident points), a latent mis-tuning. Brief (scoped as
  defensive, not firefighting): `BUG-10-P1-eviction-count-backstop.md`.
- **P2 (optimisation) — cut/point budget + frustum culling.** Now optional (post-P0 the 3M is
  smooth); worth it only for far denser packs. See the research doc §"Solution space".
- **Sequel (the actual payoff, not a bug) — procgen near Sol.** With the perf wall gone, the
  measured answer to "what does the real density look like from inside" is: the bright catalog is a
  **sparse** star field; the dense galaxy look is all procgen, which is faded off near Sol. Design
  brief to give "inside" some density: `procgen-near-sol-density-blend.md`. See also the memory
  note `procgen-still-belongs-real-density-sparse.md`.
