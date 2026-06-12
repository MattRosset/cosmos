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
   Phase 0 was strictly sequential; **Phase 1 runs parallel lanes** (architecture §8.3)
   — multiple tasks may be unblocked at once, and that is intentional. Each lane
   touches disjoint packages, so never start a task whose target package overlaps an
   `in-progress` task. TASK-015 (integration) and TASK-017 (gate) are single-lane:
   nothing else runs in `apps/web`/`e2e` while they are in progress.
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

**GATE:** TASK-017 is the Phase 1 acceptance gate (architecture §6 Phase 1 / M1). No
Phase 2 task may be specced or started until TASK-017 is `done` — at that point the
public APIs of `data`, `render-stars`, `app-state`, `ui`, and `nav` v2 freeze.

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
TASK-015 + 016 ─────────────────→ TASK-017 (GATE: closes Phase 1)
```

## Status values

- `pending` — not started, may be picked if unblocked
- `in-progress` — an agent is on it (set this when you start, in the same run)
- `done` — all acceptance tests pass in CI
- `blocked` — impossible as written; see Notes
