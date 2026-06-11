# Task: Monorepo scaffold, CI, and dependency-boundary enforcement

**ID:** TASK-001
**Target package:** repo root
**Size:** S
**Phase:** 0
**Depends on:** —
**Status: DONE** — this file is the audit record of what exists, so later tasks can rely on it.

## Goal

A pnpm + Turborepo monorepo where `pnpm verify` (lint → typecheck → test → build) passes
locally and in CI, with the architecture §4 dependency boundaries enforced by ESLint.

## What exists (audited 2026-06-10)

- **Workspace:** `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `tools/*`), root
  `package.json` with `verify` script, Node ≥ 22, pinned pnpm.
- **Turborepo:** `turbo.json` with `build`/`typecheck`/`test`/`dev` tasks, `^build` deps.
- **Lint boundaries** (`eslint.config.js`): strict TS, no `any`, deep imports banned
  (`@cosmos/*/src/*`), `Math.random()` banned in `core-types`/`procgen`, Three.js/React
  banned in pure packages, React banned in `render-*`, Three.js banned in `ui`.
- **CI:** `.github/workflows/ci.yml` — install → lint → typecheck → test → build on
  push/PR, concurrency-cancelled.
- **Packages:** `packages/core-types` (PRNG + coords types, see TASK-002 for what's
  missing), `apps/web` (Vite + R3F scaffold with log-depth Canvas + placeholder starfield).
- **Formatting:** Prettier (`.prettierrc.json`), `pnpm format`.

## Known gaps (deliberately deferred — do NOT fix here)

- Playwright / E2E / visual regression: Phase 1 (architecture §12, §13).
- Coverage tooling: added in TASK-003 (coverage gate on `coords`).
- Bundle-size + perf-smoke CI steps: Phase 1 deploy task.
- `import/no-restricted-paths` cross-package graph rules: revisit when `render-*`/`ui`
  packages exist; current per-package overrides in `eslint.config.js` cover Phase 0.

## Acceptance Tests

1. `pnpm verify` exits 0 at repo root. ✅
2. CI workflow green on main. ✅
