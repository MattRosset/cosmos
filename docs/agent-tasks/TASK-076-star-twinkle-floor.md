# TASK-076 — Star twinkle fix: flux-conserving point-size floor

**ID:** TASK-076
**Target package:** `packages/render-stars` (+ one README table row)
**Size:** S
**Phase:** polish
**Depends on:** none (research: `docs/research/star-shimmer-on-motion.md`, claims C1–C6)

## Goal

Catalog stars (galaxy octree + HYG + exoplanet hosts) stop flickering during camera
motion. Today most of them render at a 1 px point-size floor, where a star's on-screen
flux legitimately swings 0→100% as its center crosses pixel boundaries (research C1+C2;
confirmed live: still camera = per-star flux CV 0%, slow pan = median CV 65.6% / p90
115%, C6). After this task the floor is 3 px and the brightness of floor-clamped stars
is dimmed by the area ratio, so per-star flux under motion varies ≤ ~3% (the C2 table's
3 px row) and total flux is continuous across the clamp boundary — faint stars look the
same overall brightness as before, just stable.

## Step 0 — facts to re-verify before writing code

True as read on 2026-07-14; re-confirm against the live tree:

1. `packages/render-stars/src/shaders/stars.vert.glsl.ts:34-38` — point size is
   `clamp(uBasePointPx * pow(10.0, -0.2 * m), uMinPointPx, uMaxPointPx) * uPixelScale`,
   with no brightness compensation anywhere.
2. `packages/render-stars/src/shaders/stars.frag.glsl.ts:14` — brightness is
   `clamp(pow(10.0, -0.4 * vApparentMag), 0.0, 1.0) * uExposure`; alpha is the
   `smoothstep(0.5, 0.1, …)` falloff at line 13. No size-dependent term.
3. `packages/render-stars/src/star-points.ts:34` — `minPointPx = 1` default; all three
   catalog call sites use the defaults: `apps/web/src/scene/GalaxyScene.tsx:168`,
   `apps/web/src/scene/StarScene.tsx:108`, `StarScene.tsx:118` (`createStarPoints({ batch })`).
4. `packages/render-stars/src/pick.ts` — picking does NOT read or re-derive point size
   (grep `pointPx|PointSize` → nothing), so changing the floor cannot move pick behavior.
5. `packages/render-galaxy/src/galaxy-points.ts:39` — the procgen cloud already uses its
   own defaults and `GalaxyScene.tsx:210` passes `minPointPx: 2`; render-galaxy is out of
   scope here (C5: its shimmer regime is mild).
6. `packages/render-stars/test/star-points.test.ts` — the existing test file: geometry
   layout assertions + shader-source string assertions (`VERT` contains `uMinPointPx`,
   line ~88). New tests follow this file's shape.
7. `tools/research/point-flux-variation.mjs` prints the flux-vs-size table (1 px CV
   110.7%, 3 px CV 3.0%); `tools/research/twinkle-live-probe.js` is the in-browser
   confirmation probe. Both exist and run.

## Context files

- `docs/research/star-shimmer-on-motion.md` — the why; C2's table is the design tool.
- `packages/render-stars/src/shaders/stars.vert.glsl.ts` — where the size law and the
  new dimming factor live (vertex computes both sizes, emits one varying).
- `packages/render-stars/src/shaders/stars.frag.glsl.ts` — where brightness multiplies
  the new varying.
- `packages/render-stars/src/star-points.ts` — the `minPointPx` default; options doc
  comment cites "(§5.9)" — update the comment, not the section.
- `packages/render-stars/README.md` — options table row `minPointPx | 1 | …` must match
  the new default.
- `packages/render-stars/test/star-points.test.ts` — house test style for this package.
- `docs/research/star-approach-jitter.md` + commit `6bd7d24` — why the vertex shader's
  hi/lo offset sum is sacred (see Failure modes).

## Frozen — do not touch

