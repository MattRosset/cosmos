# E2E/CI flakiness: root cause + the query-hook fix

_2026-06-30. Why "passes local, fails CI" kept recurring, what's actually a product
bug vs. test–environment coupling, and the structural fix._

## 1. The complaint

Development slowed to a crawl in a fix→CI-fail→fix loop. Running tests locally gave
no signal: specs pass on the dev machine, fail in CI. The question: are we fixing real
bugs, or fighting badly-architected tests?

## 2. Taxonomy of the last ~16 `e2e/`-touching commits

**Environment-divergence (NOT product bugs) — the bulk:**

- `d2690ae` HUD pick px under the breadcrumb — Linux fonts render WIDER than Windows.
- `c86f339`, `2d2b680` scene screenshots → reference-only (CI render is load-dependent).
- `9e98e6b`/`7780d10`/`597d575` workers=2 starves the WebGL specs on a 2-vCPU runner.
- `73ff00e` synthetic `webglcontextlost` for SwiftShader.
- `fea0e69`, `71c8c34` relax cross-platform pixel diff.
- `0aaa1f4`, `2e90854`, `d0b548a` perf assertions → informational on CI.
- `f5dda9a`, `04fd587` canvas/screenshot timing.

**Real product bugs CI legitimately caught (the minority — e2e earned its keep):**

- `3322b87` BUG-7 m4a overlay labels.
- `ec51eeb` BUG-4 P1 flythrough4 near-Sol.
- `1626985` procgen-LOD cap (un-LOD'd 1M cloud).
- `b205215` BUG-8 push-down combine.

Ratio: ~3 environment-fighting commits per real bug caught. The doctrine the repo
already adopted (gate on deterministic budgets; move screenshots + wall-clock perf to
reference-only — see `20e4765`, `5e30ec9`, `3e6f82a`) is correct. The residue is the
specs that still touch **pixels, fonts, or a re-derived camera**.

## 3. Why "passes local, fails CI" is structural, not luck

Two independent reasons, both fixable:

1. **`pnpm verify` never runs e2e.** `pnpm test` = `turbo run test --filter=!@cosmos/e2e`.
   The entire Playwright surface runs for the first time *in CI*. There is no "passed
   locally" for e2e — there is "not run, then failed in CI."
2. **The remaining local↔CI gap is fonts, which local can't reproduce.** Chromium runs
   under `--use-angle=swiftshader` *both* locally and in CI (set in
   `playwright.config.ts`, not env-gated), so the GPU substrate matches. What differs is
   the OS font build (Linux Skia vs. Windows) and CPU contention. The font-width class
   (`d2690ae`) therefore **cannot** be caught by running e2e on a Windows dev box — it
   can only be removed by making the test font-independent.

## 4. The architectural smell: `m1.spec.ts`'s parallel camera model

`m1.spec.ts` is the only spec that drives a **raw pixel click** (`page.mouse.click`)
against a click target it computes from a **re-derived model of the production camera**:

- `cameraAfterGoTo` reimplements the controller's yaw/pitch arrival math.
- `projectToPx` reimplements the camera projection.
- `findEmptySkyPx` reimplements star-cone picking **and** hard-codes HUD pixel boxes.

This duplication charges two recurring taxes:

- **Maintenance:** any production camera change forces a hand-edit of the model. Commit
  `f8ad2e1` is exactly this — the test caught nothing; it was just resynced to the new
  roll-free orientation.
- **Environment coupling:** the hard-coded HUD boxes encode text geometry, so Linux font
  width breaks the click (`d2690ae`).

Every other spec (m2, m3, ctxswitch) clicks via **role-based locators** (real buttons)
and is robust. `flythrough`'s `page.mouse` use is a drag *gesture* (orbit), not a pick —
legitimately screen-relative. So the blast radius is one file.

## 5. The fix: ask the app, don't re-derive it

The production pick path already exists: `pickAt(clientX, clientY)` in
`apps/web/src/scene/StarScene.tsx` (raycaster + `pickStar`, using the live camera and the
flight controller's absolute position/orientation). The test should call **that**, plus
its inverse for projection, instead of modelling them.

### 5.1 New test hooks (`window.__cosmos`)

Two methods, backed by a `PickProbe` registered from StarScene's picking effect (where
`gl.domElement`, `camera`, and `controllerRef` are already in scope):

- `pickAt(clientX, clientY): BodyId | null` — the **exact** production pick closure, with
  no selection side-effect. "What would clicking here select?"
- `projectToScreen(localPc): {x, y} | null` — the inverse: a position in the camera's
  current context frame → CSS px via the live camera (fov/aspect) + controller
  orientation/position + `getBoundingClientRect`. `null` if behind the camera or off-screen.

Both are environment-independent: CSS px from `getBoundingClientRect`, real camera, real
quaternion. DPR and font geometry are irrelevant.

### 5.2 m1 collapses to real queries

- **Positive pick:** `px = projectToScreen(star.posPc)`; assert `pickAt(px)` resolves to
  the target (the real pick agrees); click; assert `selectedId`.
- **Empty-sky deselect:** scan a px grid; choose the first px where
  `document.elementFromPoint(x,y) === canvas` **and** `pickAt(x,y) === null`. This uses the
  **real DOM hit-test** for HUD occlusion (no font boxes) and the **real pick** for
  emptiness (no `nearestTwoAngles` model). Click; assert deselect.

~150 lines of parallel model (`cameraAfterGoTo`, `projectToPx`, `nearestTwoAngles`,
`findEmptySkyPx`, `pickIsolatedTarget`) delete. No future camera or font change can break it.

## 6. Closing the local signal gap (defence in depth)

Add root scripts so e2e has a local pre-push signal (it caught nothing before because it
never ran locally):

- `pnpm test:e2e` → the deterministic gate (`@cosmos/e2e test:gate`).
- This catches camera-model drift and logic regressions locally. It does **not** catch the
  font class — §5 is what removes that — but it ends the blind fix→push→fail loop for
  everything else.

## 7. Verdict

Mostly test–environment coupling, not phantom bugs — but concentrated in one file and one
missing script, both fixable. The unit tier is healthy; a few e2e gates caught real bugs.
After §5 + §6, the CI-only failure mode that triggered this investigation is removed at the
root, consistent with the repo's "gate on deterministic proxies, don't add coping tooling"
doctrine.
