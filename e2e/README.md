# @cosmos/e2e

Playwright end-to-end test suite for the Cosmos app. Runs against the **built**
app (`vite preview`) on Chromium, WebKit, and Firefox. Chromium uses SwiftShader
(software GL) for deterministic, headless rendering on CI runners.

## Gate taxonomy (read this before adding assertions)

Tests fall into three categories. **What blocks CI is deliberately limited to the
deterministic ones** — see [docs/architecture.md](../docs/architecture.md) and the
`ci/deterministic-gates` history for the rationale.

| Category | What it asserts | Blocks CI? |
|---|---|---|
| **Deterministic — correctness** | context-switch sequences, `finalContext`/`contextId`, selection/UI text, error counts, jitter sub-pixel stability, heap plateau (regression slope), pixel-delta invisibility | **yes** |
| **Deterministic — work budget** | `streamingPeak.{inFlight ≤ 6, renderedPoints ≤ 2M, drawCalls ≤ 300}`, `requestsIssued`, churn throughput | **yes** |
| **Visual** | `toHaveScreenshot` — **canvas only**, not full page (the HUD's `backdrop-filter` blur never settles under SwiftShader) | **no** — reference-machine only (`!process.env.CI`); see testing-conventions §1.4 |
| **Wall-clock perf** | `p95`/`p50`/`maxFrameMs` ms, `longTasks`, span ms, blank-by-time | **no** — see below |

**Why wall-clock perf does not gate CI:** CI runs on SwiftShader on a CPU-capped
shared runner, where a frame-time number measures the runner, not the code — a
*different renderer measuring a different thing*, not a noisy version of the GPU
number. The same SwiftShader cross-build AA drift makes pixel screenshots weak as
a gate too, so those assertions are either guarded behind `if (!process.env.CI)`
(reference-machine only) or live in `@perf`-tagged tests that CI excludes. The
numbers are still **logged every run** (`console.log`) for trend. The strict
timing target is the manual reference-GPU checklist. A real perf regression still
fails the deterministic gate, because it shows up as more *work submitted*
(points / draw calls / in-flight) — which is what the budget caps assert.

When you add a test:
- Pure wall-clock / capture-diagnostic? Tag it `{ tag: '@perf' }`.
- Mixed (deterministic caps + a timing check in one expensive run)? Keep the caps
  unconditional and guard the timing with `if (!process.env.CI)` + a `console.log`.
- Screenshot? Shoot `page.locator('canvas')`, never `page`, and guard it with
  `if (!process.env.CI)` — visual baselines never block CI.

## Running locally

```bash
pnpm --filter @cosmos/web build          # build first (tests run vite preview)

pnpm --filter @cosmos/e2e test           # full suite (everything)
pnpm --filter @cosmos/e2e test:gate      # CI's blocking gate (deterministic only)
pnpm --filter @cosmos/e2e test:perf      # the @perf wall-clock suite (reference machine)
pnpm --filter @cosmos/e2e test:ui        # interactive UI mode
```

## Updating baselines

Screenshot baselines are committed to `tests/__screenshots__/` (canvas-only PNGs).

**Record baselines with CI's rendering flags** — the chromium project forces
`--use-angle=swiftshader`; the 5% `maxDiffPixelRatio` absorbs the win32↔linux
SwiftShader cross-build AA delta. For maximum fidelity, take the baseline from a
CI run's artifact (CI is linux); a locally-recorded one is usually within tol.

```bash
pnpm --filter @cosmos/e2e update-baselines
```

Commit the updated PNGs and flag the PR as an intentional visual change.

Baselines are exercised by local / reference-machine runs only; CI does not
compare them (TASK-063).

## CI behaviour

- **Blocking gate:** `playwright test --grep-invert @perf` (chromium full; webkit
  + firefox run `smoke` + `flythrough3` only). Wrapped in `xvfb-run` so headless
  Firefox can negotiate a GL context.
- **Cold-boot perf gate:** `boot-perf` on chromium (a 1000 ms catastrophic-hang
  check; `longTasks` is logged, not gated).
- `@perf` specs are **not** run in CI — run them on the reference machine via
  `test:perf`.
- Playwright HTML report uploaded as an artifact on failure.
