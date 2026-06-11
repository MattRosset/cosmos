# Task: Phase 1 acceptance gate — M1 milestone, rendered jitter test, Lighthouse

**ID:** TASK-017
**Target package:** `apps/web` (debug mode) + `e2e/` + `.github/workflows/ci.yml`
**Size:** M — **GATE: closes Phase 1** (architecture §6 Phase 1 acceptance)
**Phase:** 1
**Depends on:** TASK-015, TASK-016

## Goal

Prove M1 before Phase 2 task authoring begins: the rendered (GPU) version of the
jitter test promised in TASK-006 runs in CI, Lighthouse performance ≥ 85 and cold
load < 4 s are enforced, and the human milestone checklist is recorded. When this task
is `done`, the APIs of `data`, `render-stars`, `app-state`, `ui`, and `nav` (v2)
freeze, and Phase 2 specs may be written.

## The rendered jitter test (automated, CI)

The Phase 0 gate proved the math with a simulated projection; this proves the real
pipeline (Three.js camera, log-depth buffer, actual GPU f32 path). Mechanism — a
self-measuring debug mode, so Playwright stays simple:

- `apps/web` gains `?debug=jitter`: mounts a single bright marker at
  `{ context: 'galaxy', local: [8000, 0, 0] }`, orbits the camera around it at 1 AU
  (4.84813681e-6 pc) radius for 300 rendered frames (no user input), each frame
  projecting the marker's render-space position through the live camera
  (`Vector3.project`) and recording screen-space px.
- Results on `window.__jitterResult = { maxDeviationPx, frames }` when done.
- **PASS:** `maxDeviationPx < 0.5` at 1280×720 (same threshold as ADR-001).
- The mode reuses frozen APIs only (`coords`, `scene-host`, `nav` not required);
  flag-gated like `?debug=markers`, zero cost when absent.

`e2e/tests/jitter.spec.ts` (chromium): open the mode, await `__jitterResult`
(timeout 30 s), assert the threshold.

## Lighthouse + load budget (automated, CI)

- Add `@lhci/cli` as a root devDependency. CI step (in the `e2e` job, after build):
  `lhci autorun` with `staticDistDir: apps/web/dist`, desktop preset, assertion
  `categories:performance >= 0.85` (§6 Phase 1 acceptance) — config in
  `lighthouserc.json`.
- Cold load < 4 s on cable: enforced via Lighthouse `interactive` metric assertion
  ≤ 4000 ms under the default desktop throttling profile. Document in the config that
  this models §6's "cable connection" budget.

## Inputs / Outputs

- **Inputs:** the complete M1 app (TASK-015) and deploy/preview (TASK-016).
- **Outputs:** green gates in CI; flipped status table; updated README; a recorded
  demo (link or path in the PR) for the milestone review (§16).

## Constraints & Forbidden Actions

- Do not modify any `packages/*` source. **If the rendered jitter test fails, the fix
  is a separate, explicitly-reviewed bug task** — set this task to `blocked` with note
  "rendered jitter gate failed" and stop (same doctrine as TASK-006).
- Do not relax thresholds to pass (0.5 px, 85, 4000 ms are the spec). A flaky-runner
  exception needs human sign-off recorded in the PR, never a silent retry loop.
- Allowed new dependency: `@lhci/cli` (root devDependency) only.
- Jitter mode must drive the camera directly (scripted orbit, no nav/controller) so
  the measurement isolates the coordinate + render pipeline.

## Common Mistakes (architecture §5.2, §6, §12)

- Testing only near the origin — the 8 kpc offset is the point; do not simplify.
- Measuring during the orbit's first frames before exposure/layout settle — discard
  the first 10 frames (warm-up), measure the next 300.
- Running Lighthouse against the dev server (must be the built `dist`).
- Letting the jitter spec race the app: gate on `__cosmos.ready` (pack load) being
  irrelevant — jitter mode must not load the pack at all (isolation + speed).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `jitter.spec.ts` green: `maxDeviationPx < 0.5` over 300 frames on swiftshader.
2. Lighthouse step green: performance ≥ 0.85, interactive ≤ 4000 ms.
3. Full suite green: unit (`pnpm verify`), e2e (smoke, flythrough, m1, context-loss,
   jitter), bundle gate.
4. Manual M1 checklist recorded in the PR description (architecture §6 M1):
   - [ ] Fly among 120k real stars at 60 fps on the reference desktop.
   - [ ] Click Sirius → info panel data correct (distance ≈ 2.64 pc, class A).
   - [ ] Search "Betelgeuse" → Enter → smooth flight, no overshoot, panel correct.
   - [ ] Preview/production URL loads cold in < 4 s on a normal connection.
   - [ ] Demo recording captured for the milestone review (§16).
5. On completion: set TASK-017 to `done` in `docs/agent-tasks/README.md`; update root
   `README.md` status to "Phase 1 (M1) complete — Phase 2 (Solar & Planetary Systems)
   spec in progress".

## Deliverables

- `apps/web/src/scene/JitterProbe.tsx` + flag-gated mounting in `App.tsx`
- `e2e/tests/jitter.spec.ts`
- `lighthouserc.json`, root `package.json` (`@lhci/cli`), `.github/workflows/ci.yml`
  (Lighthouse step)
- `docs/agent-tasks/README.md` + root `README.md` status flips (on completion)

## Context Files

- `docs/decisions/ADR-001-coordinates.md` (gate definition)
- `docs/architecture.md` §6 Phase 1 acceptance, §12 (CI), §16 (milestone ritual)
- `docs/agent-tasks/TASK-006-phase0-gate.md` (the simulated twin of this gate)
- `packages/coords/test/jitter.test.ts` (scenario numbers to mirror exactly)
- `e2e/README.md`, `e2e/tests/helpers/frame-stats.ts`
