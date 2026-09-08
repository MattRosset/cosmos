# TASK-102: Wire the Natural/Survey visibility mode (state + UI + consumers)

**Initiative:** visibility-aware galaxy streaming (VIS-05 — the mode-state task every Stage-0
seam was written against)
**Size:** M
**Class:** mechanical wiring — the product judgment is fully resolved in ADR-007; nothing here is
a design decision except the placement of one toggle (pre-resolved below).
**Depends on:** TASK-096 (ADR-007, the frozen contract) and TASK-097 (`@cosmos/photometry`, the
profiles). Both `done` on this branch. TASK-100 (`done`) already left the pick seam. Independent
of TASK-098/099/101 — do not wait for or touch the streaming candidates.

## Goal

Two star-visibility modes exist on paper (ADR-007) and in the photometry package
(`NATURAL_VISIBILITY_PROFILE`, `SURVEY_VISIBILITY_PROFILE`), but nothing lets a user reach
Survey: every consumer hard-selects `NATURAL_VISIBILITY_PROFILE`. Add the mode to app state, a
toggle to reach it, and change the **three already-annotated seams** so render, pick, and tile
cull all read the current mode's profile. When mode flips to `survey`, the galaxy-octree effective
exposure rises 150 → 1000 at the default slider, the faint Gaia tail crosses the same `0.004`
floor, and — because render, pick and cull share one predicate — the newly-lit stars become
drawn, claimable, and un-culled together.

Survey is **exposure-only** (ADR-007 §3): it changes one multiplier and nothing else. No FOV
change, no reticle, no vignette, no magnification, no persistence, and the word "Telescope" never
appears.

## Why now — the seams are already cut

Every Stage-0 task left this task an explicit landing site, by name:

- `apps/web/src/scene/GalaxyScene.tsx:109-114` — "There is no mode setting yet, so Natural is
  hard-selected here … when mode state lands …" (TASK-097).
- `apps/web/src/scene/StarScene.tsx:316-320` — "Natural is hard-selected until VIS-05; when mode
  state lands, this one call switches profile and the pick follows automatically" (TASK-100).
- `apps/web/src/glue/octree-pick.test.ts:58-62` — already computes `SURVEY = effectiveStarExposure(
  SURVEY_VISIBILITY_PROFILE, 'galaxy-octree', 25)` and asserts the pure pick is exposure-sensitive.

The pure math, the frozen numbers, and the exposure-sensitivity of the pick are already tested.
This task connects a store to those seams; it introduces **no new formula**.

## Step 0 — verify the spec's facts

Re-confirm before editing. If any is false, STOP and update this spec — do not improvise around it.

1. `packages/app-state/src/settings.ts` still exports `useSettingsStore` with `exposure` +
   `setExposure` and the `EXPOSURE_*` constants, and has **no** `mode` field yet.
2. `@cosmos/photometry` still exports `StarVisibilityMode`, `VISIBILITY_PROFILES`
   (`{ natural, survey }`), `NATURAL_VISIBILITY_PROFILE`, `SURVEY_VISIBILITY_PROFILE`, and
   `effectiveStarExposure(profile, layer, slider)`, with `galaxy-octree` multipliers 6 and 40.
