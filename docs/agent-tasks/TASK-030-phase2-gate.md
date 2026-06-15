# Task: Phase 2 acceptance gate — M2 milestone, invisible context switches

**ID:** TASK-030
**Target package:** `apps/web` (debug mode) + `e2e/` + `docs/`
**Size:** M — **GATE: closes Phase 2** (architecture §6 Phase 2 acceptance)
**Phase:** 2
**Depends on:** TASK-029

## Goal

Prove M2 before Phase 3 task authoring begins. Architecture §6 Phase 2 acceptance,
verbatim: *"Context switches invisible to user (visual regression on transition
keyframes); orbit accuracy tests pass; time controls behave per §5.4."* The first
clause gets a dedicated automated harness here; the other two are re-asserted from
the suites that own them (TASK-021 ephemeris gate, TASK-019 clock suite) plus the
M2 flow spec. When this task is `done`, the public APIs of `sim-time`, `orbits`,
`render-planets`, and the v2/v3 surfaces of `data`, `app-state`, `ui`, `nav`, and
`scene-host` freeze, and Phase 3 specs may be written.

## The context-switch transition test (automated, CI)

Mechanism — a self-measuring debug mode like TASK-017's jitter probe, so Playwright
stays simple:

- `apps/web` gains `?debug=ctxswitch`: loads packs as normal, then drives a
  scripted approach with the REAL nav controller (this gate measures the shipped
  pipeline, unlike the jitter probe's isolation — the difference is deliberate and
  documented): camera starts 0.02 pc from Sol on the +X galaxy axis facing it,
  `goTo` Sol with `arrivalDistanceM = 5e14`, then continues to Saturn's current
  position with planet-arrival distance, then reverses out past the exit
  threshold. Throughout, every frame is sampled at 1280×720: the mode records
  per-frame **mean absolute pixel delta** between consecutive frames (downscaled
  to 160×90 via an offscreen canvas `drawImage` + `getImageData`, computed at
  most every 3rd frame to stay cheap) plus the frame timestamps of the two
  `onContextSwitch` events.
- Results on `window.__ctxSwitchResult = { enterFrameDelta, exitFrameDelta,
  medianFlightDelta, switches: ContextSwitchEvent[], frames }` where
  `enterFrameDelta`/`exitFrameDelta` are the deltas measured across the switch
  frames.
- **PASS (the "invisible" definition, fixed):** each switch-frame delta ≤
  3 × `medianFlightDelta` (a switch may not stand out from ordinary flight
  motion), AND exactly 2 switches fired, AND no single frame during the script
  exceeds 250 ms.
- `e2e/tests/ctxswitch.spec.ts` (chromium): open the mode, await
  `__ctxSwitchResult` (timeout 90 s), assert the rule. Additionally capture
  screenshots at switch−1s and switch+1s for each switch and commit them as
  reviewed keyframe baselines (`maxDiffPixelRatio` 0.05, the TASK-014/015
  cross-platform settings).

## Re-asserted gates (no new code)

- **Orbit accuracy:** `pnpm --filter @cosmos/pack-solar test` (the 8-planet
  Horizons gate) green in the same CI run — listed explicitly in the workflow so
  a skipped/cached job cannot mask it.
- **Time controls per §5.4:** `pnpm --filter @cosmos/sim-time test` green + the
  m2.spec time assertions green.
- Full suite: unit (`pnpm verify`), e2e (smoke, flythrough, m1, m2, jitter,
  ctxswitch, context-loss), bundle gate, Lighthouse (thresholds unchanged from
  TASK-017 — performance ≥ 0.85, interactive ≤ 4000 ms, now with packs +
  textures in `dist`).

## Deviation note — yardstick refinement (human-approved 2026-06-14)

The PASS rule's first clause was written as *each switch-frame delta ≤ 3 ×
`medianFlightDelta`*. In practice the M2 descent renders **mostly-empty frames**:
at galaxy/system scales nearby stars show no perceptible parallax and planets are
sub-pixel until the final approach, so the consecutive-frame flight-delta
distribution is extremely heavy-tailed — `medianFlightDelta ≈ 0.001` while
`maxFlightDelta ≈ 2.4` (÷255). The context switches are genuinely invisible
(`enterFrameDelta ≈ 0.11`, `exitFrameDelta ≈ 0.72`, both far below the 2.4 peak of
ordinary flight motion), yet `3 × ≈0` is a degenerate threshold that no faithful
probe can clear (confirmed: the median stays ≈0.001 even when the start is moved
well outside the enter gate — the empty scene, not the start point, is the cause).

