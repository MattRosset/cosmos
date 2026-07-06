# TASK-075 — Nebula Tier B: distance/aerial fade (B4)

**Provenance:** authored by a Sonnet agent with the `spec-task` skill in context
(executable-specs EVALS experiment 2, arm C, 2026-07-06), then hardened in review: an
internal direction contradiction fixed (goal said near=visible/far=faded; the function
contract and acceptance tests encoded the inverse), the fade constants decided
(`K_LO`/`K_HI` were left implementer-chosen), and the transit failure mode added from
repo history. Everything else is the agent's spec verbatim.
**Supersedes:** the B4 half of TASK-073. TASK-073 remains the reference for B3
(domain-warp filaments) only — do not implement B4 from it.

## Goal

Make the three overlay nebula fields (`neb:orion`, `neb:reflection`, `neb:remnant`) fade in
smoothly with camera proximity instead of sitting at full opacity (`setOpacity(1)`,
hard-coded) at every range. This is Tier-B item **B4** from
`docs/research/nebula-visual-quality.md` §3: *"Fade field opacity by camera distance so
nebulae bloom in softly instead of full-on at all ranges."* Today a nebula field pops to
full brightness the instant it is in the tier-allowed set, with no proximity cue — it reads
as a solid object you can "hit" rather than diffuse gas, and there is no bloom-in landmark
cue during navigation.

This is the ONLY Tier-B item in scope for this task. B1 (dust-lane absorption pass), B2
(soft-particle depth fade), and B3 (domain-warp filaments) are each a real rendering/blend-mode
design decision — see "Out of scope" — and are explicitly deferred to their own tasks.

## Step 0 — facts to re-verify before writing code

Re-confirm these against the current tree; they were true as read on 2026-07-06 but the
implementer must not trust this doc over the live source:

1. `apps/web/src/scene/Overlays.tsx` line ~131 currently calls `neb.setOpacity(1)`
   unconditionally inside the per-field loop in the `useFrameContext` callback (the frame
   loop at `PRIORITY_RENDER`). Confirm this is still the only place `setOpacity` is called
   on a nebula instance.
2. `packages/render-fx/src/nebula.ts` `Nebula.setOpacity(a: number)` sets
   `uniforms.uOpacity.value = a` directly — it does NOT clamp or interpret `a`; the caller
   owns the full [0,1] semantics. Confirm the shader (`nebula.frag.glsl.ts`) still multiplies
   `coverage * uOpacity * uExposure` with no other opacity term.
3. `apps/web/src/glue/nebulae.ts` `NEBULA_FIELDS` gives each field an absolute `originPc`
   in **galaxy-context parsecs**: orion `[-110,-380,-120]` r70, reflection `[420,160,90]` r55,
   remnant `[-260,540,-300]` r90 (the `r` is `radiusPc`, the field's nominal extent — used
   below to size the fade band per-field). Confirm these three literals are unchanged.
4. `origin.cameraUniverse` (from `packages/coords/src/origin.ts`, an `OriginManager`) exposes
   `{ context, local }` — the camera's absolute position in its current context, f64. In
   `Overlays.tsx` the `origin` prop is this `OriginManager`. When `origin.context !== 'galaxy'`
   the camera is not in galaxy-context units, so a straight `hypot` against a field's
   galaxy-pc `originPc` would be wrong — confirm whether `Overlays.tsx` (or its caller) ever
   mounts with `origin.context !== 'galaxy'`, and if so how `GalaxyScene.tsx`'s existing
   distance-fade code (`ctx === 'galaxy'` guard, lines ~458-470) handles it. Mirror that
   guard; do not invent a new one.
5. `apps/web/src/scene/GalaxyScene.tsx` already has a working, shipped distance-fade
   (`GAL_FADE_LO_PC = 1_500`, `GAL_FADE_HI_PC = 45_000`, local `smoothstep(lo,hi,x)` at
   line ~123) used for the procgen spiral's opacity. This task's fade is a DIFFERENT band
   (per-field, keyed to each field's own `originPc`/`radiusPc`, not the galaxy-center
   distance) — do not reuse `GAL_FADE_LO_PC`/`GAL_FADE_HI_PC`, but DO reuse the local
   `smoothstep(lo, hi, x)` pattern/shape (cubic Hermite, clamped) for consistency. Confirm
   there is no existing shared `smoothstep` export in `@cosmos/core-types` or similar before
   deciding to duplicate the 4-line helper (`apps/web/src/glue/nebulae.ts` already has its own
   private `smoothstep01`, so a small private copy is consistent with existing practice —
   do not add a shared utils module for this).
