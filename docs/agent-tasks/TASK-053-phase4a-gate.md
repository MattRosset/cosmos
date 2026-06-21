# Task: Phase 4a acceptance gate — M4a, tier-unification budgets, perf/soak, cross-browser

**ID:** TASK-053
**Target package:** `apps/web` (debug mode) + `e2e/` + `.github/` + `docs/`
**Size:** M — **GATE: closes Phase 4a** (architecture §6 Phase 4 / M4 acceptance, terrain
deferred)
**Phase:** 4
**Depends on:** TASK-052

## Goal

Prove M4a before any Phase-4b (terrain) task authoring begins. M4a is the architecture §6
Phase-4 milestone **minus the deferred terrain clause** (see Milestone note). This task
adds the M4a acceptance harness, asserts the
[ADR-006](../decisions/ADR-006-gaia-subset-tier-unification.md) §5.4 **render-tier-unification
budget win** (the headline measurable), re-runs perf/soak across the browser matrix, and
records the M4a manual checklist. When this task is `done`, the public APIs of
`render-fx`, the v2 surface of `render-planets` (atmosphere), the v4 surface of `data`
(constellations), the v3 surfaces of `app-state`/`ui`, the v5 surface of `nav`, the v1.1
surface of `streaming`, and the Gaia/octree pack surface freeze — and **Phase 4b (terrain)
specs may be written** (the next sanctioned thaw window).

## Milestone note (architecture §6 M4, terrain deferred — record explicitly)

