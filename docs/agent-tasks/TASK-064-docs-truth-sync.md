# Task: Docs truth sync — architecture.md vs. evolved practice, stale statuses, core-types README

**ID:** TASK-064
**Target package:** `docs/`, root `README.md`, `packages/core-types/README.md` — DOCS ONLY, zero code
**Size:** S
**Phase:** Maintenance track (post-4a)
**Depends on:** TASK-053, TASK-062, TASK-063

## Goal

`docs/architecture.md` is the master spec agents obey ("if any task file conflicts with
architecture.md, architecture.md wins" — `docs/agent-tasks/README.md`), so places where
it now describes abandoned tooling or missing enforcement actively mislead agents. This
task records the already-made (and gate-approved) doctrine decisions in the documents,
fixes stale status rows, and writes the one missing package README. Every edit below
documents EXISTING reality — nothing in this task decides anything new. Sources:
`docs/research/project-state-architecture-testing-review.md` §2.2/§3.3/§5 row 6, and the
TASK-041 closure note ("perf + visual moved to reference-only — approved doctrine
change").

## Frozen Interface

None. FORBIDDEN to touch any `.ts`/`.tsx`/`.js`/`.yml`/`.json` file.

## Deliverables

### 1. `docs/architecture.md` — five surgical edits

(a) **§4 folder tree:** add the packages/tools that exist but are missing from the
tree, each with a one-line description matching its real README: `packages/scene-host`
(already described in §5.1 — just add the tree entry), `packages/diagnostics`
("central error sink + dev overlay + assertInvariant — hardening track, TASK-055"),
`tools/pack-solar`, `tools/pack-constellations`, `tools/check-bundle-size`.

(b) **§4 enforcement sentence:** change
"(enforced by ESLint `import/no-restricted-paths` + Turborepo graph)" to
"(enforced by ESLint `no-restricted-imports` blocks per package group in
`eslint.config.js`; see TASK-060)". Do not restate the rules themselves — they are
correct as written.

(c) **§12 CI pipeline paragraph:** rewrite the pipeline sentence to match the real
`ci.yml`: `lint → typecheck → unit (Vitest, coverage-gated) → build → milestone unit
gates → cold-boot perf gate (boot-perf) → E2E deterministic gate (Playwright
chromium/webkit/firefox, --grep-invert @perf) → bundle-size check (fail if apps/web JS
> 1.2 MB gz)`. Replace the sentence "Visual baselines stored in repo via Git LFS;
update requires explicit `update-baselines` label" with "Visual baselines are committed
PNGs (canvas-only), compared on the reference machine only — never in CI
(testing-conventions §1.4); updates go through the `update-snapshots` workflow_dispatch
workflow." Replace "perf smoke (recorded flythrough on a pinned runner, assert p95
frame time)" with "perf regression gating is deterministic work-budget caps (points /
draw calls / in-flight) in the e2e gate; wall-clock perf is `@perf`-tagged and
reference-machine only."

(d) **§13 testing table:** in the "Unit (pure)" row, change "property-based where
math-heavy (fast-check)" to "property-style seeded-PRNG loops (`createPrng`) — see
`docs/testing-conventions.md`". In the "Visual regression" row, change
"Playwright screenshots + SSIM" to "Playwright `toHaveScreenshot` (canvas-only, 5%
tolerance), reference-machine only". In the "Performance" row, append: "wall-clock is
reference-machine/`@perf` only; CI gates work-budget proxies (testing-conventions
§1.4)". Add one sentence under the table: "The operative testing doctrine lives in
`docs/testing-conventions.md`; where this table and that document disagree, the
conventions document wins (doctrine change approved at the TASK-041 gate)."

(e) **§6 Phase 4 heading:** add one line under the Phase 4 table: "Phase 4 executes as
4a (all rows except terrain — gate TASK-053) + 4b (CDLOD terrain, ADR-007, specs not
yet authored). See `docs/agent-tasks/README.md`."

### 2. Root `README.md`

Update the Status paragraph (currently "Phase 3 (M3) complete — Phase 4 (Depth &
Beauty) spec in progress.") to reflect reality at merge time: Phase 4a complete
(gate TASK-053) — Phase 4b (chunked planet terrain, ADR-007) is the next planning pass.
Keep the paragraph's links intact.

