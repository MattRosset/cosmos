# Task: `scene-host` — post-processing chain foundation (identity composite, tier-gated)

**ID:** TASK-104
**Target package:** `packages/scene-host` (+ `apps/web` dep/lockfile only)
**Size:** M
**Phase:** post-M4a — render-quality lane (step 1 of 3: foundation → AA → bloom)
**Depends on:** TASK-039 (quality tiers + `useQuality()`), TASK-047 (render-fx exists)

## Goal

Wire the postprocessing chain that architecture §5.1 assigns to `scene-host` ("owns the
… postprocessing chain") and that §9's degradation order already reserves a tier flag for
(`bloomEnabled`), but which was **never implemented** — the flag has been "flag-only (no
post chain wired)" since TASK-039 (`docs/research/integrated-gpu-targeting.md:40`).

This task builds **only the foundation**: mount a `@react-three/postprocessing`
`<EffectComposer>` inside the Canvas, gated by the current tier's `bloomEnabled` flag, that
renders the scene through a render-target and composites it back to the screen **with the
image visually unchanged (identity)**. It adds **no visible effect** — antialiasing
(TASK-105, step 2) and selective bloom (TASK-106, step 3) are additive effects that mount
into this composer later. The value delivered now is the plumbing + the tier gate + the
isolation guarantees, verified by deterministic structural gates.

This is a sanctioned Phase-post-M4a thaw of `scene-host`'s internals **plus one additive
optional `SceneHostProps.postProcessing?: boolean` field** (default `true` — see the
probe-conflict decision). Every other part of the public API (`QualityController`, `useQuality`,
frame priorities, all existing `SceneHostProps` fields) is **unchanged**;
`QualitySettings`/`QUALITY_TIERS` are **unchanged** (`bloomEnabled` already exists). All
existing scene-host test **files** are **unmodified**.

> **Spec-fact correction (executor, 2026-09-07).** The original "break one existing test ⇒ blocked"
> assumed the composer mounts cleanly in the unit env. It does not: a real WebGL2 `EffectComposer`
> throws under `@react-three/test-renderer`'s mock GL (`getContextAttributes()` is `undefined`), so
> every test that mounts `SceneHost` at tier `high` went red. Per the repo's "vitest has no WebGL →
> WebGL is covered in e2e" rule, the composer is stubbed package-wide by a new `vitest` `setupFiles`
> entry (`test/setup-postprocessing.ts`); existing test FILES stay unmodified and load `SceneHost`
> crash-free. No assertion/threshold changed. See `NOTES.md`.

## Step 0 — Re-verify before writing code (facts move; the spec was written 2026-08-07)

Run these and confirm; if any is false, STOP and update this spec (global rule 1), do not
improvise around the contradiction. Log the results in `NOTES.md`.

1. **No post infra exists yet.** `grep -rn "EffectComposer\|postprocessing\|@react-three/postprocessing" apps/web/src packages/*/src`
   returns only comments/flags (nebulae, quality.ts, budgets.ts, this-lane research) — no
   mounted composer. `grep -c postprocessing pnpm-lock.yaml` → 0 (not installed).
2. **The tier flag is present and already threaded.** `packages/core-types/src/quality.ts`
   `QUALITY_TIERS`: `bloomEnabled` is `true` for high+medium, `false` for low.
   `packages/scene-host/src/use-quality.ts` exports `useQuality(): QualitySettings` and is
   callable inside the Canvas tree (it reads `QualityContext`).