§6's M4 reads: *"atmospheric Earth flyover, descend toward procedural exoplanet terrain,
guided tour mode for education use."* Chunked planet **terrain is deferred to Phase 4b**
(planning decision, recorded in `docs/agent-tasks/README.md`). **M4a** is therefore:
*atmospheric Earth flyover over a Gaia-dense sky, with nebulae, constellation/label
overlays, a guided educational tour, and cinematic camera mode — no loading screens,
budgets improved vs M3 near Sol.* The "descend toward procedural terrain" clause moves to
**M4b**. This split is recorded here per the TASK-041 doctrine ("milestone-wording
deviations: record explicitly, never silently").

## The tier-unification budget gate (automated, CI — ADR-006 §5.4)

The headline acceptance criterion (the whole point of the unification, handoff doc §3):

- Extend the existing recorded descent (`?debug=flythrough3`, the M3 path) or add
  `?debug=flythrough4` that replays the **same** keyframe path with the M4a app (Gaia
  loaded, procgen coverage-faded, monolith gated). Record `streaming.stats` (renderedPoints,
  drawCalls) + `catalogCoverage` per ~1 s onto `window.__flythrough4Result`.
- **PASS (fixed):** **near Sol** (the path's inner segment), `renderedPoints` and
  `drawCalls` are **≤ the recorded M3 baseline** for the same path segment (a *drop* or
  equal, never a rise) — proving fewer redundant layers despite Gaia adding stars to the
  field; AND `procgenOpacity → ~0` where `catalogCoverage → ~1`; AND the inherited caps
  hold (`inFlight ≤ 6`, `renderedPoints ≤ 2M` at high, `drawCalls ≤ 300`). The M3 baseline
  numbers are committed alongside the spec (a small JSON, the keyframe-baseline precedent).

## M4a feature e2e (automated, CI)

`e2e/tests/m4a.spec.ts` (from TASK-052) is re-asserted here and extended:

- **Atmosphere quality gate (ADR-005 §5):** atmosphere present at tier `high`, absent at
  `medium`/`low` (forced via `qc.setTier`).
- **Overlays:** constellations + labels toggle on/off via the store and render/clear.
- **Tour + cinematic:** the committed tour runs end-to-end (each step flies nav to its
  target; `cinematicActive`/`letterbox` behave; exit returns to free flight).

## Perf + soak + cross-browser (architecture §6 / §5.8 — inherited harness)

- **Perf (CI-relaxed, the TASK-041 split):** the descent's p95 frame time clause stays on
  the reference-machine manual checklist (CI runs SwiftShader — the TASK-041 doctrine);
  CI gates the **deterministic** work-budget caps + the unification budget drop above,
  across **chromium + webkit + firefox** (the §6 cross-browser requirement; WebKit/Firefox
  skip the `performance.memory` heap clause).
- **Soak:** re-run `?debug=soak3` (now with Gaia tiles + nebulae + overlays mounted) —
  heap **plateaus** over the second half, eviction churns. Atmosphere/nebula/line-set/label
  mounts must not leak across the loop (dispose on context exit) — the soak proves it.
- **Lighthouse:** thresholds unchanged from TASK-017 (performance ≥ 0.85, interactive
  ≤ 4000 ms) with the Gaia sample + constellation packs in `dist`.

## Re-asserted gates (no new code)

- Lane determinism: `pnpm --filter @cosmos/pack-octree test` (incl. Gaia mode),
  `pnpm --filter @cosmos/pack-constellations test`, `pnpm --filter @cosmos/render-fx test`,
  `pnpm --filter @cosmos/render-planets test` green in the same CI run — listed explicitly
  in the workflow so a skipped/cached job cannot mask them.
- Full suite: unit (`pnpm verify`), e2e (smoke, flythrough, m1, m2, m3, m4a, jitter,
  ctxswitch, flythrough3/4, soak3, context-loss) across the matrix, bundle gate, Lighthouse.

## Inputs / Outputs

- **Inputs:** the complete M4a app (TASK-052).
- **Outputs:** green gates across chromium/webkit/firefox; flipped status table; updated
  root README; a recorded M4a demo for the milestone review (§16).

## Constraints & Forbidden Actions

- Do not modify any `packages/*` or `tools/*` source. **If a gate fails, the fix is a
  separate, explicitly-reviewed bug task** — set this task to `blocked` with a one-line
  note and stop (the TASK-006/017/030/041 doctrine).
- Do not relax the hard thresholds to pass: the **near-Sol budget drop** (ADR-006 §5.4),
  in-flight cap 6, points ≤ 2M, draws ≤ 300, memory-plateau slope bound, Lighthouse
  0.85/4000 ms are the spec. Any flaky-runner exception needs human sign-off in the PR,
  never a silent retry loop (the TASK-041 precedent).
- No new dependencies. Debug modes are flag-gated (zero cost when absent).

## Common Mistakes (architecture §5.8, §6, §12; ADR-005/006)

- Measuring the unification win at the wrong path segment — the drop is **near Sol**
  (where M3 overlapped three layers); far out, Gaia legitimately adds points. Compare the
  same inner segment against the committed M3 baseline.
- Asserting `performance.memory` on WebKit/Firefox (absent) — chromium-only heap clause.
- Treating one short run as memory-stable — the soak must run enough load↔evict cycles
  (the TASK-041 second-half-slope rule); the new mounts (atmosphere/nebula/labels) are the
  leak suspects.
- Running Lighthouse against the dev server (must be the built `dist`).
- Forgetting the atmosphere absent-at-low assertion (it is the §9 degradation contract).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `flythrough4` (or extended `flythrough3`) green under the tier-unification PASS rule:
   near-Sol `renderedPoints`/`drawCalls` ≤ M3 baseline, `procgenOpacity→0` at
   `catalogCoverage→1`, caps held — on chromium; cap clauses also green on webkit + firefox.
2. `m4a.spec.ts` green (atmosphere quality gate, overlays, tour + cinematic).
3. `soak3.spec.ts` green with M4a mounts (heap plateau + eviction churn; no mount leak).
4. Re-asserted lane + full-suite gates green as listed (workflow names them explicitly);
   Lighthouse 0.85/4000 ms with the new packs in `dist`.
5. Manual M4a checklist recorded in the PR (architecture §6 M4, terrain-deferred):
   - [ ] Gaia visibly densifies the sky; **no stars drawn twice** near Sol; budgets drop
         vs M3 (numbers in the PR).
   - [ ] Atmospheric Earth flyover reads believably; atmosphere gone on low tier.
   - [ ] Nebulae read as volumetric-look without tanking fill-rate.
   - [ ] Constellation lines + name labels toggle cleanly; labels de-clutter.
   - [ ] Guided tour runs end-to-end with cinematic letterbox; exits to free flight.
   - [ ] ≥ 55 fps on the reference desktop, zero frame > 50 ms, throughout (reference run).
   - [ ] Memory-stable over a 10-min soak.
   - [ ] Runs on desktop Safari + Firefox (manual matrix).
   - [ ] Demo recording captured for the milestone review (§16).
6. On completion: set TASK-042…TASK-053 final statuses in `docs/agent-tasks/README.md`;
   update root `README.md` status to "Phase 4a (M4a) complete — Phase 4b (terrain) spec in
   progress"; record the API freeze in the README GATE note (Phase 4b/terrain thaw is the
   next sanctioned change window).

## Deliverables

- `apps/web/src/scene/Flythrough4Probe.tsx` (or extend `Flythrough3Probe.tsx`) +
  flag-gated mounting in `App.tsx`; committed M3 baseline JSON for the segment comparison
- `e2e/tests/flythrough4.spec.ts` (or extended `flythrough3.spec.ts`); `m4a.spec.ts`
  re-assert + extensions; `soak3.spec.ts` updated to cover M4a mounts
- `.github/workflows/ci.yml` (explicit lane-job listing incl. pack-octree Gaia mode,
  pack-constellations, render-fx; matrix unchanged; Lighthouse unchanged in thresholds)
- `docs/agent-tasks/README.md` + root `README.md` status flips (on completion)

## Context Files

- `docs/decisions/ADR-006-gaia-subset-tier-unification.md` (§5.4 the budget gate),
  `docs/decisions/ADR-005-atmospheric-scattering.md` (§5 the quality gate),
  `docs/research/phase4-render-tier-handoff.md` (§3 the unification acceptance)
- `docs/architecture.md` §5.8 (perf + soak), §6 Phase 4 acceptance, §9 (budgets), §12 (CI
  matrix), §16 (milestone ritual)
- `docs/agent-tasks/TASK-041-phase3-gate.md` (gate doctrine + the CI-relaxation split +
  self-measuring probe pattern + the reference-machine manual checklist),
  `TASK-030-phase2-gate.md` (the ctxswitch pixel-delta + budget precedent)
- `docs/agent-tasks/TASK-052-m4a-integration.md` (the `__cosmos` hooks the probes read),
  `e2e/tests/flythrough3.spec.ts`, `e2e/tests/soak3.spec.ts`,
  `e2e/tests/helpers/frame-stats.ts`
