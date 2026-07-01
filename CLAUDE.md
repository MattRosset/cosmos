# CLAUDE.md

Guidance for working in this repo. Keep this file short — depth lives in `docs/`.

## Testing — read before writing or reviewing any test

Full guide: **`docs/testing-conventions.md`**. The non-negotiable rules, inline so they're
always in context:

1. **Query real state, never re-derive it.** Don't reimplement production math (camera
   projection, picking, orbits, layout) in a test. Expose a thin read hook on
   `window.__cosmos` (`apps/web/src/glue/test-hook.ts`) and *ask* the app. Duplicated logic
   drifts and leaks environment details into the test.
2. **No hard-coded pixel/font/HUD geometry.** OS font builds differ (Linux CI vs. Windows
   dev), so pixel assumptions that pass locally fail in CI. Use real hit-testing:
   `document.elementFromPoint`, `__cosmos.projectToScreen`, `__cosmos.pickAt`.
3. **Prefer role locators** (`getByRole`) over coordinate clicks; raw pixel clicks only for
   genuinely spatial behavior (canvas pick, drag), and then via rule 2.
4. **CI gates deterministic proxies only.** Correctness + work-budget caps block; screenshots
   and wall-clock perf are reference-machine only (`!process.env.CI`, perf tagged `@perf`).
5. **Assert invariants, not incidental build/machine-specific values.**
6. **A CI-only failure must be triagable from logs alone** — log the chosen input + measured
   quantity.

## Local vs. CI gate

- `pnpm verify` = lint + typecheck + unit test + build (excludes e2e by design).
- `pnpm test:e2e` = build web + deterministic e2e gate on chromium; run before pushing
  changes to app behavior or e2e specs.

## Docs map

- `docs/decisions/` — ADRs (architecture decisions).
- `docs/research/` — investigations + root-cause writeups.
- `docs/testing-conventions.md` — how we write tests.
