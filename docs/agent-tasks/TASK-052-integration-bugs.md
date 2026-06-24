# TASK-052 M4a Integration — Bug Investigation & Status (handoff)

Single source of truth for the M4a integration bug sweep: root-cause investigation +
current status of every bug + what's done vs pending + next steps. Bugs 1–5 were found by
manual inspection; bugs 6–7 were surfaced by the TASK-053 phase-4a gate run. Deeper
pre-fix analysis of 1–5 also lives in `docs/research/TASK-052-integration-bugs.md`.

Status legend: `open` · `fixed` · `improved` · `deferred`

## Status summary

| Bug | What | Status | Owner area / notes |
|-----|------|--------|--------------------|
| **6** | Octree tiles never load (`fetch` Illegal invocation) → coverage 0 | ✅ **fixed + committed** (`f8e6d89`) | `packages/data`; re-measured on the scripted path → coverage 1.0, tiles load, procgen fades (validated) |
| **3** | Cinematic view can't be closed (button covered) | ✅ **fixed + committed** (`f8e6d89`) | `ui.css` z-index + `App.tsx` Esc |
| **1** | Nebulae render as flat green bokeh discs | 🟡 **improved + committed** (`f8e6d89`) | `glue/nebulae.ts`; fine polish → **separate task** |
| **2** | Guided tour gets stuck / Saturn won't move | ⏳ **open** | app glue; decision made (Option B) |
| **4** | Universe view laggy | ⏳ **open — root cause MEASURED** | GPU fill-rate (procgen cloud overdraw, tier-independent); fix = count-LOD in `render-galaxy` (frozen). See §BUG-4 |
| **G** | flythrough4 gate is broken 3 ways (path ENOENT + degenerate baseline + metric misses the monolith) | ⏳ **open — blocks CI** | the gate the TASK-053 agent shipped; never ran in CI until 2026-06-24 push. See §Gate health |
| **5** | Labels jitter when camera moves | ⏳ **open** | label projection cadence |
| **7** | Labels never render in the DOM (e2e) | ⏳ **open** | label gating; investigate with BUG-5 |
| **8** | Gaia never renders inside the galaxy (combine drops a source) | ⏳ **root-caused; fix DEFERRED** (reverted, not shipped) | push-down design + test recorded in `docs/research/gaia-visibility-real-pack-and-perf.md`; revive with a real pack |
| **9** | Procgen Milky Way never renders (empty overview / "Milky Way black") | ⏳ **open** | `coverage()`≡1 trivial → `procgenBlend`=0; see `docs/research/gaia-visibility-real-pack-and-perf.md` |
| **10** | Dense (~3M) Gaia pack thrashes streaming → hang on move | ⏳ **open** | loaded-tile count unbounded + push-down per-tile cost; see gaia research doc |

## Committed state (2026-06-24)

BUG-1/3/6 + the TASK-053 gate harness are committed on `main` and pushed (5 commits:
`f8e6d89` fix m4a, `bde7dbd` perf pack-octree, `b473317` test phase-4a, `129299d` docs,
`86c3fd3` chore gitignore). `pnpm verify` + `check:bundle` were green before commit.
**flythrough4.spec.ts ran in CI for the first time on this push** — see §Gate health.

## Recommended next steps (priority order, decided 2026-06-24)

**P1 — make the flythrough4 gate correct & green (Gate health C1+C2+C3 TOGETHER).**
CI is red *now* on the just-pushed flythrough4 spec, and the three sub-issues are
chained: fixing the path (C1) exposes that real M4a (~1.11M) exceeds the degenerate
baseline (1M); re-recording the baseline (C2) still fails because the metric misses the
monolith (C3). Sub-order: C1 (path, trivial) → C3 (decide the metric so the unification
win is visible) → C2 (re-record the baseline with the corrected metric). A broken/mis-
measuring gate is worse than none (false signal) — fix the gate root cause, not the
symptom ([[ci-test-infra-philosophy]]).

**P2 — BUG-4 real fix: count-LOD the procgen cloud at universe scale.** The actual perf
bug and the most visible (40ms→~16ms target), but it does NOT block CI (known perf, not a
regression), is the biggest, and touches `render-galaxy` (frozen) → its own reviewed
commit/task ([[frozen-package-defects]]). Keep it out of the P1 test-plumbing batch.

**Then (unchanged, after P1/P2):**
- **BUG-2** (tour) — most self-contained; Option B (distinct-star steps + `dwellMs`).
- **BUG-5 + BUG-7** (labels) — together (same projection path).
- **Separate task:** nebula visual polish (BUG-1 deferred list).
- **Separate task (decided):** full guided-tour redesign.

---

## BUG-1 — Nebula rendering looks wrong (green bokeh blobs)
- **Status:** IMPROVED in working tree (provisional, not committed). Bokeh-disc read is
  FIXED; further visual polish DEFERRED to a separate iterative task (user decision — it's
  a tuning loop and this session is context-heavy). User confirmed the new look is better.
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
  - Optional: per-layer UV offset/scale in `render-fx` (frozen) for more variety; and
    re-check overdraw cost (ties to BUG-4).
- **Suspect/owning area:** `apps/web/src/glue/nebulae.ts` (sprite + field specs),
  `packages/render-fx` nebula shader (frozen — only if per-layer variance is pursued).

## BUG-2 — Guided tour gets stuck / doesn't advance
- **Status:** open — root-caused (see research). **Decision: Option B (temporary
  galaxy-scale tour); proper tour design deferred to a future explicit task.**
- **Repro:**
  1. Click "Guided tour".
  2. Camera flies to the solar system, shows a distant view — then **gets stuck flying
     in circles** there.
  3. Navigating to Saturn: **the view does not move.**