6. `packages/render-fx/test/nebula.test.ts` and `packages/core-types/test/nebula.test.ts` are
   the existing unit-test files for the nebula render/data layers. Confirm neither currently
   asserts anything about opacity being fixed at 1 that this task would contradict.

## Context files

- `apps/web/src/scene/Overlays.tsx` — where the per-frame fade must be computed and applied
  (`useFrameContext` loop, ~lines 105-133); owns `origin`, camera access via `useThree`.
- `apps/web/src/glue/nebulae.ts` — `NEBULA_FIELDS`, each field's `originPc`/implicit
  `radiusPc` (via `FIELD_SPECS`, not currently exported) — you need each field's nominal
  radius to size its fade band; decide whether to export `radiusPc` per field or hardcode
  per-field bands in `Overlays.tsx` (see Deliverables step 2).
- `packages/render-fx/src/nebula.ts` — `Nebula.setOpacity`, confirms the opacity contract
  (uniform passthrough, no internal clamping — caller must clamp to [0,1]).
- `packages/coords/src/origin.ts` — `OriginManager.cameraUniverse`, the camera's absolute
  position accessor (no per-frame allocation contract — check for allocation cost, see
  Failure modes).
- `apps/web/src/scene/GalaxyScene.tsx` (~lines 100-123, ~429-470) — the existing shipped
  distance-fade pattern (`smoothstep`, the `ctx === 'galaxy'` guard) to mirror, and the
  precedent for how procgen's fade and this fade must visually agree (fields should not
  "pop" relative to the spiral fade).
