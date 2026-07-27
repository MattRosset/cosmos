# TASK-086 — Local-group galaxy field: render + select the 11 non-Milky-Way galaxies (N2)

**Thread:** universe-scale tour, step (2) of the reframed shape
(`docs/research/universe-scale-tour-preflight.md` §6: *(1) unblock ascent → (2) render +
make selectable the galaxy-point field → (3) compose the tour*). N1 (ascent) shipped as
TASK-080; N5 (M1 calibration) closed 2026-07-27. This is N2 — the deliverable, not a blocker.

**Size:** M. **Classification:** mechanical — every design decision below was pre-resolved
from code inspection on 2026-07-27 (see Decisions). The executor wires known primitives; it
invents nothing.

---

## Goal

In `universe` context, render the 11 procedural local-group galaxies that
`generateLocalGroup` produces besides the Milky Way, as camera-facing impostor sprites at
their real `positionMpc`, and make them **click-selectable**: a click returns the galaxy's
`BodyId`, and selecting it shows a deterministic generated name in the breadcrumb (e.g.
`Galaxy G-3`) — never the raw `proc:localgroup:3` id.

Today: `makeLocalGroup()` generates 12 records but `StarApp.tsx:211` destructures only
`milkyWay`; the other 11 are discarded. Arriving at `universe` (reachable since TASK-080)
shows an almost-empty void with a single impostor. This task fills it.

**Scope of "selectable" (user decision, 2026-07-27):** generated name + breadcrumb only.
**No** info card, **no** double-click fly-to, **no** entering a galaxy. Those are N2b / out
of scope (see below).

---

## Step 0 — facts to re-verify before writing code (the spec was written 2026-07-27; code moves)

Run these; if any contradicts the spec, **STOP and update this spec** (CLAUDE.md rule 1) — do
not improvise around it.

1. **Units.** `packages/core-types/src/coords.ts:13-14` — `CONTEXT_UNIT_METERS.universe` is
   `3.0857e22` (1 Mpc), `.galaxy` is `3.0857e16` (1 pc). ⇒ a `universe`-context
   `UniversePosition.local` is in **Mpc**, so `GalaxyRecord.positionMpc` is *directly* its
   `local`. `pcScales('universe')` (`apps/web/src/glue/context-scale.ts:30-34`) therefore gives
   `unitsToPc = 1e6`, `pcToUnits = 1e-6`. RECHECK: read the two source lines
   (`coords.ts:13-14`) and confirm the ratio is `1e6` — do not rely on a `dist/` build.
2. **Render indices 1..N-1 only; skip index 0.** Read `makeLocalGroup`
   (`apps/web/src/glue/local-group.ts:28-39`) precisely: it does **not** relocate any element
   of `galaxies`. It reads `g0 = galaxies[0]` and builds a *separate* origin-pinned record
   `milkyWay` (`id: proc:milkyway`, `positionMpc: [0,0,0]`) that copies only `g0.seed`/
   `radiusKpc`. `galaxies[0]` itself keeps `id proc:localgroup:0` at its **random**
   `positionMpc` (nonzero — every index is placed uniformly in the sphere,
   `generateLocalGroup:32-38`) and is NOT in the origin Milky Way. So `galaxies[0]` is a
   vestigial slot whose seed was donated to the origin `proc:milkyway` (which `GalaxyScene`
   already draws); rendering it would show a spurious seed-duplicate galaxy at a discarded
   random position, labelled `Galaxy G-0`. ⇒ render `galaxies.slice(1)` only.
   RECHECK: `galaxies[0].positionMpc` is **not** `[0,0,0]` — do not read that as a
   contradiction of "index 0 is the Milky Way"; it is the point of this note.
3. **The impostor primitive.** `createGalaxyImpostor({ spriteTexture, radiusPc })` in
   `packages/render-galaxy/src/impostor.ts` — `setRenderOffset(offsetPc)` (PARSECS),
   `setContextScale(pcToUnits)`, `setRadiusPc(pc)`, `setOpacity`, `setVisible`, `dispose`.
   The shared texture is `createImpostorTexture()` from `apps/web/src/glue/galaxy-assets`.
