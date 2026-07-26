# Task: Give the overlay nebulae + constellation lines a context scale

**ID:** TASK-085
**Target package:** `packages/render-fx` + `apps/web` (`scene/Overlays.tsx`, `glue/test-hook.ts`) + `e2e`
**Size:** M
**Phase:** Maintenance track — scale-transition lane
**Depends on:** TASK-081 (**merged**, PR #28 — `pcScales` lives at `apps/web/src/glue/context-scale.ts`)
**Blocks TASK-080** (the `◂ Universe` affordance must not land on a white screen)

## Goal

At the `◂ Universe` vantage the viewport is **washed to near-white over 98% of its area**. Make
the two `render-fx` overlay layers — the nebula fields and the constellation line-set — subtend
their correct **physical** size in every scale context, exactly as TASK-081 did for the point
renderers. Galaxy context must stay **bit-identical**.

## What this task is NOT (read before anything else)

An earlier writeup, `docs/research/universe-vantage-nebula-blowout.md`, blamed the procgen
**dust lanes + HII** sprites. That was never ablated and is **false**. Measured: skipping every
dust/HII draw call at the blown-out vantage changes mean frame luminance by **0.01 out of
250.58** (0.004%), and the dust layer's lit-pixel bounding box (119 × 120 px) sits on top of
the known-correct procgen star cloud's (131 × 126 px). The dust lanes get their offset **and**
their centres/radii in parsecs, so their error is a *uniform* 1e6× scaling of the whole layer
about the eye — which a perspective projection is invariant to. They are angularly correct.

The blown-out layers are `Overlays.tsx`'s, whose error is **non-uniform**: a correct
context-unit offset paired with parsec geometry.

Full measurements: **`docs/research/universe-vantage-blowout-is-the-overlays.md`**.

Do **not** touch `packages/render-galaxy/src/dust-lanes.ts` or `GalaxyScene.tsx` in this task.

## Step 0 — facts to re-verify (measured 2026-07-26)

**If any is false, STOP and report.** These are stated as *observable outcomes*. A fact a `grep`
can confirm is not a fact about what renders — the previous task in this lane (TASK-082) was
falsified precisely because every one of its "facts" was literally true while describing the
opposite of the behaviour.

- **F1 — the overlay nebula layer alone produces the wash.** At the settled `◂ Universe`
  vantage (`contextId === 'universe'`, `|camera.local| = 0.18` Mpc, quality tier `high`),
  skipping only the draw calls whose vertex shader contains `aSeed` takes the canvas from
  **mean luma 250.58 / 98.1% of pixels above luma 200** to **mean luma 4.13 / 0.20%**.
  `RECHECK:` Deliverable 6's e2e spec run against the pre-change tree — it must FAIL, reporting
  `hotFrac ≥ 0.5`.
- **F2 — the constellation line-set is the same defect, hidden by a default.** Constellations
  default **off** (`packages/app-state/src/overlay-store.ts:17`). Toggled **on** at the same
  vantage, removing the nebula still leaves a full-viewport frame (4,052 lit px spanning
  0…881 × 60…354); removing the line-set too collapses the lit region to a single **60 × 58 px**
  box at the screen centre — a correctly-sized Milky Way.
  `RECHECK:` same spec, whose constellation leg asserts the same statistic.
- **F3 — the cause is a raw `toRenderSpace` result meeting parsec geometry.** `Overlays.tsx:116`
  (`lineSet.setRenderOffset(offScratch)`) and `:129` (`neb.setRenderOffset(offScratch)`) pass
  `origin.toRenderSpace`'s output with **no `unitsToPc` conversion**, while the geometry those
  renderers hold is parsecs: `glue/nebulae.ts:129` (`radiusUnits: spec.radiusPc * (…)`) and
  `glue/overlays.ts:43-44` (`segmentsF32[i] = segmentsPc[i]`). Measured on the GPU at the
  vantage: `uRenderOffset` for the three fields is `[-0.00011,-0.00038,-0.18012]`,
  `[0.00042,0.00016,-0.17991]`, `[-0.00026,0.00054,-0.18030]` — correct universe units — against
  `aRadius` values of **9.9 … 49.5** in the same units. The eye is *inside* the billboard.
  `RECHECK: grep -n "setRenderOffset(offScratch)" apps/web/src/scene/Overlays.tsx` ⇒ two hits,
  and neither is preceded by a `*= unitsToPc` block.
- **F4 — `Overlays.tsx` is the last raw-offset site in the app.** `StarScene.tsx:177-192` and
  `GalaxyScene.tsx:539,566-568` both convert with `pcScales` and pair it with
  `setContextScale`. `Overlays` already receives `origin` **and** `controllerRef` (currently
  discarded at `Overlays.tsx:41`, `void controllerRef;`), so the same two lines work verbatim.
  `RECHECK: grep -n "void controllerRef" apps/web/src/scene/Overlays.tsx` ⇒ 1 hit.
- **F5 — the shipped scale pattern applies the factor once, at the projection.** TASK-081's
  merged shaders declare `uniform float uPcToUnits;` and end with
  `gl_Position = projectionMatrix * vec4(viewPos * uPcToUnits, 1.0);`
  (`packages/render-galaxy/src/shaders/galaxy.vert.glsl.ts:35`,
  `packages/render-stars/src/shaders/stars.vert.glsl.ts:65`), with the setter writing one float
  (`galaxy-points.ts:108-110`). Copying it leaves every existing shader-text assertion intact
  (see F8).
- **F6 — `pcScales('galaxy')` returns literal `1`s**, by design, so a galaxy-context frame is
  bit-identical after this change (`apps/web/src/glue/context-scale.ts:30-34` and its test).
- **F7 — the nebula layer is quality-tier gated, and that can make a visual gate vacuous.**
  `Overlays.tsx:48`: `nebulaeAllowed = tier !== 'low'`. Observed live: with the tab throttled
  the `PerformanceMonitor` dropped to `low`, the nebula stopped drawing, and the universe
  vantage looked **correct** with the bug fully present. Flipping the tier back to `high` at the
  same vantage re-created the white screen with no other change — the independent confirmation
  of F1. The gate **must** pin the tier via `window.__cosmosDev.setTier('high')`
  (`StarApp.tsx:498`, typed in `apps/web/src/app/dev-surface.ts`).
- **F8 — `packages/render-fx/test/` asserts the shader text.** `nebula.test.ts` asserts
  `'position.xy * aRadius'`, `'aCenterUnits + uRenderOffset'` and `'mat3(viewMatrix)'`;
  `line-set.test.ts` has the equivalent. The F5 pattern changes only the `gl_Position` line, so
  **no existing assertion should need editing**. If you find yourself deleting one, you have
  deviated from D1 — stop and re-read it.
- **F9 — the e2e viewport is 1280×720 at `deviceScaleFactor: 1`** (`e2e/playwright.config.ts:24-26`),
  so `gl.drawingBufferWidth/Height` are 1280/720 and the pixel *fractions* below are
  resolution-independent.
- **F10 — reading the drawing buffer from the page works despite `preserveDrawingBuffer: false`.**
  The shipped pattern is a `requestAnimationFrame` registered **outside** three's loop, which
  therefore runs after three's render in the same turn:
  `apps/web/src/scene/ShaderJitterProbe.tsx:154-156, 224`. This was re-confirmed live in the
  production app this session.

## Frozen Interface

Unchanged: `CONTEXT_UNIT_METERS`, every context switch threshold, `pcScales`' contract,
`NebulaField` / `NebulaLayer` in `@cosmos/core-types` (**do not rename `centerUnits` /
`radiusUnits` / `segments`** — TASK-081 set the precedent that renaming a misleading unit name
is a separate, purely-mechanical task, and these are frozen `core-types` fields), and every
existing method on `Nebula` / `LineSet`.

Additive only:

```ts
export interface Nebula {
  // … existing members unchanged …
  /**
   * Parsecs → active-context render units, from `pcScales(ctx).pcToUnits`. Applied once at
   * the projection, so it scales the render offset AND the per-layer radius together.
   * Exactly `1` in galaxy context. Write it EVERY frame (same contract as
   * `GalaxyPoints.setContextScale`, TASK-081).
   */
  setContextScale(pcToUnits: number): void;
}

export interface LineSet {
  // … existing members unchanged …
  /** Parsecs → active-context render units. Same contract as `Nebula.setContextScale`. */
  setContextScale(pcToUnits: number): void;
}
```

The **documented unit** of `NebulaOptions.field`'s geometry, `LineSetOptions.segments`, and both
`setRenderOffset` methods changes from "context units" to **PARSECS** — comment-only, matching
what the callers already supply.

## Decisions taken here (do NOT re-litigate; they are the spec)

**D1 — apply the scale once, at `gl_Position`, using the name `uPcToUnits`.** Per F5 this is the
merged TASK-081 pattern. It covers offset *and* radius/segment with one multiply, it needs no
change to the billboard-expansion or offset lines, and it therefore leaves every shader-text
assertion in `packages/render-fx/test/` green (F8). Do **not** distribute the factor into the
`aCenterUnits + uRenderOffset` sum or into `position.xy * aRadius` — that is three multiplies
where one is correct, and it breaks F8's assertions for nothing.

**D2 — the offset becomes parsecs at the call site; the CPU never pre-multiplies the geometry.**
`Overlays.tsx` converts `offScratch` in place with `unitsToPc` (zero-alloc, exactly as
`StarScene.tsx:181-183` does) and hands `pcToUnits` to the renderer. Pre-scaling the instanced
attribute buffers on every context change is the alternative and is rejected: it would rewrite
`count × 8` floats per switch for a value the GPU multiplies for free.

**D3 — the context id comes from `controllerRef.current?.contextId ?? origin.context`.** Verbatim
from `StarScene.tsx:177-179`. `origin.context` alone lags the controller by one switch; the
`??` fallback is what the shipped site uses and is not a judgment call to re-open. Delete the
`void controllerRef;` line (F4).

**D4 — write `setContextScale` EVERY frame, next to `setRenderOffset`.** Both overlay renderers
are constructed in a `useMemo` that never re-runs, so a constructor-time value would be frozen
at whatever context the app booted in.

**D5 — the layers are SCALED, never HIDDEN.** A fix of the form
`neb.setVisible(ctx === 'galaxy')` would pass every pixel assertion in this task and is an
explicit violation. The diff must contain **no** new context- or distance-conditional around
the nebula or line-set visibility. This is checked by review, and it is called out because the
gate below genuinely cannot distinguish it — see "Known gate limitation".

**D6 — the pixel gate is an e2e spec in real Chromium WebGL, not a vitest offscreen render.**
This deviates from the sibling spec TASK-082, which asked for an offscreen `WebGLRenderTarget`
test in vitest, and the deviation is forced by measurement, not preference:
`packages/render-fx/vitest.config.ts` sets `environment: 'jsdom'` (no WebGL), and no headless-GL
package exists anywhere in the repo (`grep '"gl"' */package.json` ⇒ nothing). Adding a native
`gl` dependency to green a test is a far larger and riskier change than the fix. **Do not add
it.** The e2e lane is real WebGL, is already a blocking CI gate, and — per the gate below — the
new spec is required to be demonstrated FAILING first, which is the property that matters.
Uniform-value assertions as the proof are forbidden outright (TASK-082 §"what hid it").

**D7 — the frame statistic is a read hook on `window.__cosmos`, not test-side canvas math.**
CLAUDE.md testing rule 1. The hook needs no renderer handle: it reaches the live context with
`canvas.getContext('webgl2')` (the spec guarantees the same context object) and uses F10's
rAF-after-render readback. It lives in `apps/web/src/glue/test-hook.ts`, which is already
shipped-and-harmless in production.

**D8 — thresholds.** Measured pre-fix `hotFrac` (pixels with luma > 200, over the whole drawing
buffer) is **0.98** with constellations off and **0.58** with them on at a shorter canvas;
measured post-ablation is **0.001**. The gate asserts `hotFrac < 0.02` — a ≥ 29× margin below
the smallest observed failing value and a 20× margin above the expected passing one. The
positive control is `litFrac > 0.0002` (pixels above luma 8; measured 0.0066 with the overlays
ablated, 0 on a black frame), so deleting the galaxy does not pass.

## Deliverables

1. **`packages/render-fx/src/shaders/nebula.vert.glsl.ts`** — add `uniform float uPcToUnits;`
   and change only the final line:

   ```glsl
   gl_Position = projectionMatrix * vec4(viewPos * uPcToUnits, 1.0);
   ```

   Update the header comment: `aCenterUnits` / `aRadius` / `uRenderOffset` are **parsecs**, and
   `uPcToUnits` converts to active-context units at the projection.

2. **`packages/render-fx/src/shaders/lineset.vert.glsl.ts`** — same: add the uniform, change
   only `gl_Position` to `projectionMatrix * vec4(camPos * uPcToUnits, 1.0)`, fix the header
   comment.

3. **`packages/render-fx/src/nebula.ts`** — seed `uPcToUnits: { value: 1.0 }` in `uniforms`; add
   `setContextScale(pcToUnits)` writing that uniform in place (no allocation, same shape as
   `setExposure`); update the `setRenderOffset` doc comment to PARSECS.

4. **`packages/render-fx/src/line-set.ts`** — identical treatment.

5. **`apps/web/src/scene/Overlays.tsx`** — inside the existing `useFrameContext` callback:
   - import `pcScales` from `../glue/context-scale`;
   - remove `void controllerRef;` (D3) and compute
     `const { unitsToPc, pcToUnits } = pcScales(controllerRef.current?.contextId ?? origin.context);`
     **once per frame, before the loop**;
   - after each `origin.toRenderSpace(…, offScratch)` that feeds a renderer, multiply the three
     components by `unitsToPc` in place, then call `setContextScale(pcToUnits)` alongside
     `setRenderOffset(offScratch)` — for the line-set **and** for every nebula field;
   - **leave the label-projection block (`Overlays.tsx:134-…`) alone.** It calls
     `origin.toRenderSpace` into the same scratch and then projects with the three camera; that
     path is context-unit-correct as written and is out of scope. Reuse of `offScratch` means
     the label loop must keep reading an **unconverted** value — if you hoist the conversion, you
     will silently break labels. Convert inside each renderer branch, not once at the top.

6. **`apps/web/src/glue/test-hook.ts`** — add to `CosmosTestHook`:

   ```ts
   /**
    * One-shot framebuffer statistic for scale-regression gates (TASK-085). Reads the live
    * drawing buffer from a rAF registered OUTSIDE three's loop, so it runs after three's
    * render in the same turn and is valid despite `preserveDrawingBuffer: false` (pattern:
    * ShaderJitterProbe.tsx:154-156). Resolves `null` if no WebGL canvas is present.
    */
   readFrameStats(): Promise<{
     width: number;
     height: number;
     /** Mean Rec.709 luminance, 0–255. Clear colour alone is ≈ 3.3. */
     meanLuma: number;
     /** Fraction of pixels with luminance > 8. */
     litFrac: number;
     /** Fraction of pixels with luminance > 200. */
     hotFrac: number;
   } | null>;
   ```

   Implementation notes that are part of the spec: `document.querySelector('canvas')`, then
   `getContext('webgl2') ?? getContext('webgl')`; `gl.bindFramebuffer(gl.FRAMEBUFFER, null)`
   before `readPixels`; read on the **fourth** `requestAnimationFrame` callback (skip three) —
   one is sufficient for buffer validity per F10, the extra two are slack so a uniform written
   this turn is definitely on screen; return `null` (never throw, never fabricate zeros) when
   there is no canvas or no context. This is the exact shape that produced every number in
   Step 0, run against the production app.

   Note for the test author: `setTier('high')` installs an **override** that also disables the
   `PerformanceMonitor`'s `stepDown` (`packages/scene-host/src/quality.ts:34-44, 47`), so the
   tier cannot drift back down mid-spec once pinned.

7. **`e2e/tests/universe-overlay-scale.spec.ts`** — the gate. Deterministic only: no
   screenshots, no wall-clock assertions, no `@perf` tag. One test:

   1. `goto('/')`, `waitForSelector('canvas')`, wait `__cosmos.ready`.
   2. `page.evaluate(() => window.__cosmosDev?.setTier('high'))`, then wait for
      `__cosmos.qualityTier === 'high'`. **Assert it**, with the observed value in the message —
      per F7 a `low` tier makes the whole spec vacuous.
   3. Open the View drawer (`getByRole('button', { name: 'View settings' })`), click
      `getByRole('button', { name: 'Constellations' })`, wait for
      `__cosmos.overlays.constellations === true`, then **close the drawer** (press `Escape`)
      before touching the breadcrumb — an open drawer intercepts the breadcrumb click (observed
      live this session).
   4. Click `getByRole('button', { name: /Universe/i })` — wait for it to be **enabled** first
      (`universe-ascent.spec.ts:65-66` explains why).
   5. Wait for `__cosmos.contextId === 'universe'` **and** `goToActive === false` **and**
      `|cameraPosition.local| > 0.175` — the settled 0.18 Mpc vantage, not a mid-flight frame.
   6. `const s = await page.evaluate(() => window.__cosmos!.readFrameStats())`. Assert `s` is
      non-null.
   7. `console.log` the full stats object plus `contextId`, `qualityTier`, `procgenOpacity`,
      `errorCounts` **before** asserting (CLAUDE.md rule 6 — a CI-only failure must be
      triagable from logs alone).
   8. Assert `s.hotFrac < 0.02` (the defect) and `s.litFrac > 0.0002` (the positive control —
      the galaxy must still be drawn), each with the measured value in the assertion message.
   9. Assert `errorCounts.total === 0`.

   Use `universe-ascent.spec.ts` as the structural template (its `POLL_TIMEOUT_MS = 45_000`,
   its `snapshot()` helper, its comments about CI being SwiftShader-slow).

8. **`packages/render-fx/test/nebula.test.ts` + `line-set.test.ts`** — ADD (do not replace
   anything, per F8):
   - the shader contains `uniform float uPcToUnits;` and `* uPcToUnits, 1.0)`;
   - `uPcToUnits` seeds to exactly `1`;
   - `setContextScale(0.5)` writes `0.5` and mutates the uniform in place.
   These are **structural** checks that back up the pixel gate; they are explicitly NOT the
   proof of the fix (Deliverable 7 is). Do not add any assertion that a uniform equals a
   converted radius — that is the failure mode this lane exists to end.

9. **`docs/agent-tasks/README.md`** — flip TASK-085's Status to `done`.

10. **NOTES file** with every judgment call, per `CLAUDE.md`.

## Out of scope

*Findings during this task go to `docs/research/`; scope creep goes to a new task file, not into
this diff.*

- **The dust lanes / HII layer.** Measured angularly correct at the universe vantage (see "What
  this task is NOT"). Its 1e6× depth offset is a latent contract violation with **no measured
  visual consequence**; do not "also fix" it here — you would have no test that can fail.
  Note it; a follow-up may fold it into the impostor's task.
- **The galaxy impostor** — TASK-082.
- **`system`-context overlay behaviour — expect a VISIBLE change, and report it.** The same
  mismatch makes the overlays ~206,265× too *small* there (`pcScales('system').pcToUnits ≈
  206,265`), so today they are invisible inside a solar system. After this fix they are drawn at
  their true size, and `neb:orion` (radius 70 pc at ~415 pc from Sol, `glue/nebulae.ts:62-71`)
  subtends roughly 19° — a nebula may **appear** in the Saturn/Earth views where there was
  none. That is the physically-correct behaviour and matches what galaxy context already shows,
  so it is not a regression; but it is a user-visible change and it is why `m2-saturn` is
  listed as "may move" in the gate. **This half is arithmetic, not measurement** — the live
  attempt failed because the `flythrough3` probe's render loop is idle once it settles at Earth
  (zero draw calls captured, `readPixels` all black). Verify it yourself and report; do not add
  a gate for it, and do not "correct" it by suppressing the overlays in `system`.
- **`GalaxyScene.tsx:274-278`'s TASK-081 comment.** It says the lanes/hii follow-up is "filed
  alongside" TASK-082. That remains true — this task is not that follow-up. Leave the comment
  alone; editing `GalaxyScene.tsx` at all is out of scope here.
- Renaming `centerUnits` / `radiusUnits` / `segments` in `@cosmos/core-types` (frozen).
- The label-projection path in `Overlays.tsx` (Deliverable 5, last bullet).
- Anything in `GalaxyScene.tsx` or `render-galaxy`.

## Failure modes

- **Hiding the layer instead of scaling it (D5).** Passes the gate; is a spec violation.
- **Hoisting the `*= unitsToPc` conversion above the loop and breaking labels.** `offScratch` is
  a shared module-scoped scratch reused by the label projection, which needs the *unconverted*
  value. Deliverable 5's last bullet is the whole warning.
- **Setting the scale once at construction (D4).** The overlay renderers live in a `useMemo`
  with a `[]`-ish dependency list; a constructor value never updates and the bug survives every
  context switch after boot.
- **Computing the galaxy factor instead of taking `pcScales`' exact `1`.** A ratio-of-ratios can
  land on `0.9999999999999999` and silently move every galaxy-context baseline. Use the helper.
- **Editing a shader-text assertion to make a test pass (F8).** If D1 is followed, none need to
  change. Editing one is the red flag from the global rules, not a fix.
- **Reading the frame while the camera is still flying.** The wash is strongest at the settled
  0.18 Mpc vantage; mid-flight frames vary. Gate on `goToActive === false` *and* the distance.
- **Letting the tier fall to `low` (F7).** The nebula layer stops drawing and the spec passes
  against a fully-broken build. Pin and assert the tier.
- **Assuming the universe view is now "right".** This makes the overlays the correct size — at
  0.18 Mpc that means **invisible** (a 70 pc nebula is 0.06–0.22 px there). What *should* be
  visible up there is TASK-080's question, and the impostor's absence is TASK-082's.
- **Believing a per-layer measurement is a claim about the frame.** Third occurrence in this
  lane. Whatever you measure, subtract it from the whole frame and check.

## Acceptance gate

1. `pnpm verify` exits 0 (lint + typecheck + unit tests + build).
2. **Deliverable 7's spec must be demonstrated FAILING against the pre-change tree.** Stash the
   `render-fx` + `Overlays.tsx` changes (keep the test-hook and the spec), run
   `pnpm --filter @cosmos/e2e test:smoke tests/universe-overlay-scale.spec.ts`, and capture the
   output — it must fail on `hotFrac`, reporting a value **≥ 0.5**. Then unstash and re-run; it
   must pass. **Attach both runs to the PR.** Without this pair the test has proved nothing.
3. `pnpm test:e2e` exits 0. `flythrough3` / `flythrough4` / `m3` / `soak3` / `soak4` traverse
   other contexts and are the specs at risk; their deterministic assertions must hold unchanged.
4. **Screenshot baselines — reference-machine only, and therefore a LOCAL check, not a CI gate.**
   Every `toHaveScreenshot` in this repo is wrapped in `if (!process.env['CI'])`
   (`m1.spec.ts:161`, `m2.spec.ts:110-113`, `ctxswitch.spec.ts:85-88`), per
   `docs/testing-conventions.md`. Run the suite locally and classify each scene baseline —
   **there is no universe-context baseline in the repo**, so do not go looking for one:

   | baseline | app | context | expectation |
   | --- | --- | --- | --- |
   | `m1-initial`, `m1-betelgeuse` | `/` (StarApp, mounts Overlays) | galaxy | **must NOT move** — F6 makes the frame bit-identical. If one moves, **STOP and report**: the scale factor is being computed instead of taken from `pcScales`. |
   | `m2-saturn` | `/` (StarApp, mounts Overlays) | **system** | **may legitimately move** — see the system bullet in Out of scope. Report it with before/after; do not silently re-record. |
   | `flythrough-at-rest`, `ctxswitch-*`, `m3-*` | `?debug=markers` / `ctxswitch` / `m3` | — | unaffected: those app entry points do not mount `Overlays` (`grep -rl "<Overlays" apps/web/src` ⇒ 5 files, none of them). |
   | `star-card-identity`, `jump-letterbox-hud` | DOM-only locators | — | unaffected. |
5. `node tools/check-task-index/src/check.mjs` still reports **exactly one** inconsistency
   (the pre-existing TASK-064/TASK-063 pair) and exits 1. A second one means the README row is
   wrong.
6. NOTES file committed.
### Known gate limitation (state it in the PR, do not paper over it)

Gate 2 proves the wash is gone. It **cannot** distinguish the correct fix from D5's forbidden
"hide the layer outside galaxy context", because after the fix the overlays are legitimately
sub-pixel at that vantage. The guards are D5, Deliverable 8's structural assertions, and the
galaxy-context bit-identity in gate 3. If you want a stronger gate, the missing ingredient is a
**galaxy-context vantage where a nebula field is on screen and large**; `Soak4ProbeApp.tsx:61`
already forces constellations on and is the natural host. Filing that is a follow-up, not this
task.

## Verification beyond the gate (report, do not assert)

1. Load `/`, pin the tier to `high`, click `◂ Universe`, wait for the settled vantage, and
   capture the frame **before and after**. Before is a white screen; after must be a bounded
   spiral near the screen centre. Attach both.
2. Repeat with constellations toggled on. Before: constellation figures sprawl across the whole
   universe view. After: they must be gone from that vantage (they are Sol-local, hundreds of
   parsecs across, seen from 180 kpc).
3. Report `system`-context behaviour before/after (Out of scope bullet 3): fly to Saturn or
   Earth and say whether a nebula now appears, and how large. If nothing appears, say so —
   that would mean the fix is one-directional and something else suppresses the layer there.
4. Report the post-fix `readFrameStats()` numbers at the universe vantage so the next spec
   writer has a measured baseline rather than a threshold.

## Context Files

- `docs/research/universe-vantage-blowout-is-the-overlays.md` — every measurement behind Step 0
- `apps/web/src/scene/Overlays.tsx:41, 111-132` — the two raw-offset sites and the frame callback
- `apps/web/src/glue/context-scale.ts` — `pcScales` (TASK-081)
- `apps/web/src/scene/StarScene.tsx:173-193` — the shipped call-site pattern to copy verbatim
- `packages/render-galaxy/src/shaders/galaxy.vert.glsl.ts:35` + `galaxy-points.ts:108-110` — the
  shipped shader/setter pattern (D1)
- `apps/web/src/glue/nebulae.ts:129` + `apps/web/src/glue/overlays.ts:43-44` — where the parsec
  geometry is produced
- `apps/web/src/scene/ShaderJitterProbe.tsx:154-156, 224` — the readback pattern (D7, F10)
- `e2e/tests/universe-ascent.spec.ts` — structural template for the new spec
- `e2e/tests/m4a.spec.ts:173-190` — the constellation-toggle locator sequence
- `apps/web/src/app/dev-surface.ts` + `StarApp.tsx:498` — `__cosmosDev.setTier`
- `docs/research/universe-vantage-nebula-blowout.md` — the writeup this task corrects
- `docs/agent-tasks/TASK-081-point-renderer-context-units.md` — the merged precedent
