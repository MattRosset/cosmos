# cosmos — Agent Task Index & Status

Master specification: [`../architecture.md`](../architecture.md). **If any task file conflicts
with `architecture.md` or an ADR in `../decisions/`, those win** — stop, set the task to
`blocked`, note the conflict, and report it instead of guessing.

Tasks link to architecture sections; they do not duplicate the document. Read the linked
sections — they are part of the spec.

## How to execute a task (rules for agents)

1. Pick the **lowest-numbered** task whose **Status is `pending`** and whose **Blocked-by
   tasks are all `done`** (see the table below). Phase 0 is strictly sequential by design
   (architecture §6) — the Blocked-by column enforces this; do not work ahead.
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
| [TASK-005](TASK-005-nav.md) | `nav` v1: log-scaled free flight | TASK-004 | pending | |
| [TASK-006](TASK-006-phase0-gate.md) | Phase 0 gate: jitter test + 12-OOM flythrough | TASK-005 | pending | closes Phase 0 |

**GATE:** TASK-006 is the Phase 0 acceptance gate (architecture §6 Phase 0). No Phase 1
task may be specced or started until TASK-006 is `done` — the `coords` public API freezes
at that point, and only then is parallel agent work safe (architecture §8.3).

## Dependency graph

```
TASK-001 → TASK-002 → TASK-003 → TASK-004 → TASK-005 → TASK-006 (GATE: closes Phase 0)
  (done)   core-types    coords    scene-host     nav      jitter + flythrough
```

Phase 0 has no parallel lanes on purpose: every package here is on the critical path or
directly downstream of `coords`. Parallelization begins in Phase 1 (lanes per §8.3).

## Status values

- `pending` — not started, may be picked if unblocked
- `in-progress` — an agent is on it (set this when you start, in the same run)
- `done` — all acceptance tests pass in CI
- `blocked` — impossible as written; see Notes
