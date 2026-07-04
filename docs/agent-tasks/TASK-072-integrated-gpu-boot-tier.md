# Task: Land integrated GPUs on the right tier at boot + cap Retina pixel ratio

**ID:** TASK-072
**Target package:** `packages/scene-host` (+ small `apps/web` glue if needed)
**Size:** M
**Phase:** Maintenance track — integrated-GPU thread
**Depends on:** TASK-071 (so tiers actually reduce the #1 fill cost when this lands on one)

## Goal

An Iris Xe / Apple M1 user gets a smooth first ten seconds: the app *starts* on
`medium` when the GPU is recognizably integrated, instead of starting on `high` and
stuttering until `PerformanceMonitor` reacts (gap #2 in
`docs/research/integrated-gpu-targeting.md` §3). And the single largest fill multiplier
on M1 — `min(dpr,2) × resolutionScale` paying 4× fragments on Retina
(`packages/scene-host/src/SceneHost.tsx:112`, gap #3) — is capped on non-`high` tiers.

Hardware target floor per the settled decision (§0): modern integrated, Iris Xe/M1
class. The dev machine (RX 9070 XT) cannot observe these costs — that's why every
acceptance test here is deterministic/structural, and real M1 numbers are a separate
reference-machine activity (§Step 3), NOT part of this task's gate.

## Frozen Interface

- `QualityControllerImpl`'s public API and the tier state machine semantics unchanged —
  this task sets the *initial* tier and the pixel-ratio formula only.
- Tier table values in `core-types` unchanged (calibration happens on the M1 later).
- `PerformanceMonitor` wiring untouched — it remains the runtime safety net in both
  directions (a misdetected discrete GPU steps back up to `high` automatically).

## Deliverables

1. **Boot GPU detect** in scene-host init: read `WEBGL_debug_renderer_info`
   UNMASKED_RENDERER; if it matches an integrated-class pattern (case-insensitive:
   `Apple M`, `Intel.*(Iris|UHD|HD Graphics)`, `Mali`, `Adreno`), initial tier =
   `medium`; otherwise (including Safari's masked string / extension unavailable) keep
   today's `high`. Export the detection as a pure function `classifyRenderer(s: string
   | null): 'integrated' | 'unknown'` — the heuristic is fragile by design and the
   PerformanceMonitor backstop is the contract, so keep it dumb and testable, don't
   grow a device database.
2. **Pixel-ratio cap:** change the formula at `SceneHost.tsx:112` so the *effective*
   pixel ratio is additionally clamped per tier — `high`: unchanged (`min(dpr,2)`),
   `medium`/`low`: `min(dpr, 1.5)` / `min(dpr, 1)` before applying `resolutionScale`.
   Keep it applied only on tier change (comment at line ~106: "never per-frame").
3. **Manual override respected:** if a user/debug override forces a tier, detection
   must not fight it (check `QualityControllerImpl`'s existing override mechanism and
   order of initialization).
4. One-line boot log (existing diagnostics path) recording the renderer string + chosen
   initial tier — CI-failure triage doctrine: a wrong tier choice must be diagnosable
   from logs alone.

## Out of scope

- Any tier-table recalibration, bloom/atmosphere wiring, GPU timer-query gates
  (integrated-gpu-targeting §Step 3/§5 — reference-machine work).
- Mobile/touch (out of scope per the settled decision §0).
- User-facing quality settings UI.

## Failure modes to watch

- **CI/SwiftShader:** CI runs `--use-angle=swiftshader`; its renderer string
  (`SwiftShader`/`ANGLE`-prefixed) must classify as `unknown` → `high`, or every
  existing e2e baseline that implicitly assumes `high` shifts. Add SwiftShader strings
  to the unit-test fixtures explicitly. If any e2e spec breaks, that spec was coupled
  to the boot tier — fix per doctrine (query, don't assume), not by special-casing CI.
- **Detection after first frame:** reading the extension after the renderer has already
  drawn frame 1 at `high` defeats the point — detect before the first render pass.
- **dpr changes** (window moved between monitors): the existing tier-change handler
  re-applies pixel ratio; make sure the new clamp lives inside that same path, not a
  parallel one.

## Acceptance Tests

1. `pnpm verify` exits 0.
2. Unit (`classifyRenderer`): `"Apple M1"`, `"Apple M3 Pro"`, `"Intel(R) Iris(R) Xe"`,
   `"Intel HD Graphics 620"` ⇒ integrated; `"NVIDIA GeForce RTX 4090"`,
   `"AMD Radeon RX 9070 XT"`, `"Google SwiftShader"`, `"ANGLE (…SwiftShader…)"`,
   `null`, `""` ⇒ unknown.
3. Unit: effective-pixel-ratio formula per (tier, dpr) table — dpr 2 × medium ⇒ 1.5 ×
   resolutionScale, etc.
4. `pnpm test:e2e` fully green under SwiftShader with **zero spec changes** — proof CI
   still boots `high` and nothing regressed.

## Context Files

- `docs/research/integrated-gpu-targeting.md` §0–§4 (the plan this implements)
- `packages/scene-host/src/SceneHost.tsx` (~100–160: pixel ratio + PerformanceMonitor)
- `packages/scene-host/src/quality.ts` (tier machine, override, init order)
- `packages/core-types/src/quality.ts` (tier table — read-only here)
