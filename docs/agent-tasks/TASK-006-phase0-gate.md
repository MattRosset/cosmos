# Task: Phase 0 acceptance gate — jitter test + 12-OOM debug flythrough

**ID:** TASK-006
**Target package:** `packages/coords` (test only) + `apps/web` (debug scene)
**Size:** M — **GATE: closes Phase 0** (architecture §6 Phase 0 acceptance criteria)
**Phase:** 0
**Depends on:** TASK-005

## Goal

Prove the coordinate architecture works before anything is built on it: an automated
jitter test (ADR-001's acceptance gate) passes in CI, and a debug-marker scene lets a
human fly across 12 orders of magnitude with stable rendering. When this task is done,
the `coords` API is frozen and Phase 1 task authoring may begin.

## The jitter test (automated, CI)

Phase 0 version is a **simulated-projection** test in Vitest — it reproduces the f32
boundary mathematically, with no GPU, so it is deterministic on every machine. (The
rendered Playwright version arrives with the E2E harness in Phase 1; this numeric gate
stays forever as the fast regression check.)

Scenario (from §5.2 / ADR-001, fixed — do not change the numbers):

- Frame tree: planet marker at **8 kpc from galactic center** in the `galaxy` context:
  `{ context: 'galaxy', local: [8000, 0, 0] }`.
- Camera orbits the marker at **1 AU** radius (1 AU = 4.84813681e-6 pc), **300 frames**,
  one full revolution, calling `origin.setCameraPosition` each frame (rebases included).
- Each frame:
  1. `renderPos = origin.toRenderSpace(marker, out)` — then **downcast each component
     with `Math.fround`** (this models the GPU f32 vertex path).
  2. Project to screen space with a plain perspective projection (fov 60°, viewport
     1920×1080, look-at the marker) implemented in f64 in the test.
  3. Record screen-space (x, y) px.
- **PASS:** max deviation of the marker from its mean screen position **< 0.5 px**
  across all 300 frames.
- **Control (test must have power):** the same scenario through a *naive* path —
  absolute galaxy-frame position `Math.fround`-ed BEFORE camera subtraction — must
  FAIL (> 0.5 px). If the control passes, the test is wrong; fix the test, not the gate.

## The debug flythrough scene (manual, demoable)

`apps/web` gains a dev-only debug scene (URL `?debug=markers`) placing labeled marker
cubes at log-spaced distances covering ≥ 12 orders of magnitude, e.g. in context units:
`planet` 1e0–1e3 km, `system` 1e-2–1e2 AU, `galaxy` 1e-4–1e4 pc — anchored via the
frame tree so they are physically consistent. A debug HUD readout shows: current
context, |cameraLocal|, rebase count, speed, fps.

## Inputs / Outputs

- **Inputs:** frozen APIs of `coords`, `scene-host`, `nav` — consumed, not modified.
- **Outputs:** `packages/coords/test/jitter.test.ts`; debug scene + HUD in `apps/web`;
  status-table flip that opens Phase 1.

## Constraints & Forbidden Actions

- Do not modify `src/` of `core-types`, `coords`, `scene-host`, or `nav`. **If the
  jitter test fails, the fix is a separate, explicitly-reviewed bug task against
  `coords`** — set this task to `blocked` with note "jitter gate failed" and stop.
- The projection math in the test must be self-contained f64 (no Three.js import —
  `coords` tests stay pure).
- Debug scene ships behind the query flag only; zero cost when flag absent.
- No new dependencies.

## Common Mistakes (architecture §5.2, §6)

- Storing absolute positions in f32 anywhere — the control test exists to catch
  exactly this class of bug; keep it in the suite permanently.
- Rebasing mid-frame — the test must call `setCameraPosition` once per simulated
  frame, first, like the real loop does.
- Testing only near the origin — the whole point is the 8 kpc offset; do not "simplify"
  the scenario to small coordinates.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/coords test` — `jitter.test.ts`: scenario PASSES (< 0.5 px),
   naive control FAILS (asserted as expected-failure inside the test).
2. `pnpm verify` exits 0; `coords` coverage gate (≥ 90%, from TASK-003) still green.
3. Manual checklist recorded in the PR description (architecture §6 Phase 0):
   - [ ] Fly from a 1 km marker to a 10 kpc marker (≥ 12 OOM) — debug markers stable,
         no visible jitter or snapping at any scale.
   - [ ] Rebase counter increments during the flight with no visual discontinuity.
   - [ ] fps ≥ 60 on the dev machine throughout.
4. On completion: set TASK-006 to `done` in `docs/agent-tasks/README.md`, and update
   the root `README.md` Status line from "Phase: Planning" to "Phase 0 complete —
   Phase 1 (MVP Stars) in progress".

## Deliverables

- `packages/coords/test/jitter.test.ts`
- `apps/web/src/scene/DebugMarkers.tsx`, `apps/web/src/scene/DebugHud.tsx`
- `apps/web/src/App.tsx` (flag-gated mounting only)
- Root `README.md` (status line, on completion)

## Context Files

- `docs/decisions/ADR-001-coordinates.md` — §Consequences defines this gate
- `docs/architecture.md` §5.2 validation criteria, §6 Phase 0 acceptance
- `packages/coords/README.md`, `packages/nav/README.md`