3. **The composer coexists with the probe apps' manual render pass — MEASURED & RESOLVED
   2026-09-07 (`docs/research/post-chain-probe-render-conflict.md`).** Six probe scenes call
   `gl.render(scene, camera)` at `useFrame` priority **100** (`CtxSwitchProbe`, `ErrorGateProbe`,
   `Flythrough3Probe`, `Flythrough4Probe`, `M3DescentProbe`, `SoakProbe`). The 2026-08-08
   spec-review framed this as a **STOP** because these "feed deterministic budget gates" — that
   REASON was **measured false**; the instinct (owner decision, not executor) was right. What the
   measurement found:
   - **The high-tier budget gates read the STREAMING POLICY's CPU-side counts, not the renderer.**
     `m3`/`m4a`/`flythrough3`/`soak3`/`ctxswitch` assert on `__cosmos.streaming.{drawCalls,
     renderedPoints}` = `visible.length` / `Σ pointCount` (`packages/streaming/src/policy.ts:837,
     843`). An identity composite pass **cannot move these** — they are decoupled from WebGL.
   - **The ONLY gate reading `gl.info.render` is `flythrough4`** (`Flythrough4Probe.tsx:397-398`),
     and it runs on `Flythrough4ProbeApp`, pinned tier **`low`** (`:146,166`) ⇒ `bloomEnabled=false`
     ⇒ `PostChain` returns null ⇒ **no composer**. So the one renderer-aggregate gate never mounts it.
   - **Priority ordering makes the composite invisible even where it mounts.** Probes render at
     prio 100; the composer subscribes at a low positive prio (lib default 1). The composer runs
     first, the probe's manual `gl.render` runs LAST and overwrites it, and `gl.info.render` resets
     per `render()` — so a probe measures only its own scene work. The composite is wasted work
     that is overwritten before measurement.
   **The real (narrow) residual:** `error-gate.spec.ts:64` asserts `errorCounts.total === 0`; a
   double render that emits any WebGL warning through the diagnostics sink would trip it — via
   errors, never via a budget count. Plus wasted double-GPU work + a target allocation in the
   ~6 high-tier manual-render probe apps. **Resolution: see "Decision (probe-conflict, owner-resolved
   2026-09-07)" below** — an additive `SceneHostProps.postProcessing` flag the probe apps set false.
   No gate, tier, or threshold changes. (The apps that WOULD mount the composer at `high`:
   `CtxSwitchApp` [no explicit tier ⇒ SceneHost default `'high'`], `ErrorGateApp`, `M3App`,
   `M4aApp`, `Soak4ProbeApp`, `StreamingProbeApp`; `Flythrough4ProbeApp` is the only manual-render
   app pinned `low`.)
4. **The Canvas has no `frameloop` prop** (`SceneHost.tsx` Canvas passes only `gl`+`camera`)
   → default `'always'` loop, so `@react-three/postprocessing`'s internal render-priority
   takeover is the standard path.
5. **A compatible dependency version resolves.** Determine the `@react-three/postprocessing`
   major that lists R3F **9.x** + three **0.184** + React **19** as compatible peers (its
   README/npm peer ranges), install it, and confirm `pnpm install` + `pnpm --filter
   @cosmos/web build` resolve peers **without** `--force`, `overrides`, or a peer war. If no
   version cleanly supports this R3F/three/React trio, STOP and report (do NOT force-install
   or pin a mismatched peer) — that is a blocking decision, not an executor call.

## Decision (owner-resolved 2026-08-07 — do NOT re-litigate)

Mechanism is the **`postprocessing` lib via `@react-three/postprocessing`** (its
`<EffectComposer>`), NOT a hand-rolled drei `useFBO` loop. Rationale: architecture.md:176
names the `postprocessing` lib as scene-host's technology; §5.11 specs selective bloom on it;
the `bloomEnabled` tier flag already exists for it. This implements the roadmap instead of
inventing a parallel FBO mechanism. See
`docs/research/screenspace-density-bloom-implementation.md` (amended verdict).

## Decision (probe-conflict, owner-resolved 2026-09-07 — do NOT re-litigate)

Resolves Step-0 item 3. Evidence: `docs/research/post-chain-probe-render-conflict.md`.

A manual-render probe and an `EffectComposer` are **mutually-exclusive render owners**; an app
driving its own `gl.render` loop must not mount the composer. Thread an **additive** optional
`postProcessing?: boolean` (default `true`) on `SceneHostProps`; `PostChain` mounts only when
`postProcessing && bloomEnabled`. The six manual-render probe apps pass `postProcessing={false}`;
`StarApp` keeps the default and gets the composer at medium/high.

- **This is a sanctioned additive `SceneHostProps` thaw** — one optional prop, default = today's
  behavior for every existing consumer. It is the ONLY public-API change this task makes; the rest
  of `SceneHostProps` stays frozen (see "Frozen").
- **REJECTED alternative — "pin the colliding probe apps to tier `low`"** (the original Step-0
  mitigation): `m3`/`m4a`/`soak3` assert the **high-tier** streaming caps (e.g. `m3.spec.ts:175`
  "rendered points within the high-tier cap"). Forcing those probes to `low` silently changes which
  cap the gate tests — a gate-semantics change, forbidden by global rules 1/3. The `postProcessing`
  flag keeps every probe at its current tier.
- **CI determinism of the composer stays in the scene-host unit test** (`test/post-chain.test.tsx`,
  Acceptance §1) — a `@react-three/test-renderer` gate that drives the tier seam directly, not a
  pack/env-sensitive e2e probe. Consistent with `[[dont-gate-peak-of-per-frame-sample]]` and
  `[[always-on-alarm-for-known-cliffs]]`.