**Resolution (approved, not a relaxation):** compare each switch-frame delta
against the **max ordinary flight-frame delta** instead of `3 × median`. This keeps
the architecture's stated intent verbatim — *"a switch may not stand out from
ordinary flight motion"* — and is robust to the empty-scene median collapse; the
switch must be no more prominent than the single most prominent ordinary frame
(margin ~0.72 vs ~2.4). The other two clauses are unchanged: **exactly 2 switches**
and **no frame > 250 ms**. The switch delta is measured as a true across-switch
adjacent-frame delta (switch frame vs the frame immediately before it), and the
diagnostics `medianFlightDelta`/`p99FlightDelta`/`maxFlightDelta` are logged every
run. Precedent for recorded, signed-off gate refinements: TASK-019 (Kahan advance)
and TASK-021 (ADR-002 Jupiter/Saturn tolerance).

## Inputs / Outputs

- **Inputs:** the complete M2 app (TASK-029).
- **Outputs:** green gates in CI; flipped status table; updated root README; a
  recorded M2 demo (link or path in the PR) for the milestone review (§16).

## Constraints & Forbidden Actions

- Do not modify any `packages/*` or `tools/*` source. **If a gate fails, the fix
  is a separate, explicitly-reviewed bug task** — set this task to `blocked` with
  a one-line note and stop (TASK-006/017 doctrine).
- Do not relax thresholds to pass (3× median, 2 switches, 250 ms, 0.85, 4000 ms
  are the spec). A flaky-runner exception needs human sign-off recorded in the
  PR, never a silent retry loop.
- No new dependencies.
- The ctxswitch mode is flag-gated like `?debug=jitter` — zero cost when absent;
  the pixel sampling exists only in this mode.

## Common Mistakes (architecture §5.2, §6, §12)

- Measuring during initial load/exposure settle — start sampling only after
  `__cosmos.ready` AND 30 warm-up frames.
- Comparing switch frames against a STILL camera baseline (everything passes —
  flight motion is the honest yardstick; the median-delta normalization is the
  point, do not simplify).
- Running Lighthouse against the dev server (must be the built `dist`).
- Letting the script depend on wall-clock sim time — pause the clock
  (`accel = 0` equivalent: `setPaused(true)`) during the ctxswitch script so
  planet motion doesn't contaminate frame deltas; the script tests CAMERA
  transitions, not orbits.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `ctxswitch.spec.ts` green under the PASS rule above; keyframe baselines
   committed and human-reviewed once (§8.4).
2. Re-asserted gates green as listed (workflow names them explicitly).
3. Manual M2 checklist recorded in the PR description (architecture §6 M2):
   - [ ] Zoom from star field into Sol with no visible snap, both directions.
   - [ ] Planets orbit at 10⁶×; pause freezes them; reverse runs them backward.
   - [ ] Saturn: rings, terminator, Titan present; orbit lines correct.
   - [ ] Jump to TRAPPIST-1 and tour its planets (semi-procedural colors).
   - [ ] Bookmark at Saturn survives reload and restores view + epoch.
   - [ ] 60 fps on the reference desktop throughout the above.
   - [ ] Demo recording captured for the milestone review (§16).
4. On completion: set TASK-030 to `done` in `docs/agent-tasks/README.md`; update
   root `README.md` status to "Phase 2 (M2) complete — Phase 3 (Galaxy &
   Streaming) spec in progress"; record the API freeze in
   `docs/agent-tasks/README.md`'s GATE note (Phase 3 thaw is the next sanctioned
   change window).

## Deliverables

- `apps/web/src/scene/CtxSwitchProbe.tsx` + flag-gated mounting in `App.tsx`
- `e2e/tests/ctxswitch.spec.ts` + keyframe baselines
- `.github/workflows/ci.yml` (explicit gate-job listing; Lighthouse step
  unchanged in thresholds)
- `docs/agent-tasks/README.md` + root `README.md` status flips (on completion)

## Context Files

- `docs/architecture.md` §6 Phase 2 acceptance, §12 (CI), §16 (milestone ritual)
- `docs/agent-tasks/TASK-017-phase1-gate.md` (gate doctrine + probe pattern)
- `docs/agent-tasks/TASK-027-nav-context-switch.md` (thresholds the script must
  cross), `TASK-029-m2-integration.md` (`__cosmos` hooks)
- `e2e/tests/jitter.spec.ts`, `e2e/tests/helpers/frame-stats.ts`