4. **The coordinate/scale pattern to mirror** is `GalaxyScene.tsx`'s per-frame loop (lines
   ~476-611, which handles universe+galaxy jointly via `streamingActive`): at ~584-589
   `origin.toRenderSpace(posScratch, off)` (returns active-context units) → `off *= unitsToPc`,
   and the mount's `applyFrame` then calls the renderer's `setContextScale(pcToUnits)` +
   `setRenderOffset(off)`. Your `LocalGroupScene` calls the impostor's `setContextScale` /
   `setRenderOffset` directly (no mount indirection), but the math is identical. The
   offset-in-parsecs / scale-in-context-units split is the TASK-081 contract — copy it exactly.
5. **The pick hook surface.** `StarScene.tsx:210` `pickAt` (planets raycast → `pickNearestStar`)
   and `:249` `projectToScreen` are registered on `pickProbeHolder` (`glue/test-hook.ts:181`).
   Confirm `projectToScreen` (lines 249-276) uses only `controller.state.position.local` +
   orientation (context-agnostic) — so it projects a `universe`-frame Mpc position correctly
   while the camera is in `universe`. It does today.
6. **The name-resolution site.** `Breadcrumb.tsx:34`:
   `combined.getBody(selectedId)?.name ?? selectedId`. Galaxies are not in `combined`
   (`CombinedSource` is the star catalog), so this shows the raw id today.
7. **The module-holder precedent** for handing scene geometry to `StarScene`'s pick is
   `glue/system-feed.ts` `systemPickGroup` (a `{ current: … | null }` set on mount, cleared on
   unmount, read inside `pickAt`). Mirror it for the galaxy field.
8. **Next task number is 086** (`ls docs/agent-tasks | grep -oE 'TASK-[0-9]+' | sort -u | tail`
   → 085 is the max). If 086 now exists, pick the next free number and rename this file.

---

## Context files (read these, don't re-derive the architecture)

- `apps/web/src/glue/local-group.ts` — `makeLocalGroup()`; where the 11 records are dropped.
- `apps/web/src/scene/GalaxyScene.tsx` — the coordinate/scale/zero-alloc frame pattern to copy
  (the universe branch, ~lines 559-611). **Do not edit this file** (see Frozen).
- `apps/web/src/scene/StarScene.tsx` — `pickAt` precedence + `projectToScreen`; where the
  galaxy pick branch is added.
- `apps/web/src/glue/system-feed.ts` — the `systemPickGroup` holder pattern to mirror.
- `apps/web/src/glue/context-scale.ts` — `pcScales`; the unit bridge.
- `apps/web/src/scene/GalaxyScene.tsx:325-337` — `impostorRadiusOverride` — the exact dev/e2e
  ablation-override pattern to copy for the visibility gate (see Deliverable 5).
- `packages/render-galaxy/src/impostor.ts` — the impostor API.
- `apps/web/src/hud/Breadcrumb.tsx` — the one-line name fallback edit.
- `apps/web/src/app/dev-surface.ts` — the `__cosmosDev` **type** augmentation; the new setter's
  method signature goes here or the typecheck gate fails (Deliverable 7).
- `docs/research/galaxy-impostor-scale-is-inert.md` — **read this before writing the gate.**
  The prior impostor "test" asserted `mesh.scale` and passed for a sprite that never drew a
  pixel. Your visibility gate must measure the **frame**, not object existence/scale.

---

## Decisions (pre-resolved — do not re-open; implement as written)

- **D1 — primitive: 11 impostor sprites**, one `createGalaxyImpostor` per record (indices
  1..N-1), sharing the one `createImpostorTexture()`. Precedent: the Milky Way already renders
  as an impostor at far LOD; 11 additive sprites at universe scale is negligible cost. NOT a
  points batch — the impostor already reads as a galaxy and carries a per-galaxy radius.
  `radiusPc = record.radiusKpc * 1000`.