## What to build (mechanical — transcribe, don't redesign)

### 1. Dependencies

Add to `packages/scene-host/package.json` `dependencies`: `@react-three/postprocessing`
(Step-0-verified version) — it peer-depends on `postprocessing`, `three`, `@react-three/fiber`,
`react`, all already present. Add `postprocessing` explicitly too if the lockfile does not
hoist it as a direct-usable specifier. `apps/web` inherits transitively; only its lockfile
changes. **Log the exact resolved versions of both packages in `NOTES.md`.**

### 2. New component: `packages/scene-host/src/PostChain.tsx`

A **leaf** component that isolates the tier gate so a tier change re-renders ONLY this
component (never the scene content — §5.1 Canvas-isolation rule):

```tsx
export function PostChain({ enabled = true }: { enabled?: boolean }): React.JSX.Element | null {
  const { bloomEnabled } = useQuality();          // re-renders PostChain on tier change only
  if (!enabled || !bloomEnabled) return null;      // opted-out OR low tier → no composer, R3F default render
  return (
    <EffectComposer /* identity config — see below */ >
      {/* step 1: NO visible effect. Only a tone-mapping-preserving output (see §3). */}
    </EffectComposer>
  );
}
```

`enabled` carries the `SceneHostProps.postProcessing` value (default `true`) from `SceneHost`
(see the probe-conflict decision above). A manual-render probe app passes `postProcessing={false}`
so the composer never mounts alongside its own `gl.render`.

- `EffectComposer` captures the scene + camera from the R3F root store, so its JSX sibling
  position does not affect what it composites (only effect ordering among effects matters,
  and there is one composer). Mount it (see §4) inside the existing `QualityContext.Provider`.
- **`multisampling={0}`** on `EffectComposer` (MSAA + postprocessing on WebGL2 is
  broken/expensive — architecture §5.1 "Common mistakes"; AA arrives as an SMAA/FXAA *effect*
  in TASK-105, not renderer MSAA). `depthBuffer`/`stencilBuffer`: defaults, unless Step-0
  found a package needing depth in the composite.
- **`frameBufferType={UnsignedByteType}` (8-bit) — REQUIRED for the step-1 no-op (measured
  2026-09-07, `docs/research/post-chain-identity-hdr-target.md`).** The lib default is HalfFloat
  (HDR); on this scene's **additive star sprites** an HDR intermediate accumulates unclamped and the
  composite renders visibly brighter/crisper than the direct 8-bit path (§3 identity FAILS). An 8-bit
  target clamps the additive sum exactly like the direct path ⇒ visual no-op. **TASK-106 (bloom)
  switches this back to HalfFloat** — bloom needs HDR headroom, and the brighter cores are then the
  intended visible change, not a regression.

### 3. Identity (the load-bearing correctness constraint)

Step 1 must be **visually a no-op**. The one real risk: `@react-three/postprocessing`'s
`EffectComposer` disables the renderer's built-in tone mapping (sets `gl.toneMapping =
NoToneMapping`) and expects a `<ToneMapping>` effect to reproduce it. Left unhandled, the
whole image shifts (washed-out / wrong gamma) the instant the composer mounts — that is a
regression, not "foundation."

Rule (ordered, checkable):
1. Read the renderer's current tone mapping at mount (`gl.toneMapping`). R3F's default is
   `ACESFilmicToneMapping` (the app sets none — belief per
   `milky-way-glow-render-technique.md`, unconfirmed at runtime → **confirm it in Step 0/at
   mount and log the actual enum value**).
2. Add a single `<ToneMapping mode={…}>` effect to the composer configured to reproduce that
   exact operator (e.g. `ToneMappingMode.ACES_FILMIC` when the renderer is ACESFilmic), so the
   composite output matches the pre-composer image. This tone-mapping effect is **not** a
   "visible effect" in the step-2/3 sense — it is the identity-preserving output stage.
3. The composite must also preserve output color space (sRGB); the postprocessing lib handles
   this in its final pass — confirm no double-encode (image not darkened/brightened).

If, at runtime, the current tone mapping is something the `<ToneMapping>` effect cannot
reproduce 1:1, STOP and note it rather than shipping a changed image.

**Measured 2026-09-07 (executor):** tone mapping is `ACESFilmicToneMapping` (runtime-confirmed via
the `[post-chain] mount` log) and `ACES_FILMIC` reproduces it — but reproducing the operator is **not
sufficient** for identity here. The scene's **additive star sprites** made the HalfFloat-default
composite brighter/crisper than the direct path; identity required also matching the framebuffer
precision (`frameBufferType={UnsignedByteType}`, §2 above). See
`docs/research/post-chain-identity-hdr-target.md`. `exposure` (25) is an app shader uniform applied
upstream of tone mapping, identical in both paths — not part of the tone-mapping handoff.

### 4. Mount point: `packages/scene-host/src/SceneHost.tsx`

Add an additive optional `postProcessing?: boolean` (default `true`) to `SceneHostProps`, thread
it through `SceneHost` → `QualityRoot`, and mount `<PostChain enabled={postProcessing} />`
**inside `QualityRoot`**, as a sibling of `<PerformanceMonitor>` within the
`QualityContext.Provider` (it needs `QualityContext` for `useQuality()` and the Canvas `gl`/scene
— both present there). Do **NOT** mount it inside `FrameLoopRoot`: `FrameLoopRoot` is exported and
unit-tested in isolation without a Canvas/QualityContext, and an `EffectComposer` there would
break those tests.

```tsx
// inside QualityRoot, within <QualityContext.Provider>:
<QualityApplier qc={qc} />
<PerformanceMonitor onDecline={handleDecline} onIncline={handleIncline}>
  {frameLoopRoot}
