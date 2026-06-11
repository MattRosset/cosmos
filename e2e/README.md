# @cosmos/e2e

Playwright end-to-end test suite for the Cosmos app. Runs against the **built**
app (`vite preview`), on Chromium and WebKit. Chromium uses SwiftShader
(software GL) for deterministic, headless rendering on CI runners.

## Structure

```
e2e/
├── playwright.config.ts        # projects: chromium, webkit
├── tests/
│   ├── smoke.spec.ts           # chromium + webkit: load, WebGL2, no errors
│   ├── flythrough.spec.ts      # chromium only: perf smoke + rebase check
│   ├── helpers/
│   │   └── frame-stats.ts      # rAF frame-time + PerformanceObserver helper
│   └── __screenshots__/        # committed baselines (plain files; Git LFS deferred)
└── README.md
```

## Running locally

```bash
# Build the app first
pnpm --filter @cosmos/web build

# Run all tests (starts vite preview automatically)
pnpm --filter @cosmos/e2e test

# Interactive UI mode
pnpm --filter @cosmos/e2e test:ui
```

## Updating baselines

Screenshot baselines are committed to `tests/__screenshots__/`.

**Always record baselines on CI** (or with the exact same rendering flags as CI)
to avoid platform DPR / anti-aliasing divergence.

To update baselines locally with matching flags:

```bash
# Must match CI's SwiftShader flag; run inside chromium with software GL
pnpm --filter @cosmos/e2e update-baselines
```

Commit the updated PNG files and open a PR with the `update-baselines` label so
reviewers know this is an intentional visual change.

## CI behaviour

- Chromium: all specs
- WebKit: `smoke.spec.ts` only (WebGL screenshot assertions are flaky under
  Linux WebKit's software GL — see TASK-014)
- Playwright HTML report is uploaded as a CI artifact on failure
- Bundle-size gate runs after E2E (`pnpm check:bundle`, JS ≤ 1.2 MB gz)
