# Task: E2E harness — Playwright (chromium + WebKit), visual baselines, perf smoke, bundle gate

**ID:** TASK-014
**Target package:** `e2e/` (new, root) + `.github/workflows/ci.yml` + `tools/check-bundle-size`
**Size:** M
**Phase:** 1 — lane E (infra)
**Depends on:** TASK-006

## Goal

The test infrastructure architecture §12/§13 mandates from Phase 1: a Playwright suite
running against the **built** app (`vite preview`), on chromium AND WebKit (§14 —
WebKit in CI from Phase 1), with screenshot visual-regression support, a scripted
flythrough perf smoke, and a bundle-size gate (apps/web JS ≤ 1.2 MB gz, §12). It runs
against the Phase 0 debug scene now; TASK-015/017 add the M1 flows on top of this
harness without touching its plumbing.

## Frozen Interface

Not a TypeScript API — the frozen contract is the layout and config conventions:

```
e2e/
├── package.json            # @cosmos/e2e (private), scripts: test, test:ui, update-baselines
├── playwright.config.ts    # projects: chromium, webkit; webServer below
├── tests/
│   ├── smoke.spec.ts
│   ├── flythrough.spec.ts
│   └── __screenshots__/    # committed baselines (plain files; Git LFS deferred — note in README)
└── README.md
```

- `webServer`: `pnpm --filter @cosmos/web preview --port 4173` with
  `reuseExistingServer: !CI`; CI builds first.
- chromium launches with `--use-angle=swiftshader` (deterministic software GL on
  runners). **WebKit runs `smoke.spec.ts` only** — no WebGL screenshot assertions on
  Linux WebKit (flaky software GL); encode this as a Playwright project filter, with a
  comment citing this task.
- Screenshot policy: `toHaveScreenshot` with `maxDiffPixelRatio: 0.02`, animations
  disabled, fixed 1280×720 viewport, `deviceScaleFactor: 1`. Baseline updates only via
  `pnpm --filter @cosmos/e2e update-baselines` (and require the `update-baselines` PR
  label per §12 — document; enforcement can be manual review for now).
- Perf instrumentation convention (used again by TASK-017): the app exposes nothing;
  tests inject a rAF-based frame-time collector via `page.addInitScript` and read
  `window.__frameStats = { samples: number[], longTasks: number }` (PerformanceObserver
  for longtasks). Helper lives in `e2e/tests/helpers/frame-stats.ts`.

## Inputs / Outputs

- **Inputs:** the built Phase 0 app (`?debug=markers` scene included).
- **Outputs:** CI artifacts: Playwright HTML report on failure; committed baselines.

## Test content (initial)

1. `smoke.spec.ts` (chromium + webkit): app loads at `/`; a `<canvas>` exists; a
   WebGL2 context was created (evaluate `canvas.getContext` probe via injected flag);
   zero `console.error` and zero uncaught page errors during 5 s idle.
2. `flythrough.spec.ts` (chromium only): open `/?debug=markers`; hold `W` 4 s, drag-look,
   hold `Shift+W` 4 s (keyboard/mouse via Playwright APIs):
   - no page errors; debug HUD rebase counter strictly increases at least once;
   - frame stats: p95 frame time < 50 ms AND zero frames > 250 ms (CI-relaxed; the
     strict 60 fps assertion is a TASK-017 manual/reference-machine criterion);
   - one `toHaveScreenshot` keyframe at rest before input starts (stable baseline).

## CI & bundle gate

- `tools/check-bundle-size/`: a ~40-line Node script (no deps): gzip every
  `apps/web/dist/assets/*.js`, sum, fail if > 1.2 MB (budget from §12); prints the
  table. Wired as root script `pnpm check:bundle` and a CI step after build.
- `.github/workflows/ci.yml`: keep the existing `verify` job untouched; add an `e2e`
  job needing `verify`: pnpm install → `playwright install --with-deps chromium webkit`
  (cache browsers against the lockfile) → build web → run e2e → upload report artifact
  on failure → `pnpm check:bundle`.

## Constraints & Forbidden Actions

- Do not modify any `packages/*` or `apps/web` source (the harness adapts to the app,
  not vice versa). If the debug scene lacks something the tests need (e.g., a rebase
  counter selector), use what exists — `DebugHud` already renders rebase count; query
  by text/test-id that exists. If genuinely impossible, set `blocked`.
- Allowed dependencies: `@playwright/test` (in `e2e/package.json`). Nothing else.
- No screenshots of moving content (flythrough screenshots only at rest).
- Do not gate CI on WebKit perf or WebKit screenshots (smoke only, per above).
- Timeouts generous (CI runners are slow): 60 s per test, webServer 120 s.

## Common Mistakes (architecture §12, §13)

- Visual baselines recorded on a dev machine with different DPR/AA than CI — record
  baselines IN CI (first run uploads, commit from artifact) or pin all rendering
  variables (viewport, DSF, swiftshader) so local === CI. Pin them; document the
  recording procedure in `e2e/README.md`.
- MSAA/driver differences: swiftshader flag must be set for both recording and
  comparing.
- Letting the e2e job re-run unit tests (turbo cache makes `verify` cheap, but keep
  jobs separated for signal clarity).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `e2e` job green on chromium (all specs) and webkit (smoke) in the PR's CI run.
2. Intentional-failure check recorded in the PR description: changing the background
   color locally makes the screenshot assertion fail (proves the baseline has power) —
   revert before merge.
3. `pnpm check:bundle` passes and prints sizes; setting the limit to 1 KB locally
   fails (power check, note in PR).
4. `pnpm verify` exits 0 (harness adds no lint/type errors; e2e excluded from vitest).

## Deliverables

- `e2e/package.json`, `playwright.config.ts`, `tests/smoke.spec.ts`,
  `tests/flythrough.spec.ts`, `tests/helpers/frame-stats.ts`,
  `tests/__screenshots__/…` (baselines), `e2e/README.md`
- `tools/check-bundle-size/package.json`, `src/check.mjs`
- `.github/workflows/ci.yml` (e2e job + bundle step), root `package.json`
  (`check:bundle` script)

## Context Files

- `docs/architecture.md` §12 (CI pipeline), §13 (testing layers), §14 (WebKit risk)
- `.github/workflows/ci.yml` (current)
- `apps/web/src/scene/DebugHud.tsx`, `DebugMarkers.tsx` (what the flythrough drives)
- `docs/agent-tasks/TASK-006-phase0-gate.md` (the manual flythrough this automates)