- `FLOOR_PX = 3` — the new `minPointPx` default. Chosen from the measured table
  (C2: 3 px → flux CV 3.0%, max/min ×1.14; 2 px would leave CV 6% / ×1.37). Moves only
  via a follow-up task with its own visual calibration, never inside this diff.
- The `StarPointsOptions` / `StarPoints` public signatures (`star-points.ts`) — the fix
  is a default-value change plus shader-internal work; no new options, no new methods.
- The magnitude→size law (`uBasePointPx = 8`, `uMaxPointPx = 64`, the
  `pow(10.0, -0.2 * m)` shape) and the magnitude→brightness law
  (`pow(10.0, -0.4 * vApparentMag)`).
- The hi/lo render-offset math in the vertex shader (lines 31 and the
  `uRenderOffsetHi/Lo` uniforms) — the close-approach jitter fix lives there.
- The fragment alpha falloff `smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5))` — the
  C2 simulation (and the CV ≤ 3% claim this task banks on) is computed against exactly
  this falloff; changing it invalidates the numbers.
- `THREE.AdditiveBlending`, `transparent: true`, `depthWrite: false` on the material.
- `packages/render-galaxy` entirely (see Out of scope).

## Out of scope

- The procgen galaxy cloud (`render-galaxy`, min 2 px, CV 6%) — if its residual shimmer
  still reads after this lands, that is a separate task with its own measurement.
- Any post-processing AA (FXAA/SMAA/TAA) — the architecture's post chain
  (architecture.md §"post") remains unbuilt; this task must not start it.
- Exposure/boost retuning (`GALAXY_FIELD_EXPOSURE_BOOST`, the settings-store exposure) —
  even if the faint field reads slightly dimmer after flux conservation (it will, for
  stars whose natural size was < 1 px: they were over-bright before, C-absences note).
  A global brightness pass is a follow-up decision, not a side effect of this diff.
- The `uPixelScale < 1` edge (viewports shorter than 1080 physical px get a
  sub-3-px effective floor, CV ~5% at ~2.2 px) — accepted; do not add viewport-dependent
  compensation logic.
- Star rendering at planet/system scales beyond what already flows through
  `createStarPoints` — no new call sites.

*Standing rule: findings during this task go to `docs/research/`; scope creep goes to a
new task file, not into this diff.*

## Deliverables / Steps

1. **Vertex shader** (`stars.vert.glsl.ts`): compute the natural (unclamped) size and
   the rendered (clamped) size as separate expressions:
   ```glsl
   float sNat = uBasePointPx * pow(10.0, -0.2 * m);
   float sRen = clamp(sNat, uMinPointPx, uMaxPointPx);
   gl_PointSize = sRen * uPixelScale;
   ```
   Emit a new varying `vSizeDim = min(1.0, (sNat / sRen) * (sNat / sRen));` — the area
   ratio, 1.0 whenever the star is not floor-clamped (and deliberately 1.0 when clamped
   *down* at `uMaxPointPx`: `min(1.0, …)` — do NOT brighten max-clamped stars; the
   fragment brightness clamp already saturates them).
2. **Fragment shader** (`stars.frag.glsl.ts`): multiply the existing brightness by the
   varying — `float brightness = clamp(…) * uExposure * vSizeDim;`. Nothing else moves.
3. **Default** (`star-points.ts:34`): `minPointPx = 1` → `minPointPx = 3`. Update the
   doc comment ("Defaults: min 1, max 64") and the README options-table row to match.
4. **Tests** (extend `packages/render-stars/test/star-points.test.ts`, same style):
   see Acceptance gate.

Mechanical task: exactly these files (`stars.vert.glsl.ts`, `stars.frag.glsl.ts`,
`star-points.ts`, `star-points.test.ts`, `README.md`). Do not refactor, do not extract
helpers, do not touch call sites (they use the default on purpose — that's what makes
the fix land in all three catalog surfaces at once, Step 0 fact 3).