3. `apps/web/src/scene/GalaxyScene.tsx` still defines the module-level
   `galaxyFieldExposure(sliderExposure) => effectiveStarExposure(NATURAL_VISIBILITY_PROFILE,
   'galaxy-octree', sliderExposure)`, calls it at the three sites (`makeOctreeMount` line ~237,
   the mount's `setExposure` line ~254, and the tile cull line ~692), and drives mounts from the
   `useSettingsStore.subscribe((s) => apply(s.exposure))` effect at lines ~520-528.
4. `apps/web/src/scene/StarScene.tsx` selects the pick profile with
   `effectiveStarExposure(NATURAL_VISIBILITY_PROFILE, 'galaxy-octree',
   useSettingsStore.getState().exposure)` read at click time (line ~321).
5. `apps/web/src/glue/tile-brightness-cull.ts` `tileBelowVisibilityFloor` takes `exposureEff` as a
   **parameter** (it does not read the store), so it follows GalaxyScene's computed value with no
   edit of its own.
6. `packages/ui/src/ViewDrawer.tsx` renders `<ExposureControl />` plus a `cosmos-ui-view-toggles`
   group of `aria-pressed` buttons reading `useOverlayStore` directly; `packages/ui/src/strings.ts`
   holds `STRINGS`; `packages/ui` may import `@cosmos/app-state` (it already does) and lint bans
   only `three` + deep imports.
7. `apps/web/src/glue/test-hook.ts` mirrors `useSettingsStore.getState().exposure` into
   `testHook.exposure` in `mirrorOverlayState` (line ~355).
8. `eslint.config.js` for `packages/app-state/**` bans only `three` and deep `@cosmos/*/src/*`
   imports — so `app-state` importing the **type** `StarVisibilityMode` from `@cosmos/photometry`
   is allowed.

## Context — read first

- `docs/decisions/ADR-007-star-visibility-modes.md` — the whole contract. §2 Natural, §3 Survey
  (exposure-only, copy rules), §4 one floor, §5 the three-terms distinction, §8 frozen numbers,
  §9 the accepted trade. **This ADR wins over this task file on any conflict.**
- `docs/research/galaxy-octree-streaming-value-near-sol.md` — Claim 5 (7.90% perceptible near Sol)
  is why Survey has something to reveal.
- `packages/photometry/src/index.ts` — the profiles and `effectiveStarExposure`; read the header.
- `apps/web/src/scene/GalaxyScene.tsx`, `apps/web/src/scene/StarScene.tsx` — the two production
  wiring sites.
- `packages/ui/src/ViewDrawer.tsx` — the toggle's home (mirror the existing `aria-pressed`
  buttons).
- `docs/agent-tasks/TASK-100-pick-perceptibility-gate.md` — the sibling that cut the pick seam;
  same house format and the same StarScene site.

## Frozen — do not touch

- **The ADR-007 §8 numbers:** floor `0.004`, galaxy-octree multipliers `6` (Natural) and `40`
  (Survey), slider range `[0.1, 200]`, default `25`, FOV `60°`. They live in
  `@cosmos/photometry` and `settings.ts`; import them, never redeclare or retune them. Changing
  any is an ADR-007 amendment, not a task-local edit.
- **Exposure-only (§3).** Do not add or touch camera FOV, a reticle, a vignette, magnification, or
  any optical control. Survey raises one multiplier; that is the entire behavioral change.
- **Naked-eye visibility (§5).** The star-card "needs a telescope from Sol" text
  (`packages/ui/src/astro-derive.ts`, `InfoPanel.tsx`) is catalog truth and must not change when
  the display mode changes. Do not touch that path.
- **Never "Telescope."** UI copy is "Survey" (§3). No optical claim in any string.
- **No persistence.** Natural is the default on every boot (§1); do not add localStorage/bookmark
  persistence for the mode — that is a separate future decision (ADR-007 "Alternatives rejected").
- **HYG/exoplanet/system exposure, procgen `CLOUD_EXPOSURE_BOOST`, streaming, culling geometry,
  the pick's angular rule and `gaiaHitWins` arbitration** — all unchanged. Only the galaxy-octree
  layer's multiplier is mode-dependent.

## Out of scope

- Streaming selection, prefetch, frustum margins, magnitude bands, pack-format changes (VIS-07+).
- Making Survey cheaper, or reacting to Survey's smaller photometric reductions (ADR-007 §9 — a
  downstream concern, not this task).
- A separate visibility badge in the HUD. `ModeBadge`/`ModeBadgeHost` is the **movement**-mode
  badge (Exploring / Scale jump); do not repurpose it. The toggle's own `aria-pressed` is the
  affordance's state.
- Diagnostics snapshots (TASK-098), the co-timed working set, or any new `streaming` surface.

Findings during this task go to `docs/research/` (create it if missing — it exists); scope creep
goes to a new task file, not into this diff.

## Deliverables / steps