</PerformanceMonitor>
<PostChain enabled={postProcessing} />
```

The six manual-render probe apps (`CtxSwitchApp`, `ErrorGateApp`, `M3App`, `M4aApp`,
`Soak4ProbeApp`, `StreamingProbeApp`) must pass `postProcessing={false}` to their `<SceneHost>`
so the composer never mounts alongside their `gl.render` (probe-conflict decision above).
`StarApp` and `Flythrough4ProbeApp` are untouched (the latter is already `low`, so the flag is
moot there but leave it at the default).

Frame ordering: `EffectComposer` renders at its internal positive `useFrame` priority (> the
`PRIORITY_RENDER = 0` at which render packages update their offset uniforms), so packages
still mutate before the composite. Do not add or change any `PRIORITY_*` constant.

### 5. Export

Export `PostChain` from `src/index.ts` **only if** a test needs to import it directly;
otherwise keep it package-internal (preferred — it is not public API). Do not add it to
`SceneHostProps`.

## Frozen — changing any of these is a separate thaw, not this task

- `packages/core-types/src/quality.ts` — `QualitySettings`, `QUALITY_TIERS`, `bloomEnabled`
  values. (This task *consumes* `bloomEnabled`; it does not redefine tiers.)
- `@cosmos/scene-host` **public API**: `QualityController`, `useQuality`, `FrameContext`, all
  `PRIORITY_*` constants, `computeEffectivePixelRatio`, `detectInitialTier`. **`SceneHostProps`
  gains exactly one additive optional field — `postProcessing?: boolean` (default `true`)** — per
  the probe-conflict decision; every existing field is unchanged and no field is removed or
  retyped. That single additive prop is the whole sanctioned API surface change; adding anything
  else to `SceneHostProps` ⇒ `blocked`.
- The app's scene-content composition in `apps/web/src/app/StarApp.tsx` (children of
  `<SceneHost>`) — untouched.
- Frame-loop ordering and the `updateSharedFrameContext` contract.
- **The Canvas `gl` config** in `SceneHost.tsx` (`{ logarithmicDepthBuffer: true,
  antialias: false }`). Keep `antialias: false` — renderer MSAA must NOT be turned on to
  "fix pixelation"; antialiasing arrives as an SMAA/FXAA *effect* in TASK-105 (architecture
  §5.1: "Using MSAA + postprocessing together on WebGL2 (broken/expensive) — use FXAA/SMAA
  in the post chain"). The `QualityApplier` `setPixelRatio` path is likewise unchanged.

## Out of scope (do NOT do these here)

- **Any visible effect.** No bloom (TASK-106), no SMAA/FXAA antialiasing (TASK-105), no
  glow/densifier. The `<ToneMapping>` in §3 is identity-preservation, not a visible effect.
- **Quarter-res / resolution tuning.** That is a *bloom*-pass concern (TASK-106); the step-1
  composite renders the scene at the current render resolution (identity). Do not downsample
  the whole composite — that would blur the image and fail identity.
- **Selective-bloom object/light references**, `bloomEnabled`-vs-new-flag, emissive
  thresholds — all TASK-106.
- Touching render packages, streaming, or the app's scene graph.
- Standing rule: **findings during this task go to `docs/research/`** (root-cause or a short
  note); **scope creep goes to a new task file, not into this diff.**
- **Log every judgment call** — anything this task didn't decide and you had to — to
  `NOTES.md` beside the diff, visibly, as you go (not reconstructed after).

## Failure modes (mined from repo research + git history — these already bit this project)

- **Composer mount/unmount re-rendering the whole Canvas subtree** → remounts every render
  package (catastrophic: reloads star buffers, resets nav). Prevented by isolating the gate in
  the `PostChain` leaf so only it re-renders on tier change (§5.1 Canvas-isolation; the exact
  trap TASK-039 §"Common Mistakes" warns about). **Verify** with the sibling-re-render count
  assertion (Acceptance §1), the same pattern TASK-039's quality test uses.
- **Tone-mapping handoff silently changes the image** (§3). The image looking "washed out
  after enabling post" is the classic postprocessing-lib gotcha; identity is a step-1
  requirement, not a step-3 polish.
- **Deterministic e2e work-budget gates shift — MEASURED NOT A THREAT, but keep the discipline.**
  `docs/research/post-chain-probe-render-conflict.md` measured that the high-tier gates read
  `__cosmos.streaming.{drawCalls,renderedPoints}` (policy CPU counts, immune to a composite pass),
  and the one `gl.info.render` gate (`flythrough4`) runs at tier `low` (no composer). The
  `postProcessing={false}` opt-out on the six manual-render probe apps removes the double render
  entirely, so no gate should move. **If, contrary to this, a deterministic gate DOES move after
  your change, that is a STOP-and-triage (global rules 1+3): do NOT relax the threshold and do NOT
  pin a probe to `low` (that changes which high-tier cap `m3`/`m4a`/`soak3` test).** Re-open the
  research doc, confirm you wired `postProcessing={false}` on every app in its CLAIM-4 list, and
  report. See also `[[dont-gate-peak-of-per-frame-sample]]`.
- **`.env.local` pack contamination** (`[[flythrough4-envlocal-pack-contamination]]`): if you
  measure anything locally, the dev pack is the full Gaia set, not the CI 135-star sample —
  neutralize `apps/web/.env.local` before trusting any local measurement. Not central here
  (this task's gates are structural, not pack-sensitive), but do not repeat the trap.
- **WebGL context loss on target realloc.** Mounting the composer allocates a render target;
  rapid tier flapping could thrash allocations. PerformanceMonitor's hysteresis + debounced
  tier changes bound this — but confirm the existing `onContextLost` path is untouched and no
  target is leaked across mount/unmount cycles (Acceptance §1 leak check).
- **Version/peer war on install** (Step 0.5). Forcing an incompatible
  `@react-three/postprocessing` against R3F 9 is a latent runtime break; a clean peer resolve
  is a precondition, not a nice-to-have.

## Acceptance gate (deterministic — blocks CI; no screenshots, no wall-clock)

The task is DONE only when these pass in CI. All are structural/behavioral (the visual
identity + perf claims are reference-machine, in "Verification beyond the gate").

1. `pnpm --filter @cosmos/scene-host test` — new `test/post-chain.test.tsx`
   (`@react-three/test-renderer` + Vitest, tier driven via the existing `QualityController`
   test seam, as TASK-039's quality test does):
   - **Gate on flag:** with tier `high` (or `medium`) mounted, an `EffectComposer` node is
     present in the rendered tree; with tier `low`, **no** `EffectComposer` node is present.
   - **Tier transition:** driving `high → low` unmounts the composer; `low → high` remounts
     it; over N (≥ 50) mount/unmount cycles there is no accumulation (composer node count is
     0 or 1, never > 1; no retained-target leak — assert via a dispose/creation spy or node
     count, mirroring the Phase-0 "no leak across 100 mount cycles" check).
   - **Canvas isolation:** a tier change causes **zero** re-renders of a sibling stub mounted
     outside `PostChain` (render-count assertion — the exact TASK-039 pattern). Prove the
     scene content is not remounted on the gate flip.
   - **Frame ordering intact:** existing priority-ordering, dt-clamp, epoch-provider, and
     unmount-cleanup suites pass **unmodified**.
   - **Log the driving input + observed node presence** so a CI-only failure is triagable from
     logs alone (CLAUDE.md testing rule 6): e.g. `console.log('[post-chain] tier=%s
     composerPresent=%s', tier, present)`.
2. `pnpm --filter @cosmos/web build` succeeds (the new dep resolves and the app bundles the
   composer).
3. `pnpm verify` exits 0 — lint (dependency-boundary lint still green: scene-host is glue,
   may depend on `@react-three/postprocessing`), typecheck, unit, build.
4. `pnpm test:e2e` (chromium deterministic gate) exits 0 with **no threshold relaxed**. If a
   work-budget gate moves, resolve per the "e2e work-budget" failure mode (STOP-and-triage),
   never by editing the threshold.

## Verification beyond the gate (reference machine — record in the PR, does NOT block CI)

- **Identity A/B.** With `pnpm dev`, capture the main view at tier `high` before this change
  and after; they must be visually identical (no gamma/tone shift). If they differ, §3 is
  unmet — fix before merge. Do this at ≥ 2 vantages (near-Sol star field + the far Milky-Way
  band view) since tone-mapping shifts show differently across brightness ranges.
- **Composer actually engages.** Confirm in `pnpm dev` (not a probe app) that at `high` the
  composer is rendering (e.g. it appears in the R3F/postprocessing devtools, or a temporary
  log), and that forcing tier `low` via `window.__cosmosDev.setTier('low')` removes it and the
  image still renders through R3F's default path.
- **No perf regression at the floor.** Note (reference-machine only, not a gate): an
  identity composite adds one full-screen copy; confirm it is not a visible cost at `medium`
  on the integrated-GPU target. Real bloom-cost budgeting (<2.5 ms, §5.11) is TASK-106.

## Deliverables

- `packages/scene-host/src/PostChain.tsx` (new — the tier-gated identity composer, `enabled` prop)
- `packages/scene-host/src/SceneHost.tsx` (add additive `postProcessing?: boolean` to
  `SceneHostProps` [default `true`], thread to `QualityRoot`, mount `<PostChain enabled={...}/>`)
- `packages/scene-host/src/index.ts` (export `PostChain` only if a test imports it)
- `packages/scene-host/package.json` (add `@react-three/postprocessing` [+ `postprocessing`])
- `packages/scene-host/test/post-chain.test.tsx` (new)
- `packages/scene-host/test/setup-postprocessing.ts` (new — package-wide composer stub; see spec-fact
  correction) + `packages/scene-host/vitest.config.ts` (`setupFiles` entry)
- `packages/scene-host/README.md` (short "post chain (foundation)" section; keep < 150 lines)
- `apps/web/src/app/{CtxSwitchApp,ErrorGateApp,M3App,M4aApp,Soak4ProbeApp,StreamingProbeApp}.tsx`
  — pass `postProcessing={false}` to `<SceneHost>` (the manual-render probe apps; probe-conflict
  decision). `StarApp` and `Flythrough4ProbeApp` are NOT touched. This is the only `apps/web`
  source change; plus the `apps/web` lockfile delta.
- `NOTES.md` beside the diff (judgment calls + resolved dep versions + observed tone-mapping enum
  + the composer's effective `useFrame` renderPriority once installed — the Step-0-item-3 recheck)

## Context Files

- `docs/architecture.md` §5.1 (scene-host owns the postprocessing chain; Canvas isolation;
  MSAA-vs-post "Common mistakes"), §5.11 (render-fx bloom is selective/quarter-res/<2.5ms —
  the *next* steps this foundation enables), §9 (degradation order: point → **bloom** →
  atmosphere → resolution)
- `docs/research/screenspace-density-bloom-implementation.md` (ENABLE verdict + owner-corrected
  recommendation: use the `postprocessing` lib; Step-0 claims already gathered)
- `docs/research/milky-way-glow-render-technique.md` (REFRAME: the band is unresolved-faint
  light — motivates bloom in step 3; note the tone-mapping belief in §3 above)
- `docs/research/integrated-gpu-targeting.md:30-41` (adaptive infra that already exists — do
  NOT rebuild; `bloomEnabled` "flag-only, no post chain wired")
- `packages/core-types/src/quality.ts` (`QUALITY_TIERS`, `bloomEnabled` per tier)
- `packages/scene-host/src/SceneHost.tsx` (`QualityRoot`/`FrameLoopRoot` mount points),
  `src/use-quality.ts` (`useQuality`), `src/quality.ts` (`QualityController` test seam)
- `docs/agent-tasks/TASK-039-quality-tiers.md` (the Canvas-isolation + tier-transition test
  patterns to copy for the acceptance suite)
