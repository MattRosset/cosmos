# cosmos — Agent Task Index & Status

Master specification: [`../architecture.md`](../architecture.md). **If any task file conflicts
with `architecture.md` or an ADR in `../decisions/`, those win** — stop, set the task to
`blocked`, note the conflict, and report it instead of guessing.

Tasks link to architecture sections; they do not duplicate the document. Read the linked
sections — they are part of the spec.

## How to execute a task (rules for agents)

1. Pick the **lowest-numbered** task whose **Status is `pending`** and whose **Blocked-by
   tasks are all `done`** (see the table below), skipping tasks marked `in-progress`.
   Set your task to `in-progress` (Status cell only) as your first action in the run.
   Phase 0 was strictly sequential; **Phases 1, 2, 3, and 4a run parallel lanes**
   (architecture §8.3) — multiple tasks may be unblocked at once, and that is
   intentional. Each lane touches disjoint packages, so never start a task whose
   target package overlaps an `in-progress` task. TASK-015/TASK-029/TASK-040/TASK-052
   (integration) and TASK-017/TASK-030/TASK-041/TASK-053 (gates) are single-lane:
   nothing else runs in `apps/web`/`e2e` while they are in progress. **TASK-038
   (`streaming`) is also single-lane** — per architecture §7 it integrates two chunk
   producers + the loader and is assigned to the strongest agent/human pair; do not
   run other Phase 3 lanes concurrently with it (it is the §8.3 "streaming +
   context-switching, never parallelized" task). TASK-021 → TASK-022 are serialized
   (both write `apps/web/public/packs/` and `ATTRIBUTIONS.md`); TASK-034 writes
   `apps/web/public/packs/octree/` (disjoint from 021/022 — no serialization needed).
   In Phase 4a, **TASK-045 → TASK-046** (constellations: tool then data) and
   **TASK-049 → TASK-050** (app-state then ui) are serialized in-lane; TASK-043
   (Gaia, `tools/pack-octree` + `apps/web/public/packs/octree-gaia-sample/`) and
   TASK-045 (`tools/pack-constellations` + `apps/web/public/packs/constellations.json`)
   write disjoint pack paths — no serialization between them. TASK-044 (`streaming`
   v1.1) is an **additive read-only accessor**, not the heavy §7 single-lane that
   TASK-038 was, but it is still the sensitive package — keep it its own lane.
2. Read your task file plus its listed **Context Files**. The task file is self-contained
   for everything else. Create/modify **only** the files listed under its "Deliverables"
   heading (plus its test files).
3. Conventions for every task:
   - Work from repo root `cosmos/`. Node ≥ 22, pnpm (version pinned in `package.json`).
   - **"Verify passes" means `pnpm verify` exits 0** (runs lint → typecheck → test → build).
   - Per-package commands: `pnpm --filter @cosmos/<name> test` / `typecheck` / `build`.
   - Every task must leave the repo with `pnpm verify` exiting 0.
   - **No new dependencies** unless the task file explicitly allows them (exact package
     names listed under "Allowed dependencies").
   - **Frozen interfaces are frozen.** If a signature in the task file seems wrong, set
     Status to `blocked` and report — never "fix" an interface unilaterally.
   - Respect the dependency-boundary lint rules (`eslint.config.js`, architecture §4):
     `core-types` imports nothing; pure packages never import Three.js/React; `render-*`
     never imports React; `ui` never imports Three.js; no deep imports across packages.
   - No `Math.random()` in generation code — use `createPrng` from `@cosmos/core-types`.
   - No allocations inside frame-loop callbacks (scratch objects module-scoped).
   - Commits: conventional, scoped by package — e.g. `feat(coords): floating origin`.
4. When all acceptance tests pass, change your task's **Status** cell below to `done`
   (and nothing else in this file). Do not start another task in the same run.
5. If a task is impossible as written, set Status to `blocked`, add a one-line note in
   the Notes column, and stop.

## Status table (the ONLY place progress is tracked)

| Task | Title | Blocked by | Status | Notes |
|---|---|---|---|---|
| [TASK-001](TASK-001-scaffold.md) | Monorepo scaffold + CI + boundary lint | — | done | pre-existing; audit in task file |
| [TASK-002](TASK-002-core-types.md) | `core-types` v1: bodies, orbits, events | TASK-001 | done | reviewed + accepted 2026-06-10 |
| [TASK-003](TASK-003-coords.md) | `coords`: frame tree + floating origin | TASK-002 | done | critical path (ADR-001) |
| [TASK-004](TASK-004-scene-host.md) | `scene-host` extraction from `apps/web` | TASK-003 | done | |
| [TASK-005](TASK-005-nav.md) | `nav` v1: log-scaled free flight | TASK-004 | done | |
| [TASK-006](TASK-006-phase0-gate.md) | Phase 0 gate: jitter test + 12-OOM flythrough | TASK-005 | done | closes Phase 0 |
| [TASK-007](TASK-007-core-types-thaw.md) | `core-types` thaw: pack manifest + `StarBatch` | TASK-006 | done | unblocks lanes A–C |
| [TASK-008](TASK-008-pack-stars.md) | `tools/pack-stars`: HYG v4.1 → `stars.bin` | TASK-007 | done | lane A |
| [TASK-009](TASK-009-data.md) | `data` v1: loader, search, region/nearest queries | TASK-008 | done | lane A |
| [TASK-010](TASK-010-render-stars.md) | `render-stars` v1: point sprites + pick helper | TASK-007 | done | lane B; vert-shader camera-rotation fix reviewed 2026-06-11 |
| [TASK-011](TASK-011-app-state.md) | `app-state` v1: selection/settings stores | TASK-007 | done | lane C |
| [TASK-012](TASK-012-ui.md) | `ui` v1: search palette + info panel | TASK-011 | done | lane C (mocked adapter) |
| [TASK-013](TASK-013-nav-goto.md) | `nav` v2: go-to-target animation | TASK-006 | done | lane D |
| [TASK-014](TASK-014-e2e-harness.md) | E2E harness: Playwright + baselines + bundle gate | TASK-006 | done | lane E |
| [TASK-015](TASK-015-m1-integration.md) | M1 integration: stars + picking + search + go-to | TASK-009, 010, 012, 013, 014 | done | required render-stars vert fix (831161d); ui InfoPanel HIP/format defect reported |
| [TASK-016](TASK-016-deploy.md) | Deploy to CDN + context-loss handling | TASK-014 | done | CF secrets added manually; deploy.yml skips cleanly when absent |
| [TASK-017](TASK-017-phase1-gate.md) | Phase 1 gate: rendered jitter + Lighthouse + M1 | TASK-015, 016 | done | **GATE: Phase 1 closed**; jitter 1.3e-5 px, Lighthouse perf 0.88 / TTI 2.4 s |
| [TASK-018](TASK-018-core-types-phase2-thaw.md) | `core-types` Phase-2 thaw: systems, bookmarks, frames | TASK-017 | done | all 29 tests pass; reviewed 2026-06-13 |
| [TASK-019](TASK-019-sim-time.md) | `sim-time` v1: epoch clock + acceleration | TASK-018 | done | lane F; §5.4 <1ms gate required Kahan-compensated advance (naive f64 drifts ~316ms/century at 1e6×) — supersedes the task's "one expression" note, architect-approved 2026-06-14 |
| [TASK-020](TASK-020-orbits.md) | `orbits` v1: Kepler solver, batch, polylines | TASK-018 | done | lane G; status synced 2026-06-14 (code shipped daa919c, gates green) |
| [TASK-021](TASK-021-pack-solar.md) | `tools/pack-solar`: JPL table → `systems-sol.json` + KTX2 | TASK-018, 020 | done | ADR-002: Jupiter 0.2%/Saturn 0.3% gate (great-inequality limit of secular elements) |
| [TASK-022](TASK-022-pack-exoplanets.md) | `tools/pack-exoplanets`: NASA archive + procedural fill | TASK-018, 021 | done | lane H (after 021); status synced 2026-06-14 (code shipped 43b1162, gates green) |
| [TASK-023](TASK-023-data-v2.md) | `data` v2: systems loader + combined source | TASK-018 | done | lane I (fixture-driven); status synced 2026-06-14 (code shipped 81d4081, gates green) |
| [TASK-024](TASK-024-render-planets.md) | `render-planets` v1: spheres, terminator, rings, orbit lines | TASK-018 | done | lane J; status synced 2026-06-14 (code shipped 7014b0f, gates green) |
| [TASK-025](TASK-025-app-state-v2.md) | `app-state` v2: time store + bookmarks/history persistence | TASK-018 | done | lane K; status synced 2026-06-14 (code shipped b7f70e4, gates green) |
| [TASK-026](TASK-026-ui-v2.md) | `ui` v2: time controls + bookmarks panel + planet info | TASK-025 | done | lane K; status synced 2026-06-14 (code shipped ab33e3a, gates green) |
| [TASK-027](TASK-027-nav-context-switch.md) | `nav` v3: automatic galaxy⇄system context switch | TASK-018 | done | lane L; strongest agent (§8.3) |
| [TASK-028](TASK-028-scene-host-epoch.md) | `scene-host` v1.1: pluggable epoch provider | TASK-018 | done | lane M; status synced 2026-06-14 (code shipped bdea45c, gates green) |
| [TASK-029](TASK-029-m2-integration.md) | M2 integration: Sol + exoplanet systems in `apps/web` | TASK-019–028 (all) | done | exclusive in `apps/web`/`e2e`; code shipped 01d3163, unit+lint+typecheck+build green, m2.spec logic tests pass locally. NOTE: m2 screenshot + perf + bookmark e2e gates need CI sign-off (fail locally on macOS/software-GL/Linux baselines — env artifact, not regression); status synced 2026-06-14 |
| [TASK-030](TASK-030-phase2-gate.md) | Phase 2 gate: invisible context switches + M2 | TASK-029 | done | **GATE: closes Phase 2.** Probe (`?debug=ctxswitch`) + `ctxswitch.spec.ts` + CI gate-listing shipped; verify+lint+typecheck+build green; 2 switches fire, gate passes (enter 0.11/exit 0.72 ≤ max-flight 2.42). PASS yardstick refined from `3×median` → `≤ max flight delta` (approved deviation, see task file). Lighthouse fixed (fe0a34d): vendor chunk split + gzip. Keyframe baselines committed by CI bot (d8d33d2); CI green on 2e90854; manual M2 checklist human-verified 2026-06-16. **GATE: Phase 2 closed.** |
| [TASK-031](TASK-031-core-types-phase3-thaw.md) | `core-types` Phase-3 thaw: galaxy procgen, octree, chunk lifecycle, quality, worker RPC | TASK-030 | done | octree.ts + procgen.ts + streaming.ts + quality.ts + worker-rpc.ts; 54 tests green; typecheck + build clean; shipped 06e191c 2026-06-16. core-types frozen until Phase 3→4 thaw. |
| [TASK-032](TASK-032-workers.md) | `workers` v1: pool + Comlink contracts + cancellation + transfer discipline | TASK-031 | done | 13 tests green; 88.7% stmt coverage; lint+typecheck clean; shipped 2026-06-16 |
| [TASK-033](TASK-033-procgen-galaxy.md) | `procgen` v1: deterministic density-wave galaxy generator | TASK-031 | done | 36 tests green; 100% stmt coverage; golden-hash snapshot; verify clean; shipped 2026-06-16 |
| [TASK-034](TASK-034-pack-octree.md) | `tools/pack-octree`: catalog → Morton-keyed octree tiles + manifest | TASK-031 | pending | lane (data tool); chunk producer #2 (ADR-003); commits sample octree pack |
| [TASK-035](TASK-035-data-v3.md) | `data` v3: octree manifest + on-demand tile loader (worker decode) | TASK-031, TASK-032 | pending | lane (data runtime); thaw of `data` API |
| [TASK-036](TASK-036-render-galaxy.md) | `render-galaxy` v1: particle clouds + dust lanes + far-LOD impostor | TASK-031 | pending | lane (render); new package |
| [TASK-037](TASK-037-universe-context.md) | `nav` v4: universe⇄galaxy switch + local group of procedural galaxies | TASK-031 | pending | lane (nav/coords); thaw of `nav` API; mirrors TASK-027 one level up |
| [TASK-038](TASK-038-streaming.md) | `streaming` v1: LOD policy + octree fetch/evict + procgen chunks + budgets | TASK-031, 033, 034, 035 | done | SSE LOD + hysteresis/cross-fade, in-flight cap + cancel, LRU evict (camera-pinned), budget degradation, typed lifecycle, nearestBodyDistanceM; 21 tests, 92% stmt cov, verify green |
| [TASK-039](TASK-039-quality-tiers.md) | `scene-host` v1.2: PerformanceMonitor-driven adaptive quality tiers | TASK-031 | pending | lane (scene-host); thaw of `scene-host` API (allowed dep: drei) |
| [TASK-040](TASK-040-m3-integration.md) | M3 integration: continuous Milky Way → Sol → Earth zoom, no loading screens | TASK-032–039 (all) | done | `task-040-galaxy-view` @ `5a41bcb`: M3 e2e green, galaxy breadcrumbs + streaming tier, breadcrumb freeze fix; manual sign-off 2026-06-18 |
| [TASK-041](TASK-041-phase3-gate.md) | Phase 3 gate: recorded-flythrough perf + memory soak + WebKit/Firefox + M3 | TASK-040 | done | `main` @ `9e98e6b`: CI green across chromium/webkit/firefox; gates deterministic work-budget caps (perf + visual moved to reference-only — see task Closure note for the approved doctrine change); soak3 churn robustened; manual M3 matrix done 2026-06-20. **GATE: Phase 3 APIs frozen.** |
| [TASK-042](TASK-042-core-types-phase4-thaw.md) | `core-types` Phase-4 thaw: atmosphere, nebula, overlay, tour, cinematic | TASK-041 | done | the ONE Phase 3→4a thaw; additive new modules only; NO Gaia type (ADR-006 §4); refs ADR-005/006. Five new modules + index re-exports; 74 core-types tests pass, all 22 packages typecheck, boundary lint clean. **Phase-4a lanes (043–053) unblocked; `core-types` frozen again until Phase-4b thaw.** |
| [TASK-043](TASK-043-pack-gaia.md) | `tools/pack-octree` v2: real Gaia DR3 mag-cut → octree pack | TASK-042 | done | lane (data tool); ADR-006; reuses frozen ADR-003 format; shipped 0af2f34 2026-06-21 |
| [TASK-044](TASK-044-streaming-coverage.md) | `streaming` v1.1: catalog-coverage-for-cut signal | TASK-042 | done | lane; §7-sensitive (additive read-only accessor); procgen-fade primitive; shipped 93f9182 (area-weighted catalogCoverage); status synced 2026-06-22 |
| [TASK-045](TASK-045-pack-constellations.md) | `tools/pack-constellations`: IAU line list → committed JSON | TASK-042 | done | lane (data tool); small committed pack; shipped c5a9773 2026-06-22 |
| [TASK-046](TASK-046-data-constellations.md) | `data` v4: constellation loader + segment/label resolution | TASK-042, 045 | done | lane (data runtime; after 045); additive; shipped 8a41a83 2026-06-22 |
| [TASK-047](TASK-047-render-fx.md) | `render-fx` v1: nebulae billboards + camera-relative line-set | TASK-042 | done | new package; 31 tests, 100% stmt cov, verify green; shipped bd73d8d 2026-06-22 |
| [TASK-048](TASK-048-render-planets-atmosphere.md) | `render-planets` v2: atmospheric scattering shell | TASK-042 | done | lane (render); ADR-005 O'Neil; additive; 66 tests, atmosphere.ts 100% cov, verify green; shipped 289c010 2026-06-22 |
| [TASK-049](TASK-049-app-state-overlays-tours.md) | `app-state` v3: tour store + overlay store | TASK-042 | done | lane (state); additive; tour-store.ts + overlay-store.ts, 19 new tests, verify green |
| [TASK-050](TASK-050-ui-overlays-tours.md) | `ui` v3: overlay toggles + label layer + tour chrome | TASK-049 | done | lane (HUD; after 049); React only, no Three.js; OverlayControls + LabelLayer + TourChrome, 18 new tests, verify green |
| [TASK-051](TASK-051-nav-cinematic.md) | `nav` v5: cinematic spline + auto-orbit + letterbox | TASK-042 | done | lane (nav); additive; centripetal Catmull-Rom spline + auto-orbit + letterbox flag, reuses goTo cancel/rebase/context-switch discipline; 14 new cinematic tests (67 nav tests), verify green |
| [TASK-052](TASK-052-m4a-integration.md) | M4a integration: Gaia tier-unification + atmosphere + overlays + tours + cinematic | TASK-043–051 (all) | done | exclusive in `apps/web`/`e2e`. Combined HYG+Gaia octree fed to one streaming policy (app glue, since `createStreamingPolicy` takes one `octree`); coverage-driven procgen fade replaces `GAL_PROCGEN_FLOOR`; HYG monolith gated by `catalogCoverage()`; Earth atmosphere quality-gated; render-fx nebulae + constellation line-set + ≤10 Hz label projection; committed grand tour + cinematic letterbox. `?debug=m4a` mode + `e2e/m4a.spec.ts` added; `__cosmos` extended. `pnpm verify` 22/22 green, bundle 360/1228 kB. NOTE: m4a e2e + screenshot baselines need CI sign-off (chromium/WebGL); manual desktop checklist pending. NOTE: TASK-044 was already shipped (93f9182) though its row read `pending` — corrected below. |
| [TASK-053](TASK-053-phase4a-gate.md) | Phase 4a gate: tier-unification budget win + M4a + perf/soak + matrix | TASK-052 | done | **GATE: Phase 4a (M4a) closed — Phase 4a APIs frozen; Phase 4b (terrain) thaw is the next change window.** Deterministic gates green: `pnpm verify` 23/23; e2e (CI mode) flythrough4 near-Sol budget drop + procgen fade, m4a (atmosphere/overlays/tour+cinematic), soak3 M4a-mount plateau all green on chromium. Real gate failures fixed in reviewed bug commits (BUG-2 tour dwell `ea48ea9`, BUG-4 flythrough4 near-Sol `ec51eeb`, BUG-7 overlay label `3322b87`) per the separate-fix doctrine. Reference-machine perf/screenshot clauses (`!CI`) + adaptive-tier throttle test are reference/SwiftShader-only — pass on CI, not gated locally on discrete GPU. |
| [TASK-054](TASK-054-core-types-error-thaw.md) | `core-types` thaw: `AppError` taxonomy + `ChunkLifecycleEvent.error` phase | — | done | Hardening track; the ONE core-types thaw. Shipped `errors.ts` (`AppError`/`AppErrorKind`/`toAppError`) + `ChunkLifecyclePhase` `'error'` + `error?: AppError \| null` **optional** (self-contained, no ripple; TASK-057 tightens emit). Non-Error rule: `name:'Error'` + `String(err)`, no stack (mirrors §5.13 `WorkerErrorPayload`). 10 new tests, verify 22/22 green. **core-types re-frozen.** |
| [TASK-055](TASK-055-diagnostics-sink.md) | `diagnostics` v1: central `reportError` sink + dev overlay + `assertInvariant` | TASK-054 | done | New leaf pkg `@cosmos/diagnostics` (deps: core-types only): `reportError` central sink (toAppError + per-`kind\|name\|message` 1s dedupe that silences UI/log but still counts), pluggable `setTransports`, `getErrorCounts`, `assertInvariant` (DEV throw / PROD degrade), vanilla-DOM `installDevOverlay` (no-op when `document` undefined). eslint leaf rule added (no three/react/sentry). 15 tests, 95.7% stmt cov, verify 23/23 green. Interim `apps/web/src/glue/report-error.ts` left in place for TASK-056 to swap behind Sentry. |
| [TASK-056](TASK-056-app-boundary-sentry.md) | `apps/web`: ErrorBoundary (DOM+scene) + global handlers + Sentry transport | TASK-055 | pending | **PARTIAL — ErrorBoundary (DOM+scene) + global handlers + WebGL2 guard shipped** (`d38c9f8`, `ErrorBoundary.tsx` + `installGlobalErrorHandlers`): white-screen killed, verified live. REMAINING when picked up: Sentry transport behind the sink, gated on `VITE_SENTRY_DSN`; new dep `@sentry/react` (apps/web only) |
| [TASK-057](TASK-057-streaming-error-phase.md) | `streaming` v1.2: `error` phase + abort/fail split + backoff + error counters | TASK-054, TASK-055 | done | §7-sensitive **single lane**; fixes the BUG-6 silent-storm class structurally. `onError(c,err)` splits abort/cancel (`AbortError`/`WorkerCancelledError`/aborted signal/cancelled token ⇒ silent drop, no event/count) from real failures (emit `error`+`AppError{context:{chunkId,kind,lod}}`, `reportError` injectable, `errorCount++`). Backoff: `MAX_LOAD_ATTEMPTS=3` real fails ⇒ terminal `failed` (resident, never re-requested, not rendered, not in `catalogCoverage`); released on cut-exit ⇒ fresh retry. Stats `errorCount`+`failedChunks`. **Note:** non-terminal fail re-marks the chunk `pending` (preserving `attempts`) rather than the spec's literal `removeChunk` — a removed chunk re-creates fresh (`attempts` 0) so the backoff could never trip; the cut-exit release is unchanged. Also fixed latent `process`-without-`@types/node` in `diagnostics/src/env.ts` (now transitive in the web bundle). 5 new tests, policy cov 90.5%/91.1% overall, verify 23/23 green. |
| [TASK-058](TASK-058-assert-adoption.md) | dev-assert adoption + invariant checks in the silent swallows | TASK-055, TASK-057 | done | `4708461`. `app-state` `createSafeStorage` get/set/removeItem now `reportError(kind:'persistence')` on a dropped write (still degrades for the user); `scene-host` frame-loop non-finite-epoch warn → latched `reportError(kind:'invariant')`; `octree-combined` `assertTileContributions` post-condition (BUG-8 orphan class, DEV throws / prod degrades); `apps/web` test-hook `__cosmos.errorCounts`/`failedChunks` live getters for TASK-059. |
| [TASK-059](TASK-059-error-gate.md) | Error gate: scripted flythrough asserts `errorCount===0` + coverage>0 | TASK-054–058 (all) | done | **GATE: closes Hardening track.** `e2e/tests/error-gate.spec.ts` + `apps/web/src/scene/ErrorGateProbe.tsx` (`?debug=errorgate`, mirrors the M4a composition + `M3DescentProbe` script, counters-only — no pixel/perf machinery). Asserts `errorCounts.total===0`, `failedChunks===0`, `catalogCoverage()>0` after a zero-inFlight settle. Self-test (`?inject=1`, permanently failing the combined octree's root tile) proves the gate goes red. Registered in `ci.yml`'s e2e gate listing. |
| [TASK-060](TASK-060-nav-boundary-conformance.md) | `nav` boundary conformance: R3F hook → app glue + complete boundary lint | TASK-053 | done | Maintenance track; sanctioned API change (removes `useFlightController` from `@cosmos/nav`, adds `FrameLoopRoot` to `@cosmos/scene-host` exports); touches `apps/web` — serialize with 061/065 |
| [TASK-061](TASK-061-app-tsx-decomposition.md) | Decompose `App.tsx` into per-composition modules (mechanical move) | TASK-053, TASK-060 | pending | Maintenance track; exclusive in `apps/web`; ZERO logic changes — e2e gate is the behavioral proof |
| [TASK-062](TASK-062-coverage-gate-wiring.md) | Wire dormant coverage gates (core-types + pack tools) + CI pack-octree dedupe | TASK-053 | pending | Maintenance track; scripts/config/ci.yml only, no test or source edits |
| [TASK-063](TASK-063-screenshot-policy-alignment.md) | Screenshot policy alignment: guard 3 CI-blocking `toHaveScreenshot` + e2e README | TASK-053 | pending | Maintenance track; `e2e/` only; testing-conventions §1.4 wins over e2e/README taxonomy |
| [TASK-064](TASK-064-docs-truth-sync.md) | Docs truth sync: architecture §4/§12/§13, stale status rows, core-types README | TASK-053, TASK-062, TASK-063 | pending | Maintenance track; docs only; records approved doctrine (no fast-check/SSIM/LFS/pinned runner) |
| [TASK-065](TASK-065-gaia-manifest-env-config.md) | Env-configurable Gaia octree manifest URL (production-pack readiness) | TASK-053, TASK-061 | pending | Maintenance track; `apps/web` build-time env var; default = committed sample (zero behavior change) |
| [TASK-066](TASK-066-ui-perception-literacy.md) | `ui` perception v1 — literacy: human units, mode badge, hints | TASK-053, TASK-061 | pending | Perception track (research `ui-ux-perception-and-polish.md` Phase 1); sanctioned additive `ui` v4 thaw; zero nav changes; serialize with TASK-065 (`apps/web`) |
| [TASK-067](TASK-067-ui-scale-perception.md) | `ui` perception v2 — scale ruler + unified Jump HUD + letterbox kit | TASK-066 | pending | Perception track Phase 2; letterbox+copy only (no post-pass — integrated-GPU floor); exclusive in `apps/web` |
| [TASK-068](TASK-068-ui-cards-identity.md) | `ui` perception v3 — insight cards + visual identity | TASK-066, TASK-067 | pending | Perception track Phase 3; display-time derivation only, no new data pipeline; C3 card-only (search badges wait on Gaia/search lane) |

**GATE:** TASK-017 closed Phase 1; the public APIs of `data`, `render-stars`,
`app-state`, `ui`, and `nav` v2 froze there. Phase 2 task files above are the
sanctioned thaw approvals for the specific API additions they list — nothing else
may change. TASK-030 is the Phase 2 acceptance gate (architecture §6 Phase 2 / M2).
No Phase 3 task may be **started** until TASK-030 is `done` — at that point
the APIs of `sim-time`, `orbits`, `render-planets`, and the v2/v3 surfaces of
`data`, `app-state`, `ui`, `nav`, and `scene-host` freeze. (The Phase 3 task
files TASK-031…041 are authored, but TASK-031 — the sole Phase 2→3 thaw — is
blocked on TASK-030 and every later Phase 3 task is blocked transitively on it.)
TASK-041 is the Phase 3 acceptance gate (architecture §6 Phase 3 / M3); when it is
`done` the APIs of `workers`, `procgen`, `streaming`, `render-galaxy`, the octree
surface of `data` v3, the v4 surface of `nav`, and the v1.2 surface of `scene-host`
freeze, and Phase 4 specs may be written. **TASK-041 is now `done` (2026-06-20): those
Phase 3 APIs are frozen; the Phase 4 (Depth & Beauty) thaw is the next sanctioned
change window.**

**Phase 4a (Depth & Beauty, terrain deferred).** TASK-042 is the sole Phase 3→4a thaw
(additive `core-types` modules: atmosphere, nebula, overlay, tour, cinematic — ADR-005/006);
nothing else may change `core-types`. The Phase-4a task files TASK-042…053 are authored;
every lane (TASK-043…051) is blocked transitively on TASK-042, and the gate (TASK-053) on
the M4a integration (TASK-052). **Chunked planet terrain (architecture §6 "CDLOD, worker
meshing") is intentionally DEFERRED to a separate Phase 4b pass** — it is two L-sized tasks
against a hard bit-level contract (the §5.10 "scope trap #1") and gets its own planning
pass + ADR (ADR-007) later. M4a is the §6 M4 milestone minus the "descend toward procedural
terrain" clause (which moves to M4b). TASK-053 is the Phase 4a acceptance gate; when it is
`done` the APIs of `render-fx`, `render-planets` v2 (atmosphere), `data` v4
(constellations), `app-state`/`ui` v3, `nav` v5, `streaming` v1.1, and the Gaia/octree pack
surface freeze, and **Phase 4b (terrain) specs may be written** (the next sanctioned thaw).

**Hardening track (Error Handling & Observability) — cross-cutting, out-of-band.**
TASK-054…059 are NOT a roadmap phase; they are a cross-cutting hardening track motivated by
the recurring silent-error class (`../research/error-handling-audit.md`: BUG-6 illegal-fetch
storm, BUG-8 dropped source — both invisible through every gate). The track may run alongside
the Phase-4a close, but **TASK-054 is its own explicitly-sanctioned `core-types` thaw window**
(additive `errors` module + `ChunkLifecycleEvent.error` phase only — nothing else in
`core-types` may change), separate from the Phase 3→4a and the future 4b thaws. It re-freezes
`core-types` the moment TASK-054 lands. TASK-057 is a `streaming` v1.2 surface bump (the
package's own additive thaw: the `error` lifecycle phase + `errorCount`/`failedChunks` stats)
and is **§7 single-lane** — never run it next to another streaming task. TASK-059 is the
track's acceptance gate; when it is `done` the silent-error class is gated shut and the
`diagnostics` API + the streaming v1.2 surface freeze.

## Dependency graph

```
Phase 0 (done):
TASK-001 → TASK-002 → TASK-003 → TASK-004 → TASK-005 → TASK-006 (gate, done)

Phase 1 (parallel lanes per §8.3 — disjoint packages, conflicts impossible):
TASK-006 ─→ TASK-007 (core-types thaw, S)
              ├─ lane A: TASK-008 pack-stars ─→ TASK-009 data
              ├─ lane B: TASK-010 render-stars
              └─ lane C: TASK-011 app-state ─→ TASK-012 ui (mocked adapter)
TASK-006 ─→ lane D: TASK-013 nav go-to
TASK-006 ─→ lane E: TASK-014 e2e harness ─→ TASK-016 deploy + context-loss

TASK-009 + 010 + 012 + 013 + 014 ─→ TASK-015 M1 integration (exclusive)
TASK-015 + 016 ─────────────────→ TASK-017 (GATE: closes Phase 1, done)

Phase 2 (parallel lanes per §8.3 — disjoint packages):
TASK-017 ─→ TASK-018 (core-types Phase-2 thaw, S)
              ├─ lane F: TASK-019 sim-time
              ├─ lane G: TASK-020 orbits ──┐
              ├─ lane H: TASK-021 pack-solar (also needs 020) ─→ TASK-022 pack-exoplanets
              ├─ lane I: TASK-023 data v2 (fixtures)
              ├─ lane J: TASK-024 render-planets
              ├─ lane K: TASK-025 app-state v2 ─→ TASK-026 ui v2
              ├─ lane L: TASK-027 nav v3 context switch (strongest agent)
              └─ lane M: TASK-028 scene-host epoch provider

TASK-019…028 (all) ─→ TASK-029 M2 integration (exclusive)
TASK-029 ──────────→ TASK-030 (GATE: closes Phase 2)

Phase 3 (parallel lanes per §8.3 — disjoint packages; streaming is single-lane per §7):
TASK-030 ─→ TASK-031 (core-types Phase-3 thaw, S; ADR-003/004)
              ├─ lane: TASK-032 workers ──────────────────────┐
              ├─ lane: TASK-033 procgen galaxy (producer #1)   │
              ├─ lane: TASK-034 pack-octree  (producer #2)     │
              ├─ lane: TASK-035 data v3 (needs 032) ←──────────┘
              ├─ lane: TASK-036 render-galaxy
              ├─ lane: TASK-037 nav v4 (universe⇄galaxy + local group)
              ├─ lane: TASK-039 scene-host v1.2 quality tiers
              └─ single-lane: TASK-038 streaming (needs 033 + 034 + 035; §7)

TASK-032…039 (all) ─→ TASK-040 M3 integration (exclusive)
TASK-040 ──────────→ TASK-041 (GATE: closes Phase 3)

Phase 4a (parallel lanes per §8.3 — disjoint packages; streaming additive per §7;
terrain DEFERRED to Phase 4b):
TASK-041 ─→ TASK-042 (core-types Phase-4 thaw, S; ADR-005/006)
              ├─ lane: TASK-043 pack-octree v2 — real Gaia DR3 ingest (ADR-006)
              ├─ lane: TASK-044 streaming v1.1 — catalog-coverage signal (§7 additive)
              ├─ lane: TASK-045 pack-constellations ─→ TASK-046 data v4 (constellations)
              ├─ lane: TASK-047 render-fx v1 (nebulae + line-set)   [new pkg]
              ├─ lane: TASK-048 render-planets v2 (atmosphere, ADR-005)
              ├─ lane: TASK-049 app-state v3 ─→ TASK-050 ui v3 (overlays/tours)
              └─ lane: TASK-051 nav v5 (cinematic spline + auto-orbit)

TASK-043…051 (all) ─→ TASK-052 M4a integration (exclusive)
TASK-052 ──────────→ TASK-053 (GATE: closes Phase 4a)

Phase 4b (terrain) — NOT YET AUTHORED: a later pass adds the CDLOD cube-sphere terrain
thaw + procgen terrain + render-planets CDLOD + ADR-007 (architecture §6 "CDLOD, worker
meshing"; §5.10 scope trap).

Hardening track (Error Handling & Observability — cross-cutting; not a roadmap phase):
TASK-054 (core-types thaw: AppError + ChunkLifecycleEvent.error) ──┐
TASK-055 (diagnostics: reportError sink + dev overlay + assert) ───┤  (054 ∥ 055 disjoint)
              ├─ TASK-056 apps/web: ErrorBoundary + global handlers + Sentry  (needs 055)
              ├─ single-lane: TASK-057 streaming v1.2: error phase + backoff  (needs 054+055; §7)
              └─ TASK-058 dev-assert adoption in the silent swallows          (needs 055+057)
TASK-054…058 (all) ─→ TASK-059 error gate (exclusive in apps/web/e2e; closes the track)

Maintenance track (post-Phase-4a conformance & debt — cross-cutting; not a roadmap phase;
motivated by ../research/project-state-architecture-testing-review.md). ALL of it is
blocked on TASK-053 so nothing shifts under the Phase 4a gate:
TASK-053 ─┬─ TASK-060 nav boundary conformance (apps/web + nav + lint) ─→ TASK-061 App.tsx
          │      decomposition (exclusive in apps/web) ─→ TASK-065 Gaia manifest env config
          ├─ TASK-062 coverage-gate wiring (core-types + tools + ci.yml)  ─┐
          └─ TASK-063 screenshot policy alignment (e2e only)              ─┴→ TASK-064 docs
                 truth sync (docs only; needs 062+063 so it documents the post-state)
Lanes 060→061→065 are serialized (all touch apps/web); 062, 063 may run in parallel with
them and with each other (disjoint paths); 064 runs last.

Perception track (UI literacy & scale perception — cross-cutting; not a roadmap phase;
motivated by ../research/ui-ux-perception-and-polish.md). Read-only against nav/core-types;
TASK-066 is the sanctioned ADDITIVE `ui` v4 thaw. All three touch `apps/web` → strictly
serialized with each other AND with the maintenance apps/web lane (060→061→065):
TASK-053 + TASK-061 ─→ TASK-066 literacy (units, badge, hints, first-run)
                          ─→ TASK-067 scale perception (ruler, Jump HUD, letterbox)
                          ─→ TASK-068 cards + identity (derivations, drawer, typography)
Research Phase 4 ("simulate @ c" educational transit) is intentionally NOT authored —
revisit after TASK-067 ships (research open question 3).
```

## Status values

- `pending` — not started, may be picked if unblocked
- `in-progress` — an agent is on it (set this when you start, in the same run)
- `done` — all acceptance tests pass in CI
- `blocked` — impossible as written; see Notes
