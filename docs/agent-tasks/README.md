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
   Phase 0 was strictly sequential; **Phases 1, 2, and 3 run parallel lanes**
   (architecture §8.3) — multiple tasks may be unblocked at once, and that is
   intentional. Each lane touches disjoint packages, so never start a task whose
   target package overlaps an `in-progress` task. TASK-015/TASK-029/TASK-040
   (integration) and TASK-017/TASK-030/TASK-041 (gates) are single-lane: nothing
   else runs in `apps/web`/`e2e` while they are in progress. **TASK-038
   (`streaming`) is also single-lane** — per architecture §7 it integrates two chunk
   producers + the loader and is assigned to the strongest agent/human pair; do not
   run other Phase 3 lanes concurrently with it (it is the §8.3 "streaming +
   context-switching, never parallelized" task). TASK-021 → TASK-022 are serialized
   (both write `apps/web/public/packs/` and `ATTRIBUTIONS.md`); TASK-034 writes
   `apps/web/public/packs/octree/` (disjoint from 021/022 — no serialization needed).
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
| [TASK-031](TASK-031-core-types-phase3-thaw.md) | `core-types` Phase-3 thaw: galaxy procgen, octree, chunk lifecycle, quality, worker RPC | TASK-030 | pending | the ONE Phase 2→3 thaw; unblocks all Phase 3 lanes. May not start until TASK-030 `done`. ADR-003/ADR-004 |
| [TASK-032](TASK-032-workers.md) | `workers` v1: pool + Comlink contracts + cancellation + transfer discipline | TASK-031 | pending | new package; prerequisite for procgen/octree-in-worker (allowed dep: `comlink`) |
| [TASK-033](TASK-033-procgen-galaxy.md) | `procgen` v1: deterministic density-wave galaxy generator | TASK-031 | pending | lane; pure; chunk producer #1 (ADR-004) |
| [TASK-034](TASK-034-pack-octree.md) | `tools/pack-octree`: catalog → Morton-keyed octree tiles + manifest | TASK-031 | pending | lane (data tool); chunk producer #2 (ADR-003); commits sample octree pack |
| [TASK-035](TASK-035-data-v3.md) | `data` v3: octree manifest + on-demand tile loader (worker decode) | TASK-031, TASK-032 | pending | lane (data runtime); thaw of `data` API |
| [TASK-036](TASK-036-render-galaxy.md) | `render-galaxy` v1: particle clouds + dust lanes + far-LOD impostor | TASK-031 | pending | lane (render); new package |
| [TASK-037](TASK-037-universe-context.md) | `nav` v4: universe⇄galaxy switch + local group of procedural galaxies | TASK-031 | pending | lane (nav/coords); thaw of `nav` API; mirrors TASK-027 one level up |
| [TASK-038](TASK-038-streaming.md) | `streaming` v1: LOD policy + octree fetch/evict + procgen chunks + budgets | TASK-031, 033, 034, 035 | pending | **single-lane, strongest agent (§7/§8.3)**; needs both chunk producers + loader |
| [TASK-039](TASK-039-quality-tiers.md) | `scene-host` v1.2: PerformanceMonitor-driven adaptive quality tiers | TASK-031 | pending | lane (scene-host); thaw of `scene-host` API (allowed dep: drei) |
| [TASK-040](TASK-040-m3-integration.md) | M3 integration: continuous Milky Way → Sol → Earth zoom, no loading screens | TASK-032–039 (all) | pending | exclusive in `apps/web`/`e2e`; composition only |
| [TASK-041](TASK-041-phase3-gate.md) | Phase 3 gate: recorded-flythrough perf + memory soak + WebKit/Firefox + M3 | TASK-040 | pending | **GATE: closes Phase 3.** Freezes Phase 3 APIs on completion |

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
freeze, and Phase 4 specs may be written.

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
```

## Status values

- `pending` — not started, may be picked if unblocked
- `in-progress` — an agent is on it (set this when you start, in the same run)
- `done` — all acceptance tests pass in CI
- `blocked` — impossible as written; see Notes