### 3. `docs/agent-tasks/README.md` — status-table repairs ONLY

The Phase 3 lanes shipped (TASK-040/041 are `done`, which required them), but five rows
still read `pending`. Set Status to `done` and add the Note "status synced
retroactively (TASK-064); lane shipped within Phase 3 — see TASK-040/041 closure" for:
**TASK-034, TASK-035, TASK-036, TASK-037, TASK-039**. Before flipping each row, verify
the lane's package actually contains the deliverable (e.g. `packages/render-galaxy/src`
exists and is non-trivial for TASK-036); if any lane's deliverable is genuinely absent,
do NOT flip that row — set THIS task to `blocked` and report which one. Change nothing
else in the file.

### 4. `docs/research/phase4-render-tier-handoff.md`

Add a status banner directly under the title: "**Status (TASK-064):** the unification
described here was IMPLEMENTED in TASK-052 (combined HYG+Gaia octree, coverage-driven
procgen fade, gated monolith) and budget-gated in TASK-053 (flythrough4). This document
is retained as the design rationale; the task files are the record of what shipped."
Change nothing else.

### 5. CREATE `packages/core-types/README.md` (the only package missing one)

≤ 150 lines (architecture §8.5), structured like the other package READMEs (read
`packages/coords/README.md` and `packages/diagnostics/README.md` first as style
references). Content requirements:
- Purpose: zero-dependency shared types/schemas/events; the freeze/thaw discipline
  (may only change in explicitly sanctioned thaw tasks — cite TASK-007/018/031/042/054).
- Public API: list the modules re-exported by `src/index.ts` (read the file; there are
  ~21) grouped by domain (bodies, coords, orbits, octree, procgen, streaming, quality,
  worker-rpc, events, errors, prng, …) with one line each. Do NOT paste signatures —
  name the module and its one-sentence job.
- Invariants: imports nothing; no Three.js/React/DOM; `Math.random` lint-banned
  (determinism doctrine, architecture §5.6); units-in-names convention (§15).
- Testing: `pnpm --filter @cosmos/core-types test` (coverage-gated since TASK-062).

## Constraints & Forbidden Actions

- DOCS ONLY. If you find yourself editing anything but `.md` files, stop.
- Do NOT renumber, reorder, or rewrite architecture.md sections beyond the quoted
  edits — the doc is cross-referenced by section number from dozens of task files.
- Do NOT edit `docs/testing-conventions.md` (already correct).
- Do NOT mark TASK-056 or any other task row `done` — only the five listed Phase 3 rows,
  and only after the existence check.
- Do NOT invent history: every status/doctrine claim you write must trace to a task
  file, gate note, or the review doc — if you cannot find the source, leave the text
  unchanged and note it.

## Common Mistakes

- "Improving" architecture.md prose while in there — the diff must be reviewable as
  pure truth-sync; keep edits minimal and quotable.
- Writing the core-types README from memory instead of from `src/index.ts` — read the
  actual export list.
- Flipping the five status rows without the existence check.

## Acceptance Tests

The task is DONE only when:

1. `pnpm verify` exits 0 (proves no code was touched; lint also covers md-adjacent
   configs).
2. `git diff --stat` touches ONLY: `docs/architecture.md`, `README.md`,
   `docs/agent-tasks/README.md`, `docs/research/phase4-render-tier-handoff.md`,
   `packages/core-types/README.md`.
3. `(Get-Content packages/core-types/README.md).Count` ≤ 150.
4. Grep checks: `Select-String -Path docs/architecture.md -Pattern 'fast-check','SSIM','Git LFS','no-restricted-paths'`
   returns zero hits.
5. A reviewer can trace every changed sentence to its source (list the sources in the
   PR description, per edit).

## Context Files

- `docs/architecture.md` §4, §6, §12, §13
- `docs/testing-conventions.md` (the doctrine being pointed to)
- `docs/agent-tasks/README.md` (status table + TASK-041/052/053 notes)
- `docs/research/project-state-architecture-testing-review.md` (the audit motivating every edit)
- `packages/core-types/src/index.ts`, `packages/coords/README.md`,
  `packages/diagnostics/README.md`