## Failure modes to watch

- **Breaking the hi/lo jitter fix.** The vertex shader's
  `(position + uRenderOffsetHi) + uRenderOffsetLo` sum order is load-bearing (Sterbenz
  cancellation, commit `6bd7d24`, `docs/research/star-approach-jitter.md`). The size
  work is on separate lines — if your diff touches line 31 at all, stop and re-read
  that research doc.
- **Double-dimming / photometry discontinuity.** Brightness already encodes magnitude
  (`10^(-0.4m)`); the size law encodes it again (`10^(-0.2m)`), so a star's total flux
  goes as `10^(-0.8m)` while unclamped. The `(sNat/sRen)²` factor exists to *continue
  that same law* through the clamp region — it is not an extra artistic dim. Get the
  ratio direction right: floor-clamped ⇒ `sNat < sRen` ⇒ factor < 1. If you see faint
  stars *brighten* as you zoom out, the ratio is inverted.
- **Brightening at the max clamp.** Without the `min(1.0, …)`, stars clamped down at
  `uMaxPointPx = 64` would get a > 1 factor and blow out near-field bright stars. The
  live probe scene (near Sol) contains such stars — check one close bright star
  before/after.
- **Sub-pixel points reappearing via uPixelScale.** The floor multiplies `uPixelScale`
  (= viewportHeight/1080) *after* the clamp — keep it that way. Moving the clamp to
  after the multiply changes what "3 px" means per viewport and invalidates the frozen
  constant's rationale.
- **e2e work-budget gates.** Point *size* does not change `renderedPoints` or draw
  calls, so the deterministic CI gates (flythrough work-budget caps) must not move. If
  a budget gate fails after this change, something else is wrong — investigate, don't
  re-tune the cap (repo doctrine: fix root causes, `CLAUDE.md` / CI philosophy).
- **Judging the fix by screenshot in CI.** Repo rule 4: screenshots are
  reference-machine only. The twinkle verification is the live probe (below), run
  manually — never a CI screenshot diff.

## Acceptance gate (deterministic — must pass `pnpm verify`)

Extend `packages/render-stars/test/star-points.test.ts` (house style: option/uniform
assertions + shader-source string assertions):

1. `createStarPoints({ batch })` yields `uniforms.uMinPointPx.value === 3` (new
   default), and an explicit `minPointPx: 1` override still lands in the uniform
   (the option plumbing is unchanged).
2. `VERT` contains the dimming varying (`vSizeDim`) computed from the natural/rendered
   size ratio, and still contains the untouched hi/lo offset sum
   `(position + uRenderOffsetHi) + uRenderOffsetLo` (regression guard for the jitter
   fix).
3. `FRAG` multiplies brightness by `vSizeDim` and still contains the frozen falloff
   `smoothstep(0.5, 0.1,` (regression guard for the C2-validated falloff).
4. Existing tests stay green unmodified except any that assert the old default of 1 —
   update only those literals.

`pnpm verify` green. Behavior-affecting change to the app ⇒ per repo rule, run the
local single-spec smoke (`pnpm test:smoke` on one existing deterministic galaxy spec)
before pushing; full e2e stays in CI and must stay green.

## Verification beyond the gate (reference-machine only, non-blocking)

- Re-run the live probe: app visible past onboarding, paste
  `tools/research/twinkle-live-probe.js` into the console. Expect the `moving` phase to
  drop from median CV ~66% / medianSwing ~9× (measured 2026-07-14, pre-fix) to
  CV ≤ ~10% / medianSwing ≤ ~1.5×. Record the numbers in
  `docs/research/star-shimmer-on-motion.md` as a post-fix addendum.
- Eyeball a slow drag-pan at galaxy vantage and near Sol: stars should track smoothly
  with no sparkle; faint-field overall brightness should read roughly as before (slight
  dimming of the faintest stars is expected and accepted — see Out of scope, exposure
  retune).
