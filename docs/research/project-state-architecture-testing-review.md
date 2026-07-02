# Project state review — architecture & testing vs. the initial plan

**Date:** 2026-07-02
**Type:** Architecture review (research, no code changes)
**Baseline:** `docs/architecture.md` (§4 dependency rules, §8 agent decomposition, §12 CI, §13 testing)

## 1. Verdict

The project has followed the plan unusually well. All 15 planned packages exist (plus
`scene-host` as a real package and a small, justified `diagnostics` addition), no package
src exceeds the 3k-LOC cap, pure packages (`coords`, `orbits`, `sim-time`, `procgen`)
import only `core-types` in practice, there are zero cross-package deep imports, and the
codebase is nearly free of TODO/FIXME markers. Phases 0–3 gates are closed; Phase 4a is
feature-complete but its gate (TASK-053) is not closed.

The debt that exists is concentrated in three places: **the `apps/web` integration
monolith**, **doc/lint drift on boundary enforcement**, and **an inconsistent
screenshot-in-CI policy**. Everything else is polish or deliberate, documented deviation.

## 2. Architecture findings

### 2.1 Conformant (no action)

- Package inventory matches §4; all barrels (`src/index.ts`) present; deep-import ban
  (`@cosmos/*/src/*`) enforced and clean (0 violations).
- `ui` never imports Three; `render-*` never import React; `workers` never import Three.
- Worker discipline holds: app worker entry is 17 lines of glue; handlers stay pure.
- Extra tools (`pack-solar`, `pack-constellations`, `check-bundle-size`) are natural
  outgrowths of §5.7/§12, not scope creep.

### 2.2 Deviations, ordered by cost of ignoring them

1. **`apps/web` is an 8.3k-LOC integration monolith; `App.tsx` is 1,867 lines.**
   The plan's whole premise (§8.5: "no package over ~3k LOC … that README plus
   `core-types` is sufficient context") is defeated exactly where integration bugs
   concentrate — and the TASK-052 sweep showed that is where they concentrate
   (BUG-4/8/9/10, transit-black were all glue/scene bugs). `apps/web/src/scene/` alone is
   3,830 LOC while the `scene-host` package holds only 366. **Recommendation:** don't
   invent new packages; split `App.tsx` mechanically into mount-composition modules
   (data wiring, streaming wiring, scene mounts, HUD wiring) so no file exceeds ~500
   lines. This is file hygiene, not architecture — resist the urge to redesign.
2. **`nav` imports `@cosmos/scene-host` + R3F** (`useFlightController.tsx` uses
   `useFrameContext`), violating "only `apps/web` and `scene-host` glue may import across
   groups." `nav` is also the largest package (1,607 LOC, `controller.ts` = 1,059) and
   hosts local-group procgen (`local-group.ts`). **Recommendation:** move the R3F hook
   into app glue (it is glue), keep the controller pure. Moving `local-group.ts` to
   `procgen` is a nice-to-have; do it opportunistically, not as a project.
3. **Lint enforcement is weaker than the doc claims.** §4 promises
   `import/no-restricted-paths` + Turborepo graph enforcement; reality is a partial set
   of `no-restricted-imports` blocks that omit `orbits`, `sim-time`, `coords` from the
   pure-package ban, and nothing enforces the cross-group rule (which is how the `nav`
   violation crept in). **Recommendation:** extend the existing `no-restricted-imports`
   blocks to cover all pure packages and ban `@cosmos/scene-host`/`react` from `nav` —
   ~20 lines of eslint config. Do **not** add a second enforcement mechanism
   (dependency-cruiser, Turborepo boundaries); one tool, complete rules.
4. **Minor hygiene:** `core-types` has no README (the one package the plan most needs
   documented); `sim-time` declares `@cosmos/core-types` but never imports it; `nav`
   declares `three` but never imports it; no lint rule bans allocation in `useFrame`
   paths (§15 said "where possible" — a `no-restricted-syntax` rule scoped to frame
   callbacks is cheap if churn ever shows up in profiles; otherwise skip).

### 2.3 Explicitly not recommended (overengineering)

- Splitting `nav` or `streaming` into multiple packages preemptively — both are under the
  3k cap; `policy.ts` (769 lines) is the §5.8 orchestrator and is expected to be dense.
- Turborepo graph / dependency-cruiser on top of eslint.
- WebGPU work, headless-GL shader-compile tests, or any Phase 5 item before 4b.

## 3. Testing findings

### 3.1 State

~93 unit test files / ~1,020 cases across all 17 packages + 6 tools; 18 e2e specs
(~30 blocking chromium tests) gated deterministically via `--grep-invert @perf`;
coverage thresholds (85–90%) enforced in CI for most packages including the
plan-critical `coords`/`orbits` ≥90%. The `__cosmos` hook + work-budget-proxy strategy
(testing-conventions.md) is the strongest asset in the repo and *exceeds* the original
§13 plan in rigor. Only one skipped test repo-wide.