**Log every judgment call — anything this task didn't decide and you had to — to
`docs/agent-tasks/TASK-102-NOTES.md` beside the diff, visibly, as you go (not reconstructed
after).**

Create/modify **only** the files listed here plus their test files.

### 1. `packages/app-state/src/settings.ts` — add the mode to the settings store

- Import the type only: `import type { StarVisibilityMode } from '@cosmos/photometry';`.
- Extend `SettingsState` with `readonly mode: StarVisibilityMode;` and
  `setMode(mode: StarVisibilityMode): void;`.
- Default `mode: 'natural'` (ADR-007 §1). `setMode` sets the mode verbatim (the type already
  constrains it to `'natural' | 'survey'`; no clamping needed, unlike exposure).
- This is the **sanctioned additive `app-state` surface bump for VIS-05** (app-state froze at the
  Phase-4a gate; this task file is the thaw approval for exactly this field + setter, ADR-007).
  Add nothing else to the store.
- `@cosmos/photometry` must be a declared dependency of `@cosmos/app-state` in its `package.json`
  if it is not already (a type-only import still needs the workspace dep for typecheck/build).
  Report in NOTES whether you had to add it.

### 2. `apps/web/src/scene/GalaxyScene.tsx` — render + tile cull follow the store mode

- Change the import from `NATURAL_VISIBILITY_PROFILE` to `VISIBILITY_PROFILES` (keep
  `effectiveStarExposure`).
- Change `galaxyFieldExposure` to read the current mode at call time:
  ```ts
  const galaxyFieldExposure = (sliderExposure: number): number =>
    effectiveStarExposure(
      VISIBILITY_PROFILES[useSettingsStore.getState().mode],
      'galaxy-octree',
      sliderExposure,
    );
  ```
- Replace the "Natural is hard-selected here" comment (lines ~109-114) with a one-line note that
  the multiplier now follows `useSettingsStore.mode` per ADR-007, and **why the existing
  subscription already handles mode flips**: the line ~527 `useSettingsStore.subscribe((s) =>
  apply(s.exposure))` fires on **every** store change (vanilla, non-selector subscribe), so a
  `setMode` re-runs `apply`, and `apply` re-pushes `galaxyFieldExposure(exposure.current)` — now
  mode-aware — to every mount via `m.setExposure`. Do **not** refactor that subscription into a
  selector-scoped one (`subscribe(s => s.exposure, …)`) — that would stop firing on mode changes
  and silently half-wire the render. State this trap in the comment.
- The tile cull (line ~692, `galaxyFieldExposure(exposure.current)`) and both mount sites (~237,
  ~254) now follow automatically. Do not change `tile-brightness-cull.ts`.
- **Publish the applied effective exposure for the gate.** Add a module-scoped holder
  `octreeFieldExposureHolder: { current: number }` (mirror the existing `*Holder` pattern in
  `apps/web/src/glue/test-hook.ts`; export it from there alongside the other holders). Inside
  `apply` (line ~522), after the `for (const m …) m.setExposure(e)` loop, set
  `octreeFieldExposureHolder.current = galaxyFieldExposure(e)`. Because `apply` re-runs on mode
  flip, this holder is a faithful proxy for what the mounts were just re-pushed — 150 at Natural,
  1000 at Survey, at slider 25.

### 3. `apps/web/src/scene/StarScene.tsx` — pick follows the store mode

- Change the profile selection at the pick site (line ~321) from `NATURAL_VISIBILITY_PROFILE` to
  `VISIBILITY_PROFILES[useSettingsStore.getState().mode]`, read at click time in the same
  `getState()` call region as the slider exposure. Update the import accordingly.
- Replace the "Natural is hard-selected until VIS-05" comment with a note that the pick now reads
  the live mode, so it stays consistent with what `GalaxyScene` drew this frame.
- Nothing else in the pick behaviour changes; `pickNearestGaia` already takes the effective
  exposure and is already exposure-sensitivity-tested (TASK-100).