- **D2 — a new sibling component `LocalGroupScene`** (`apps/web/src/scene/LocalGroupScene.tsx`),
  mounted in `StarApp.tsx` alongside `GalaxyScene` under the same `<ErrorBoundary>`. NOT folded
  into `GalaxyScene`: that component is driven by the streaming chunk lifecycle
  (`streaming.onChunk`), the wrong lifecycle for a static 11-element in-memory array. Props:
  `{ galaxies: readonly GalaxyRecord[]; origin: OriginManager; controllerRef }`. Build the 11
  impostors once in `useMemo`; drive them from one `useFrameContext(..., PRIORITY_RENDER)`
  callback with **zero per-frame allocation** (module-scoped scratch, mirror GalaxyScene §9).
- **D3 — visibility gated on `contextId === 'universe'`.** Outside universe, `setVisible(false)`
  every sprite and return early. Rationale: outside universe the sprites would receive a parsec
  offset projected as if it were context units (the exact TASK-081 wrongness left out of scope
  for lanes/hii) — so they must be *hidden*, not merely mis-scaled. Read context from
  `controllerRef.current?.contextId ?? origin.context` (same as GalaxyScene:479).
- **D4 — pick via a mirrored holder.** Add `localGroupPickHolder: { current: readonly
  GalaxyRecord[] | null }` in a new `apps/web/src/glue/local-group-feed.ts` (mirror
  `system-feed.ts`). `LocalGroupScene` sets it to the rendered galaxies on mount, `null` on
  unmount. In `StarScene.pickAt`, **before** the planet/star pick, add: if
  `controller.contextId === 'universe'` and the holder is non-null, return
  `pickNearestGalaxy(holder, controller.state.position.local, dir)` (compute `dir` exactly as
  the star branch does, lines 230-237) — the galaxy pick fully owns universe-context clicks
  (stars/planets are not present there). `pickNearestGalaxy` is a **pure** function (angular
  nearest within a threshold, same shape as `pickNearestStar`; positions and camera both in
  Mpc so the angle is unit-consistent). Put it in `packages/nav/src/local-group.ts` (pure,
  node-testable) or a pure glue module — NOT inline in StarScene.
- **D5 — name via a pure resolver.** Add `localGroupGalaxyName(id: BodyId): string | null` (pure)
  next to `generateLocalGroup`: `proc:milkyway` → `"Milky Way"`; `proc:localgroup:<n>` →
  `` `Galaxy G-${n}` `` (deterministic from the index already in the id); anything else →
  `null`. In `Breadcrumb.tsx:34` change the fallback chain to
  `combined.getBody(selectedId)?.name ?? localGroupGalaxyName(selectedId) ?? selectedId`. That
  is the ONLY edit to Breadcrumb.
- **D6 — angular pick threshold.** Reuse the star threshold constant
  (`StarScene.tsx:19`, `PICK_MAX_ANGLE_RAD` or equivalent — re-check the name in Step 0); do
  not introduce a new magic angle. A galaxy sprite subtends far more than a star, but the
  threshold is a *click tolerance*, not the sprite size; the same value is correct.

---

## Deliverables / steps

1. `packages/nav/src/local-group.ts` — add pure `localGroupGalaxyName(id)` (D5) and pure
   `pickNearestGalaxy(galaxies, camLocal, dir)` (D4); export both from `packages/nav/src/index.ts`.
2. `apps/web/src/glue/local-group-feed.ts` — new; `localGroupPickHolder` (D4).
3. `apps/web/src/scene/LocalGroupScene.tsx` — new; D1/D2/D3, sets/clears the holder.
4. `apps/web/src/app/StarApp.tsx` — destructure `galaxies` from `makeLocalGroup()` (line ~211),
   pass indices 1..N-1 to a `<LocalGroupScene>` mounted next to `<GalaxyScene>`.