- `docs/research/nebula-visual-quality.md` §3 B4, §5 open decision 3 ("should nebulae fade
  with range... or stay full-opacity as navigation landmarks?") — this task's existence
  answers that decision: yes, fade.
- `packages/render-fx/test/nebula.test.ts` — existing unit coverage of `setOpacity`
  (zero-alloc mutation contract at line ~143); a new fade-curve test must live at the
  pure-function level, not duplicate this file's shape.
- `docs/research/galaxy-transit-procgen-floor-design.md` — the goto-galaxy transit this
  fade must not pop inside (see Failure modes).

## Frozen — do not touch

- `NebulaLayer` / `NebulaField` shape (`packages/core-types/src/nebula.ts`) and
  `MAX_NEBULA_LAYERS = 32`.
- The `Nebula.setOpacity(a)` contract/signature in `packages/render-fx/src/nebula.ts` — it
  stays a raw `[0,1]` passthrough. Do not add clamping or a second opacity uniform there;
  compute the clamped, faded value in the caller (`Overlays.tsx`) and pass a single number in.
- `nebula.frag.glsl.ts` / `nebula.vert.glsl.ts` — no shader changes. This task is a CPU-side
  per-frame scalar computed from camera distance, applied through the existing
  `setOpacity`/`setExposure` uniforms only.
- The three fields' `originPc`, `radiusPc`, `colorLinear`/`secondaryLinear`/`coreLinear`,
  `seed`, `layerCount` values in `FIELD_SPECS` (`apps/web/src/glue/nebulae.ts`) — Tier A is
  shipped and out of scope for re-tuning here.
- `GAL_FADE_LO_PC` / `GAL_FADE_HI_PC` in `GalaxyScene.tsx` — a different, already-shipped fade
  band for the procgen spiral. Do not repurpose or rename.
- `NEB_FADE_NEAR_RADII = 2.5` / `NEB_FADE_FAR_RADII = 8` (defined below) — placeholder values
  chosen in review; they move only via an explicit visual-calibration follow-up task, never
  inside this or another task's diff.

## Out of scope

- B1 (dust-lane absorption / non-additive pass), B2 (soft-particle depth fade against scene
  depth), B3 (domain-warp filament flow — remains specced in TASK-073) — each needs its own
  design task (blend-mode change, depth-texture wiring, shader-side warp respectively). Do
  not attempt any of them even partially.
- Any change to Tier A parameters (layer count, texture, colors) in `nebulae.ts`.
- Any change to which fields exist, their count, or their placement.
- Any change to the quality-tier gate (`nebulaeAllowed = tier !== 'low'` in `Overlays.tsx`) —
  the low tier stays fully hidden; this task only affects the faded-in amount on tiers where
  nebulae are already allowed.
- Raymarched volumetrics (Tier C) — not touched, not discussed further.

## Deliverables / Steps

1. **Pure fade-curve function, testable in isolation.** Add a small exported pure function —
   `nebulaDistanceFade(distancePc: number, radiusPc: number): number` — to
   `apps/web/src/glue/nebulae.ts` (same module that owns `NEBULA_FIELDS`/`FIELD_SPECS`, so it
   sits next to the data it fades and can read each field's own `radiusPc` without a new
   export surface). It must:
   - Return `1` at/inside the near band and `0` at/beyond the far edge, smoothly
     interpolating between them (camera approaching from far: the field blooms in; the
     Tier-A close-up look is untouched). Reuse a `smoothstep`-shaped ramp, consistent with
     the file's existing `smoothstep01` helper — either reuse that helper or inline the same
     shape; do not introduce a second differently-shaped curve in the same file.
   - Take the fade band as a multiple of the field's own `radiusPc`:
     `NEB_FADE_NEAR_RADII = 2.5` (full opacity at/inside `2.5 × radiusPc` from the field
     origin) and `NEB_FADE_FAR_RADII = 8` (fully faded at/beyond `8 × radiusPc`). Rationale,
     recorded here so the constants aren't re-litigated: the Tier-A reference capture
     (`nebula-visual-quality.md` §6/§7, ~130 pc vantage on Orion, r=70) sits at ~1.9× the
     radius — inside the near band, so the shipped look is pixel-identical; and 2.5×→8× of
     r=55..90 gives a ~300–500 pc ramp, wide relative to transit flight speed (see Failure
     modes). Both are placeholders pending a visual calibration pass — frozen above so they
     move only in an explicit follow-up.
   - Be a pure function of its two numeric inputs — no THREE.js types, no store reads, no
     camera access. This is what makes it unit-testable without mounting the Canvas.
2. **Wire it into the per-frame loop.** In `Overlays.tsx`'s `useFrameContext` callback,
   replace the hard-coded `neb.setOpacity(1)` with a call that:
   - Computes camera-to-field-origin distance in galaxy-context parsecs, guarded exactly like
     `GalaxyScene.tsx`'s existing `ctx === 'galaxy'` check (Step 0 fact 4) — if the camera is
     not in the galaxy context, decide (and document inline) the fallback: either treat all
     fields as fully visible (`1`) or fully hidden (`0`). Prefer whichever keeps behavior
     identical to today (`setOpacity(1)`) for any context this task's Step-0 investigation
     shows Overlays.tsx can actually be mounted in — do not guess if Step 0 didn't already
     answer it.
   - Calls the new `nebulaDistanceFade(distancePc, field.radiusPc)` per field per frame.
   - Passes the result straight to `neb.setOpacity(...)`. Do not multiply it into
     `setExposure` — exposure is a separate, unrelated relay (tone/HDR from the settings
     store) and must not be touched by this task.
   - Remains zero-allocation in the frame path (module-scoped scratch only, matching the
     existing `fieldLocalScratch`/`fieldOriginScratch`/`offScratch` pattern already in the
     file — reuse `origin.cameraUniverse.local` or a scratch tuple, whichever avoids a new
     per-frame allocation; check whether `cameraUniverse` getter allocates a fresh array each
     call (Step 0 fact 4) and route around it if so, e.g. by tracking the last
     `setCameraPosition` input or reading `origin`'s internal state through an existing
     accessor rather than adding a new allocating call in the hot loop).
3. **Do not touch** the `nebulaeAllowed` tier gate or the `setVisible` calls — the new fade
   is multiplicative with, not a replacement for, the existing on/off tier gate.

## Failure modes to watch

- **Popping instead of blooming.** If the fade band is sized wrong, a field will jump from
  invisible to fully bright within one or two frames of travel — visually indistinguishable
  from today's hard cut, defeating the point. Verify by manually flying toward a field (see
  `docs/research/nebula-visual-quality.md` §6 repro loop) and confirming a *visible ramp*
  over several seconds of approach, not a snap.