- **Register the gate's candidate-enumeration hook here**, in the same StarScene scope that already
  closes over `octreeCombined` and `octreePickHolder` and defines `pickAt`. Add
  `__cosmos.octreeGaiaPickCandidates()` returning `readonly { id: string; absMag: number;
  positionPc: [number, number, number] }[]`, built by the SAME construction the pick uses so it can
  only surface stars `pickAt` can actually claim:
  - Iterate `octreePickHolder.current` mounts; for each, get `octreeCombined.prefixRangesFor(m.chunkId)`
    (the ranges live only here — `octreePickHolder` deliberately does not carry them).
  - Emit one entry per point **inside a range whose `idPrefix === 'gaia'`** (mirror
    `pickNearestGaia`'s scope in `octree-pick.ts` — a hyg-v41 index in a mixed tile is never a
    candidate). `id` is `` `gaia:${catalogId}` `` for that index, matching what `pickAt` returns
    (`StarScene.tsx` `gaia:${gaiaHit.catalogId}`).
  - `positionPc` is the **Sol-relative galaxy-pc** position — tile-local `batch.positionsPc[i]`
    plus `batch.originPc` (the rebasing `octree-pick.ts` already does), so it feeds
    `__cosmos.projectToScreen` directly. Do NOT emit raw tile-local coordinates.
  - Returns `[]` (never throws) when the octree source or holder is absent (debug apps). This is a
    read-only query of live scene state (CLAUDE.md testing rule 1); it adds no production behaviour.

### 4. UI — the Survey toggle

- `packages/ui/src/strings.ts`: add `viewSurvey: 'Survey'` (ADR-007 §3 copy; **never**
  "Telescope"). Keep the `STRINGS` shape/order convention of the file.
- `packages/ui/src/ViewDrawer.tsx`: add one `aria-pressed` button to the existing
  `cosmos-ui-view-toggles` group, mirroring the constellations/labels/cinematic buttons exactly:
  ```tsx
  const mode = useSettingsStore((s) => s.mode);
  const setMode = useSettingsStore((s) => s.setMode);
  // …
  <button
    aria-pressed={mode === 'survey'}
    onClick={() => setMode(mode === 'survey' ? 'natural' : 'survey')}
  >
    {STRINGS.viewSurvey}
  </button>
  ```
  Import `useSettingsStore` from `@cosmos/app-state` (add it to the existing app-state import).
  Place the button first in the toggle group, adjacent to `<ExposureControl />` (Survey is an
  exposure concept). Store-driven only — zero per-frame work, matching the drawer's contract.

### 5. `apps/web/src/glue/test-hook.ts` — expose mode + applied octree exposure

- Add `mode: StarVisibilityMode` to the `TestHook` interface (default `'natural'`) and mirror it
  in `mirrorOverlayState` next to `exposure`: `testHook.mode = useSettingsStore.getState().mode;`.
- Add `octreeFieldExposure: number` to the interface as a **live getter** off
  `octreeFieldExposureHolder` (step 2) — mirror the existing live-getter pattern (`failedChunks`
  reads its holder synchronously), NOT the ≤4 Hz `exposure` mirror, so it is never stale during the
  gate's settle. Default `0` before the scene mounts.
- The `octreeGaiaPickCandidates()` hook is registered from StarScene (step 3), not here — but if
  the `TestHook` interface is where `__cosmos` method signatures are declared in this file, add its
  type there alongside `pickAt`.
- These are read-only test hooks (query real state — CLAUDE.md testing rule 1); they add no
  production behavior.

## Failure modes to watch

Mined from `git log` on these paths and the VIS/ADR history — the traps that already bit here:

1. **Pack contamination poisons any count-based gate.** `apps/web/.env.local` may point Vite at
   the full ~4.7M Gaia pack while CI/prod serve the 135-star sample, so near-Sol perceptible/drawn
   counts differ by orders of magnitude between machines
   (`memory: flythrough4-envlocal-pack-contamination`;
   `docs/research/galaxy-octree-streaming-value-near-sol.md`). **The blocking gate must assert
   pack-agnostic invariants** (a fixed effective-exposure value; a monotone relation on whatever
   batches are present; a runtime-selected target), never a hardcoded star count. Detection: the
   e2e gate reads no absolute point count as a pass condition.