- **Notes:** Two symptoms, may be one root cause: tour playback not advancing past a
  waypoint / auto-orbit loop never releasing to the next spline segment; and a goto
  (Saturn) being ignored while tour state owns the camera.
- **Suspect area:** TASK-051 cinematic/spline playback + auto-orbit, tour store (TASK-049),
  nav goto context switch interaction.

## BUG-3 — Cinematic view cannot be closed (UI button covered)
- **Status:** FIXED + verified live (not committed). Two parts:
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

## BUG-4 — Universe view is laggy
- **Status:** open — root cause **MEASURED twice**. **GPU fill-rate, NOT CPU.**
- **Re-measurement (2026-06-24, real-browser Chromium, BUG-6 fix in place).** Ran the
  flythrough4 probe in both tiers on the identical scripted path. Per-segment p50:

  | segment | M3 p50 | M4a p50 | pts | draws | coverage | procgen |
  |---------|--------|---------|-----|-------|----------|---------|
  | toGalaxy (universe) | **44.3 ms** | **40.0 ms** | 1.11M | 10 | 1.00 | **1.00** |
  | toSol | 16.6 ms | 16.8 ms | 1.11M | 10 | 1.00 | 0.00 |
  | toEarth | 16.6 ms | 16.7 ms | 1.11M | 10 | 1.00 | 1.00 |

  Span profile (M4a, whole run, n=453 frames): `streaming.update` total 92 ms (avg
  0.20 ms), `nav.update` 18 ms, `galaxy.render` 9 ms — **every CPU span sums to <0.3 ms
  per frame.** So the 40–44 ms universe frames are pure GPU.
- **Confirmed facts:**
  1. The lag is **tier-independent** — M3 (44 ms) and M4a (40 ms) are equally slow in the
     universe segment. It is NOT a tier-unification problem; it is the shared galaxy
     composition. (toSol/toEarth are a healthy ~16 ms in both.)
  2. In `toGalaxy`, `procgen=1.00` while `coverage=1.00` — the coverage-driven fade does
     NOT apply in the universe context (correct: from outside, the procgen cloud *is* the
     galaxy). So the cloud renders at full there by design and cannot simply be removed.
  3. The procgen point SIZE is already clamped (`uMaxPointPx`, `galaxy.vert.glsl.ts`), so
     the overdraw is from the **count** (1M overlapping additive points filling the disc),
     not oversized points.
- **Fix direction (P2):** **count-LOD** the procgen cloud when far out (universe scale) —
  draw a fraction of the 1M points / a coarser cloud while the silhouette still reads;
  optionally gate the additive nebula layers harder by distance. The point-size clamp is
  not the lever. Verify on SwiftShader (CI exaggerates fill cost), not just real GL.
- **Touches `render-galaxy` (frozen)** → own reviewed commit/task ([[frozen-package-defects]]).
- **Suspect area:** procgen Milky Way cloud (`render-galaxy`, the cloud emit in the
  streaming policy / glue), nebula additive layers (`render-fx` / `glue/nebulae.ts`).

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

## BUG-5 — Labels jitter when camera moves
- **Status:** open
- **Repro:** Enable Labels → move camera → labels jitter/shake.
- **Notes:** Root-caused in research: labels projected on a 10 Hz setInterval + React
  state while the scene renders at ~60 Hz → frozen in pixel space between updates. Fix:
  per-frame imperative projection (SpeedReadout pattern). **NOTE the related NEW BUG-7
  below** — the gate's overlay e2e says labels never render in the DOM at all; reconcile
  the two (the user DID see labels jittering, so they render in the real app — BUG-7 may
  be test-environment/timing specific). Investigate together.
- **Suspect area:** label layer (`scene/Overlays.tsx` projection, `ui` LabelLayer).

## BUG-6 — Octree tiles never load (`fetch` Illegal invocation) → coverage always 0 (NEW)
- **Status:** FIXED in working tree (`packages/data/src/octree.ts`). `pnpm verify` green.
  Verified live: coverage 0 → **1.0**, octree tiles load (8 visible near Sol), procgen
  fades to 0. **Frozen-package fix (`data`) — wants a separate reviewed commit**
  ([[frozen-package-defects]]). Not yet committed.
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
- **Knock-on:** also reduces overdraw near Sol (procgen now fades when catalog covers) —
  relevant to BUG-4. The TASK-053 `flythrough4` near-Sol baseline numbers the agent
  recorded are now stale (they were measured with the catalog tier dead) — re-record.

## BUG-7 — Labels never render in the DOM (NEW — overlay e2e fail)
- **Status:** open — found by the TASK-053 gate agent. `m4a.spec.ts` overlays test:
  toggling labels via the store never produces label elements in the DOM.
- **Tension to resolve:** the USER observed labels *jittering* (BUG-5) — i.e. they DO
  render in the real app. So BUG-7 may be a test-environment/timing issue (e.g. labels only
  project when the overlay is mounted + in galaxy context + targets on-screen), OR a real
  gating bug that only manifests under the e2e's conditions. Investigate alongside BUG-5
  (same label projection path, `scene/Overlays.tsx:133-168` + `Hud.tsx` LabelLayerHost).
- **Suspect area:** label projection gating (`showLabels` ref, context/visibility),
  `subscribeLabels` pub/sub.

## BUG-8 — Gaia never renders inside the galaxy (combine drops a source) (NEW)
- **Status:** FIXED in working tree + gated by a deterministic unit test (`pnpm verify`
  green). NOT committed. App glue only (`apps/web/src/glue/octree-combined.ts`); no frozen
  package touched.
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