5. `apps/web/src/scene/StarScene.tsx` — the universe-context galaxy branch in `pickAt` (D4).
6. `apps/web/src/hud/Breadcrumb.tsx` — the one-line name fallback (D5).
7. **Visibility ablation hook** — mirror `impostorRadiusOverride`: export
   `localGroupVisibleOverride: { current: boolean }` (default `true`) from `LocalGroupScene`,
   consulted in its frame loop. Wire a setter (e.g. `setLocalGroupVisible`) onto `__cosmosDev`
   at the **`StarApp.tsx:500`** instantiation (the one the e2e reaches — `/` serves `StarApp`
   via `App.tsx:29`; do NOT touch `M4aApp.tsx:128`'s separate `__cosmosDev`). **You MUST also add
   the method to the `__cosmosDev` type augmentation in `apps/web/src/app/dev-surface.ts:4-22`** —
   omitting it fails `pnpm verify` (typecheck, a blocking gate). This lets the e2e ablate the
   layer within one run (machine-independent visibility proof — see gate G3).
8. Unit tests (Deliverables' pure functions) + e2e (below).
9. `docs/agent-tasks/README.md` — add the TASK-086 index row (mirror an existing pending row's
   format). Run `node tools/check-task-index/src/check.mjs`; per the TASK-080 notes the baseline
   is **exactly 1** pre-existing inconsistency (TASK-064/063) and the tool exits 1 — your row
   must **not** raise the count. Do not "fix" the pre-existing one here.
10. `NOTES-2026-07-27-task-086.md` — log every judgment call **as you make it** (CLAUDE.md).
    If you write zero entries, say so explicitly in the PR body.

---

## Frozen (changing any of these is a separate decision, not a side effect)

- `pcScales`, `CONTEXT_UNIT_METERS`, `OriginManager.toRenderSpace`, the `createGalaxyImpostor`
  API + its shaders.
- **`GalaxyScene.tsx` and the streaming/procgen Milky Way path** — do not touch. The local
  group field is additive and independent; editing GalaxyScene collides with its own history.
- The TASK-080 ascent path and the `flythrough*`/`m3`/descent probes and their baselines —
  they must keep passing **unchanged** as the regression control.
- The existing `pickNearestStar` / planet-raycast behaviour in `galaxy`/`system` context —
  the new branch is reached **only** when `contextId === 'universe'`.

---

## Out of scope (do NOT do these here)

- **Info card / detail panel on selection** — deferred (N2b). Breadcrumb name only.
- **Double-click fly-to a galaxy, or entering a galaxy** (each would need its own star field /
  procgen — a large separate thread). Universe-context double-click stays a no-op.
- **Evocative / catalog-realistic names.** `Galaxy G-<n>` is deliberate: deterministic, testable,
  and obviously procedural (no false "real galaxy" claim). Naming design is not this task.
- N3 (Gaia pack URL), N4 (touch input), tour composition (`tours.ts`, `flythrough-descent.ts`),
  lanes/hii TASK-081 follow-up, the vestigial `milkyWayRadiusPc` prop cleanup.
- Any change to `packages/coords`, `packages/streaming`, `packages/render-galaxy`,
  `packages/core-types`.

> **Findings during this task go to `docs/research/`; scope creep goes to a new task file, not
> into this diff.**

---

## Failure modes (these already happened in this repo — read before starting)

- **Inert render — asserting the object, not the pixel.** `galaxy-impostor-scale-is-inert.md`:
  a sprite's scale/existence can be "correct" while it draws **zero pixels**. Memory note
  *"measure the frame, not the layer"* was falsified twice on exactly this. ⇒ the visibility
  gate (G3) MUST be a frame measurement via `__cosmos.readFrameStats()`, ablated with
  `localGroupVisibleOverride` — never `expect(mesh.visible).toBe(true)` or a mount count.
- **Unit-mismatch that is visually inert.** Memory *"perspective-uniform-scaling-invariance"*:
  a mismatch that scales the offset **and** the radius by the same factor cancels in the
  perspective divide — the image looks right while the math is wrong, and only a *non-uniform*
  mismatch breaks it. ⇒ mirror the GalaxyScene universe branch **exactly** (D-note 4); do not
  hand-roll the offset×scale split, and do not trust "it looks fine" as proof of correct units.
- **TASK-081 dark field on wrong-context units.** `star-sprite-goes-dark-on-system-entry.md`:
  skipping the `× unitsToPc` conversion (offset is parsecs; `toRenderSpace` returns context
  units) draws the field in the wrong place, unlit. This is why D3 *hides* outside universe
  rather than letting mis-scaled sprites through.
- **Spurious seed-duplicate galaxy.** `galaxies[0]` is the vestigial pre-donation slot for the
  Milky Way's seed (NOT relocated to the origin — Step 0.2); rendering it draws a duplicate-seed
  galaxy at a random position labelled `Galaxy G-0`. Render `galaxies.slice(1)` only.
- **Pick precedence returning a meaningless star.** Without the `contextId === 'universe'` gate,
  the fallback `pickNearestStar` runs over the galaxy-context HYG batch even in universe context
  and can return a bogus star id. Gate the galaxy branch and return from it.
- **Per-frame allocation** in the frame loop violates §9 (GC hitches on weak hardware — the
  whole hardware-floor thread). Module-scoped scratch, mirror GalaxyScene.

---

## Acceptance gate (deterministic proxies only — CI-blocking)

- **G1 (unit, node-env, pure):** `localGroupGalaxyName('proc:localgroup:3') === 'Galaxy G-3'`;
  `localGroupGalaxyName('proc:milkyway') === 'Milky Way'`; `localGroupGalaxyName(<a star id>) ===
  null`. Deterministic; no WebGL.
- **G2 (unit, node-env, pure):** `pickNearestGalaxy` — build a known local group; a camera
  position + `dir` aimed straight at galaxy *k*'s `positionMpc` returns `proc:localgroup:k`; a
  `dir` aimed at empty sky (> threshold from every galaxy) returns `null`. Log the chosen index +
  the measured angle so a CI-only failure is triagable from logs alone (CLAUDE.md testing rule 6).
- **G3 (e2e, universe context — the visibility proof):** ascend to `universe` (reuse the
  TASK-080 path the ascent spec uses). **First guarantee ≥1 galaxy is in-frame** — orient the
  camera toward a known galaxy's `positionMpc` via the same ascent/orient helper G4 uses, and
  assert `__cosmos.projectToScreen(that galaxy)` is non-null — otherwise the ablation delta can
  be vacuously ~0 because every small (5–50 kpc) galaxy scattered on the 1.5 Mpc sphere is
  off-frustum. Then measure `__cosmos.readFrameStats().litFrac` with the layer ON, set
  `window.__cosmosDev` to hide it (`localGroupVisibleOverride`), measure again, and assert
  `litFrac_on − litFrac_off ≥ FLOOR`. **Do NOT use a bare `> off`**: mirror
  `e2e/tests/universe-impostor-scale.spec.ts`'s methodology — empirically measure the ON/OFF
  delta on the reference machine and set `FLOOR` at ~40% of the measured delta (that spec's
  central-impostor delta was 0.00113 → floor 0.00045; the local-group delta will be smaller and
  MUST be measured, not guessed). In-run ablation → machine-independent. Log both litFrac
  numbers and the delta so a CI-only failure is triagable from logs alone.
- **G4 (e2e, select → name):** in universe context, use `__cosmos.projectToScreen(galaxy_k
  positionMpc)` to get a pixel, `__cosmos.pickAt(x, y)` there returns `proc:localgroup:k`; then
  dispatch the real click and assert the text `Galaxy G-k` appears within the `Location`
  breadcrumb nav (`getByRole('navigation', { name: 'Location' })` then `getByText`, not a
  coordinate probe — CLAUDE.md testing rule 3; the current segment is a plain `<span>` with no
  role of its own). If `projectToScreen` returns null (galaxy
  behind camera), orient the camera toward it first via the ascent helper; do NOT re-derive the
  projection in test code (rule 1).
- **`pnpm verify`** clean (lint + typecheck + unit + build). e2e (G3/G4) runs CI-side; smoke the
  one new/modified deterministic spec locally via `pnpm test:smoke` before pushing (repo carve-out).

## Verification beyond the gate (reference-machine, non-blocking)

- Screenshot in universe context showing multiple galaxy sprites distributed around the void
  (attach to the PR; `!process.env.CI`, not a blocking check).
- Manual: click several galaxies, confirm distinct `Galaxy G-<n>` names in the breadcrumb.