2. **Selector-scoped subscription half-wires the render.** If step 2's edit "tidies"
   `subscribe((s) => apply(s.exposure))` into `subscribe(s => s.exposure, apply)`, mode flips stop
   re-pushing to mounts — the pick would change (StarScene reads the store on click) while the
   drawn field would not. The `octreeFieldExposure` holder catches this: it would stay 150 after a
   `setMode('survey')`. Detection: the e2e assertion that the holder reaches 1000.
3. **StarScene left hard-selected.** The two wiring edits (steps 2 and 3) are independent; an
   executor can do the render and forget the pick, or vice-versa. The pick power test (gate below)
   fails if StarScene still hardcodes Natural; the holder assertion fails if GalaxyScene does.
   Both must be present — do not collapse them into one assertion.
4. **A pick-only or render-only floor.** The floor is shared so a claimable star is a drawn star
   (ADR-007 §4). Never introduce a second floor to make Survey "look right." Detection: `0.004`
   imported from `@cosmos/photometry` at every site; `git diff` adds no numeric floor.
5. **Preview/rAF throttle fakes a frozen scene when measuring live.** The preview tab throttles
   rAF when idle, and headless chromium's d3d11 backend stalls ~4.5 s post-interaction
   (`memory: preview-tab-idle-hidden`). When driving the live scene in e2e/manual checks, click to
   wake and pump rAF inside the eval before reading `octreeFieldExposure` or `pickAt`, and settle
   `pendingCount === inFlight === 0` before measuring. Detection: the gate waits on a settle
   condition, not a fixed sleep.
6. **Touching naked-eye card text.** Changing what the card says about telescope-need is a §5
   violation (mode ≠ catalog truth). Detection: `git diff` touches no `astro-derive.ts` /
   `InfoPanel.tsx`.
7. **Scope leak into streaming/pack.** Any edit under `packages/streaming/**`,
   `tools/pack-*/**`, or the octree manifest is out of scope (VIS-07+). Detection: `git diff`
   confined to the deliverable files.

## Acceptance gate

Deterministic proxies only. All blocking:

1. **`packages/app-state` unit test** (new, in `packages/app-state/test/`): the store defaults to
   `mode: 'natural'`; `setMode('survey')` then `setMode('natural')` round-trips; the field's type
   is the `@cosmos/photometry` `StarVisibilityMode`. `pnpm --filter @cosmos/app-state test`
   exits 0.
2. **`packages/ui` unit test** (extend `ViewDrawer.test.tsx`): the Survey button renders with
   `aria-pressed=false` at default, and clicking it calls `setMode('survey')` (assert against the
   real `useSettingsStore`, then reset). No snapshot of pixel geometry.
