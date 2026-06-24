# TASK-052 M4a Integration — Bug Investigation & Status (handoff)

Single source of truth for the M4a integration bug sweep: root-cause investigation +
current status of every bug + what's done vs pending + next steps. Bugs 1–5 were found by
manual inspection; bugs 6–7 were surfaced by the TASK-053 phase-4a gate run. Deeper
pre-fix analysis of 1–5 also lives in `docs/research/TASK-052-integration-bugs.md`.

Status legend: `open` · `fixed` · `improved` · `deferred`

## Status summary

| Bug | What | Status | Owner area / notes |
|-----|------|--------|--------------------|
| **6** | Octree tiles never load (`fetch` Illegal invocation) → coverage 0 | ✅ **fixed + verified** (not committed) | `packages/data` — **frozen pkg → own reviewed commit** |
| **3** | Cinematic view can't be closed (button covered) | ✅ **fixed + verified** | `ui.css` z-index + `App.tsx` Esc |
| **1** | Nebulae render as flat green bokeh discs | 🟡 **improved** (provisional) | `glue/nebulae.ts`; fine polish → **separate task** |
| **2** | Guided tour gets stuck / Saturn won't move | ⏳ **open** | app glue; decision made (Option B) |
| **4** | Universe view laggy | ⏳ **open** | GPU fill-rate; re-measure after BUG-6 |
| **5** | Labels jitter when camera moves | ⏳ **open** | label projection cadence |
| **7** | Labels never render in the DOM (e2e) | ⏳ **open** | label gating; investigate with BUG-5 |
| **8** | Gaia never renders inside the galaxy (combine drops a source) | ⏳ **root-caused; fix DEFERRED** (reverted, not shipped) | push-down design + test recorded in `docs/research/gaia-visibility-real-pack-and-perf.md`; revive with a real pack |
| **9** | Procgen Milky Way never renders (empty overview / "Milky Way black") | ⏳ **open** | `coverage()`≡1 trivial → `procgenBlend`=0; see `docs/research/gaia-visibility-real-pack-and-perf.md` |
| **10** | Dense (~3M) Gaia pack thrashes streaming → hang on move | ⏳ **open** | loaded-tile count unbounded + push-down per-tile cost; see gaia research doc |

## Working-tree state (this session, NOT committed)

On branch `main`. Uncommitted changes relevant to these bugs:
- `packages/data/src/octree.ts` — **BUG-6 fix** (frozen pkg; wants its own reviewed commit).
- `packages/ui/src/ui.css` — **BUG-3** z-index (frozen pkg; CSS-only, no API change).
- `apps/web/src/App.tsx` — **BUG-3** Esc handler (also carries the TASK-053 agent's
  flythrough4/soak4 debug-mode wiring).
- `apps/web/src/glue/nebulae.ts` — **BUG-1** sprite (provisional improvement).
- Plus the TASK-053 gate agent's harness: `Flythrough4Probe.tsx`,
  `flythrough4-m3-baseline.json`, `e2e/tests/flythrough4.spec.ts`, `soak3.spec.ts`,
  `frame-profiler.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`.
- `pnpm verify` is GREEN with all of the above. No temporary diagnostic hooks remain.

## Recommended next steps

1. **BUG-2** (tour) — most self-contained; decision already made (Option B): rewrite the
   tour steps to distinct stars + add `dwellMs` auto-advance. App glue, no frozen pkg.
2. **BUG-5 + BUG-7** (labels) — investigate together (same projection path); resolve the
   "jitters in app vs never-renders in e2e" tension.
3. **Re-measure BUG-4** — the BUG-6 fix should have cut near-Sol overdraw; re-record the
   TASK-053 `flythrough4` baseline (the agent's numbers were taken with the catalog tier
   dead) and profile GPU fill-rate.
4. **Commit BUG-6** as its own reviewed commit (frozen `data` pkg) — branch off `main`.
5. **Separate task:** nebula visual polish (see BUG-1 deferred list).
6. **Separate task (already decided):** full guided-tour redesign after the bug sweep.

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
- **Status:** open — MEASURED by the TASK-053 gate agent. **Root cause = GPU fill-rate,
  NOT CPU.** Per-frame `profileSpan` accounts for only ~1 ms of a ~33 ms universe frame
  (universe p50 33 ms vs system p50 16 ms; dominant CPU span `streaming.update` ~0.6 ms
  avg). No main-thread JS hot path. The cost is **overdraw**: the 1,000,000-point additive
  procgen Milky Way billboard (single draw call) + the additive nebula fields at universe
  scale. SwiftShader (CI) exaggerates it; WebKit on a real GL ran a flat 16 ms p50.
- **Fix direction:** reduce overdraw at universe scale — e.g. shrink/cap the procgen cloud
  point size or count when far out, gate nebula additive layers harder by distance/tier,
  or LOD the procgen cloud. Profile **GPU/fill-rate** (not CPU spans) to confirm the win.
- **Suspect area:** procgen Milky Way cloud (`glue/milky-way-gen.ts`, `render-galaxy`),
  nebula additive layers (`render-fx` / `glue/nebulae.ts`), quality tiers.

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