### 3.2 Gaps worth fixing (all cheap)

1. **`core-types` runs without `--coverage`** and pack tools have thresholds configured
   but scripts omit the flag — the gates exist and simply aren't wired. One-line script
   changes per package.
2. **Screenshot policy is self-contradictory.** `testing-conventions.md` rule 4 says
   screenshots are reference-machine only, but `ctxswitch`, `m3`, and `flythrough`
   still run `toHaveScreenshot` as blocking CI, and `e2e/README.md` documents that as
   intended. Pick one policy (recommendation: conventions doc wins — guard the remaining
   three specs with `!process.env.CI`, keep the local reference gate) and update
   whichever doc lost.
3. **CI runs `pack-octree test` twice** in the same job (`ci.yml` — lines ~87 and ~98).
4. **No integration test wires store ↔ event bus ↔ scene-host together** (§13 row).
   The pieces are each tested; one Vitest that mounts the bridge against a fake frame
   loop would close it. Low priority — the e2e suite covers this path in practice.

### 3.3 Plan items to formally drop (not implement)

These were in §12/§13 but the evolved conventions deliberately superseded them; update
`docs/architecture.md` rather than building them:

- **fast-check** — the seeded-PRNG property loops (2,000-case Kepler convergence,
  1,000-case coord round-trips) serve the same purpose with zero dependencies.
- **SSIM + Git LFS baselines** — Playwright pixel-diff at 5% on canvas-only shots is
  adequate; LFS adds workflow friction for a handful of PNGs.
- **Pinned perf runner + p95 CI gate** — replaced by work-budget caps (rule 4 of the
  conventions), which was the right call. Wall-clock stays `@perf`/reference-only.

## 4. Where the project actually is (vs. roadmap)

- Phases 0–3 closed; hardening track (error taxonomy, diagnostics sink, error gate)
  done except **Sentry transport (TASK-056)**.
- **Phase 4a ~95%:** all lanes done; BUG-2 **functional fix** landed (2026-07-02, uncommitted).
  Tour advances and stays galaxy-scale; **BUG-2d** UX polish (jumps, letterbox flicker)
  deferred to future tour redesign — see `TASK-052-integration-bugs.md` §BUG-2d. TASK-053
  gate + manual checklist remain.
- **Gaia at scale — three distinct states (do not conflate):**
  - **CI / committed default:** `octree-gaia-sample` (135 stars) — what automated gates run
    against; correct and intentional.
  - **Local validation:** the team has exercised the app against **full Gaia packs** built
    locally via `tools/pack-octree` (multi-million-star catalogs, not the 135-star stub).
    Streaming fixes (BUG-8, BUG-10 P0) and visibility work were measured on those dense
    packs — see `bug-10-streaming-density-wall.md`, `gaia-visibility-and-realness-problem.md`.
  - **Production gap (still open):** the ~4.7M catalog is **not yet deployed** to CDN/R2 for
    end users. Committed builds and CI still default to the sample; TASK-065 wires the
    build-time env override so production can point at the hosted full pack without a code
    change. BUG-10 P1/P2 and integrated-GPU validation at production CDN scale remain the
    follow-up once that deploy lands.
- **Phase 4b (CDLOD terrain)** has no specs; `phase4-render-tier-handoff.md` is stale
  (marked open, actually implemented in TASK-052).

## 5. Prioritized recommendations

| # | Action | Effort | Why now |
|---|--------|--------|---------|
| 1 | Close TASK-053 gate (manual checklist + doc flip) | S | BUG-2 functional fix done; BUG-2d tour UX deferred |
| 2 | Deploy production Gaia pack to CDN; point builds at it via TASK-065 env var | M | Local dev has validated dense packs; production users still get the 135-star default until CDN deploy + env wiring |
| 3 | Complete eslint boundary rules (pure packages, `nav` cross-group ban); fix `nav`→`scene-host` by moving the R3F hook to glue | S | Closes doc/lint drift before Phase 4b agents inherit it |
| 4 | Split `App.tsx` (and largest `scene/` files) into <500-line composition modules | M | Highest-risk file for agent edits; pure mechanics, no redesign |
| 5 | Wire `--coverage` for `core-types` + pack tools; dedupe pack-octree CI step | S | Gates already configured, just unplugged |
| 6 | Resolve screenshot-in-CI contradiction (conventions doc wins); sync `architecture.md` §12/§13 with the evolved strategy (drop fast-check/SSIM/LFS/pinned-runner) and refresh stale statuses (README phase line, TASK-034–039 rows, handoff doc) | S | Docs are the agent interface; drift here compounds |
| 7 | Sentry transport (TASK-056), `core-types` README, phantom-dep cleanup | S | Hygiene batch, no urgency ordering among them |

Items deliberately **not** on the list: package splits beyond #4, second boundary-enforcement
tool, fast-check migration, SSIM, WebGPU, headless-GL tests, frame-allocation lint (until a
profile justifies it).