- **Mid-transit pop (repo history — this has bitten before).** The goto-galaxy transit
  flies near or through these fields; a band narrower than the distance the transit covers
  in a few frames pops a nebula mid-flight. The 2.5×→8× band exists to stay wide relative
  to flight speed — verify with the existing transit e2e path in CI rather than tuning by
  eye, and if a transit spec exists, confirm it still passes unchanged.
- **Frame-loop allocation regression.** Adding a `new THREE.Vector3()` or a fresh array per
  field per frame inside `useFrameContext` would violate the file's own zero-alloc contract
  (already documented in the module comment at line ~26 and enforced by the existing scratch
  pattern) — this is a correctness-adjacent regression the repo takes seriously, not a nice-
  to-have.
- **Wrong distance frame.** Computing distance against `field.originPc` while the camera is
  in a non-galaxy context (e.g. `system` or `local`) without the `ctx === 'galaxy'` guard
  would silently produce nonsense distances (comparing parsecs against system-context units)
  and either black out or wrongly full-light every field. This is the single most likely
  silent bug — Step 0 fact 4 exists specifically to force checking it before writing code.
- **Confusing this fade with the procgen spiral's fade.** `GalaxyScene.tsx` already fades the
  procgen cloud/dust/HII by distance-from-galaxy-center. This task's fade is PER-FIELD
  distance-from-field-origin — a different signal. Do not wire nebula opacity to
  `procgenBlend`/`procgenOpacityHolder` from `GalaxyScene.tsx`; they are unrelated layers that
  happen to share a fading idiom, not a shared state value.

## Acceptance gate (deterministic — must pass `pnpm verify`)

New unit tests for `nebulaDistanceFade` in `apps/web/test/nebulae.test.ts` (co-located per
existing convention if a test file for `apps/web/src/glue/nebulae.ts` already exists —
otherwise create it next to the other `apps/web` glue tests, following the same directory
convention), asserting:

- `nebulaDistanceFade(d, r) === 1` for every `d ≤ 2.5 × r` (including `d = 0` and the exact
  boundary) — the regression test that the Tier-A close-up look is unchanged: the camera at
  or inside the near band always sees full opacity, exactly like today's `setOpacity(1)`.
- `nebulaDistanceFade(d, r) === 0` for `d ≥ 8 × r` — the far "solid blob from the galaxy
  view" is fully softened.
- Monotonically non-increasing as `d` grows, for a fixed `radiusPc`, across a swept range —
  confirms a proper bloom-in ramp with no dips.
- Output always within `[0, 1]` inclusive across the sweep, including negative/zero distance
  edge cases — confirms it never needs external clamping (matches the Frozen contract that
  `setOpacity` does not clamp).
- Scales with `radiusPc`: at the same absolute distance `d` inside both ramps, a
  smaller-radius field is further along its fade than a larger one (orion r=70 vs remnant
  r=90) — confirms the band is radius-relative, not a fixed pc constant (a fixed-pc band
  would look inconsistent across the three differently-sized fields).

`pnpm verify` (lint + typecheck + unit test + build) must be green; this task does not touch
e2e specs and does not require `pnpm test:e2e` locally, but the CI e2e run must stay green —
specifically any existing transit/flythrough spec (see Failure modes: mid-transit pop).

## Verification beyond the gate (reference-machine only, non-blocking)

- Visual check using the `docs/research/nebula-visual-quality.md` §6 repro loop: fly from
  far outside a field's `8 × radiusPc` band down to its center and confirm a gradual
  bloom-in, not a pop. This is a manual/local sanity check only — do not gate CI on
  screenshot comparison (repo policy, `docs/testing-conventions.md` rule 4).
- Verify against the mid-distance vantage already documented as "cohesive glowing core with
  wispy halo" in `nebula-visual-quality.md` §7 (~130 pc, inside the near band), to confirm
  the new fade does not regress the shipped Tier-A look at the range that screenshot was
  taken from.
