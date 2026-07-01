# Testing conventions

_How we write tests in cosmos. Short by design — the rules are in §1, the "why" and the
worked example follow. If you're writing or reviewing a test, read §1 first._

## 1. The rules (non-negotiable)

1. **Query real state, never re-derive it.** A test must not reimplement production math
   (camera projection, orbital mechanics, picking, layout). If it needs to know something
   the app computes, expose a thin read hook and *ask* the app. Two copies of the same
   logic drift apart, and every environment detail leaks into the copy.

2. **No hard-coded pixel or font geometry.** Never assume where text/HUD lands in pixels —
   font builds differ across OSes (Linux CI vs. Windows dev), so a pixel that's clear
   locally sits under chrome in CI. Use real hit-testing: `document.elementFromPoint(x,y)`
   for occlusion, `__cosmos.projectToScreen(pos)` for where something renders,
   `__cosmos.pickAt(x,y)` for what a click selects.

3. **Prefer role/semantic locators over coordinates.** Click buttons with
   `getByRole('button', { name: … })`, not `mouse.click(x,y)`. Raw pixel clicks are only
   for the thing under test being *spatial* (a canvas pick, a drag gesture) — and then via
   rule 2.

4. **CI gates deterministic proxies only.** Correctness assertions and work-budget caps
   (in-flight requests, draw calls, points, error counts, state sequences) are the blocking
   gate. **Screenshots and wall-clock perf are reference-machine only** (`!process.env.CI`)
   — CI's SwiftShader on a contended runner measures the runner, not the code. Tag
   wall-clock perf specs `@perf`; the blocking gate runs `--grep-invert @perf`.

5. **Assert invariants, not incidental values.** Gate on what must be true (epoch didn't
   drift; zero silent errors; the target got selected), not on a number that happens to
   fall out of this build on this machine.

6. **A test failure must be triagable without a rerun.** Log the chosen input and the
   measured quantity (`console.log('[m1 empty-sky] px=… clearance=…')`) so a CI-only miss
   can be diagnosed from the log, not reproduced.

## 2. Local vs. CI signal

- `pnpm verify` (lint + typecheck + unit test + build) is the fast local gate. It
  **excludes** e2e by design (`--filter=!@cosmos/e2e`).
- `pnpm test:e2e` builds web and runs the deterministic e2e gate on chromium — run it
  before pushing anything that touches app behavior or the e2e specs.
- The residual local↔CI gap is **OS fonts and CPU contention**, not the GPU (chromium runs
  `--use-angle=swiftshader` in both). Fonts can't be reproduced on a Windows box — which is
  exactly why rules 1–2 exist: make the test independent of the thing you can't reproduce.

## 3. The read hook (`window.__cosmos`)

The single seam tests use to query live app state (`apps/web/src/glue/test-hook.ts`).
Mirrors are written from store subscriptions / lifecycle events / a ≤ 4 Hz timer —
**never from a frame callback**. Live getters (error counts, pick/projection) read the true
value at access time. When a new spec needs app state, add a field/method here rather than
scraping the DOM or modelling the app. Current surface includes `ready`, `goToActive`,
`selectedId`, `contextId`, `streaming.*`, `errorCounts`, `pickAt`, `projectToScreen`.

## 4. Worked example — what NOT to do, and the fix

`m1.spec.ts` used to reconstruct the whole production camera as a **parallel model**
(`cameraAfterGoTo` reimplemented the yaw/pitch arrival math, `projectToPx` the projection,
`findEmptySkyPx` the star-cone pick *and* hard-coded HUD pixel boxes). It charged two taxes:

- **Maintenance:** every camera change forced a hand-edit of the model (commit `f8ad2e1`
  caught no bug — it was pure resync).
- **Environment coupling:** the HUD pixel boxes broke on Linux font width (commit `d2690ae`),
  the textbook "passes local, fails CI."

The fix (commit `3ed013a`): exposed `__cosmos.pickAt` / `projectToScreen` — the *same* live
camera + flight controller a real click uses — and rewrote the spec to project via the real
camera, confirm the real pick agrees, and find empty sky by scanning
`pickAt===null && elementFromPoint===canvas`. ~150 lines of model deleted; no camera change
or font build can break it again. Full analysis:
`docs/research/e2e-ci-flakiness-rootcause-and-query-hook.md`.

## 5. Checklist before you commit a test

- [ ] Does it re-derive any production math? → move it behind a `__cosmos` query.
- [ ] Any hard-coded pixel/font/HUD geometry? → use `elementFromPoint` / `projectToScreen`.
- [ ] Coordinate clicks where a role locator would do? → switch to `getByRole`.
- [ ] Screenshot or wall-clock perf assertion running in CI? → guard `!process.env.CI` (perf
      also tagged `@perf`).
- [ ] Would a CI-only failure be triagable from the logs alone?
- [ ] Ran `pnpm test:e2e` locally if it touches app behavior?