3. **e2e power gate** `e2e/tests/visibility-mode.spec.ts` (chromium; runs on the CI sample pack).

   **App and flip mechanism are fixed — do not choose.** Drive the **real explorer app**
   (`StarApp`, the default route with no `?debug=` flag): it is the ONLY app that mounts the HUD →
   `ViewDrawer` → Survey button (`M4aApp`/`?debug=m4a` renders no HUD, so it has no way to reach
   Survey). Flip the mode by **clicking the UI**, never by touching a store: open the View drawer
   (`getByRole('button', { name: STRINGS.viewDrawerTitle })`) then click
   `getByRole('button', { name: 'Survey' })`. This keeps the store off `window` and the test-hook
   read-only — no new production handle is added, so the step-5 diff stays confined. Reach
   settled Sol the way the existing near-Sol specs do (`flythrough4`/TASK-100's live verification
   are the precedent harness): boot at the Sol start, click the canvas to wake rAF
   (`memory: preview-tab-idle-hidden`), pump rAF, and wait for
   `__cosmos.streaming.pendingCount === 0 && inFlight === 0` before every measurement.

   - **Render wiring (pack-independent):** with the drawer at default, assert
     `__cosmos.octreeFieldExposure === 150` (Natural, slider 25); click Survey; re-settle/pump;
     assert `=== 1000`. These are exact integer products (`25×6`, `25×40`) — assert exact equality,
     no epsilon. Click Survey again to return to Natural and assert `=== 150` (the toggle is
     reversible).
   - **Pick wiring (runtime-selected target, pack-agnostic):** in Natural, read
     `__cosmos.octreeGaiaPickCandidates()` (step 3 hook) and import `@cosmos/photometry` in the spec
     (pure, importable) to **classify** them — find one candidate whose `starIsPerceptible` is
     **false at Natural exposure (150) and true at Survey (1000)** for its actual camera-relative
     distance (compute distance from its `positionPc` and the live camera via
     `__cosmos.projectToScreen`/`contextUnitMeters`, not a hardcoded ratio). The production oracle
     picks the target; the test never re-derives the formula. Project it with
     `__cosmos.projectToScreen`; assert `__cosmos.pickAt(px,py)` does **not** return that `id` (it is
     imperceptible — TASK-100 gates it out). Click Survey; re-settle/pump; assert `pickAt(px,py)`
     now returns exactly that `id`. Log the chosen id and its Natural/Survey brightness. If no such
     candidate exists in the loaded scene, **fail with that logged reason** — never pass vacuously.
     **Sanity number (measured 2026-08-06):** on the committed 135-star sample
     (`octree-gaia-sample`, `source: gaia-dr3-bright`, one root tile) at a Sol-origin camera, the
     shipped photometry formula yields **16 survey-only candidates** (sub-floor@150,
     perceptible@1000; e.g. absMag 5.79 @24.5 pc, bri 6.9e-4→4.6e-3), and the root tile is drawn in
     both modes (its `minAbsMag` −3.25 keeps it above the tile cull). So on-screen candidates exist
     on the CI pack — a runtime count of 0 means the wiring or the hook is wrong, not the pack;
     investigate, do not relax. The e2e must filter candidates to those actually on-screen (inside
     the viewport after `projectToScreen`) and in a drawn tile before asserting.
   - **Mutation note (record in NOTES):** reverting step 3's StarScene profile edit to hardcoded
     `NATURAL_VISIBILITY_PROFILE` must leave the Survey pick assertion RED; reverting step 2's
     `galaxyFieldExposure` mode read must leave the `octreeFieldExposure === 1000` assertion RED.
     Run each revert once and record that the gate went red.
4. **`pnpm verify` exits 0** (lint + typecheck + unit + build), and **`pnpm test:e2e`** run once
   with the new spec green on chromium. Only the documented pre-existing `flythrough4` near-Sol cap
   failure may remain known-red (`memory: gaia-4m7-pack-roadmap` — expected-red locally on the
   4.7M pack; confirm it is that exact case and nothing new).
5. `git diff` confined to: `packages/app-state/src/settings.ts` (+ its `package.json` for the new
   `@cosmos/photometry` dep, + a new `packages/app-state/test/settings.test.ts`),
   `packages/photometry` untouched, `packages/ui/src/{ViewDrawer.tsx,strings.ts}` (+ the existing
   test at `packages/ui/test/ViewDrawer.test.tsx`), `apps/web/src/scene/{GalaxyScene.tsx,StarScene.tsx}`,
   `apps/web/src/glue/test-hook.ts`, `e2e/tests/visibility-mode.spec.ts`, and the NOTES file.
   **No `ci.yml` edit is needed** — the blocking e2e gate runs `playwright test --grep-invert @perf`
   (`.github/workflows/ci.yml`), which globs all non-`@perf` specs; the spec-name list there is a
   comment, not a functional registration. Confirm this holds and note it in NOTES.

## Verification beyond the gate

On the full local pack (`VITE_GAIA_OCTREE_MANIFEST_URL=/packs/octree-gaia/octree.json`) at settled
Sol, open the View drawer and toggle Survey on: the faint Gaia field must visibly deepen (more
stars, the tail lifting over the floor) with no change to the HYG monolith, no FOV/reticle/vignette
appearing, and no letterbox. Toggle back to Natural and confirm the field returns to today's look.
Open a star card in each mode and confirm the naked-eye/telescope line is identical (§5). Record
both as reference evidence in NOTES (screenshots are reference-only, never a blocking check).
