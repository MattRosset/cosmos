# Task: Legible Gaia DR3 identity card (Task C, carve-out of TASK-069)

**Status:** ready to implement
**Phase:** Maintenance track — "Gaia realness" thread (the reframe's **Task C**).
**Reframe source:** `docs/research/gaia-pick-identity-gap.md` (Verdict: REFRAME → Tasks B + C).
**Predecessors (both merged to `main`):**
- TASK-087 — Gaia `source_id` sidecar resolver + combined-tile `idPrefix` provenance (D1 + D2).
- TASK-088 — Gaia octree-stream pick → real DR3 identity (Task B). A click on a Gaia star now
  selects a real `gaia:<source_id>` (19-digit DR3 id) in the selection store.

Author of this spec: spec-task pass, 2026-08-03. Scope decision (rich card, not minimal) taken
by the user this session; performance/frozen-surface risk assessed before committing — see §
"Why this design" below.

---

## Goal

When the user clicks a Gaia DR3 star, show a **legible identity card** — not the raw
`gaia:6827136600469308288` string the InfoPanel/Breadcrumb show today. The card presents the
star as what it is: a real catalogued Gaia DR3 star, with its **DR3 source_id, distance,
apparent magnitude / naked-eye visibility, spectral class / colour, and galactic coordinates** —
reusing the *same* astro-derive rendering the HYG star card already uses.

Task B stops at a `gaia:<source_id>` bodyId in the selection store; the Breadcrumb and InfoPanel
fall through to the raw string (`InfoPanel.tsx:160-167` `if (!body)` branch;
`Breadcrumb.tsx:34-37` falls through to `selectedId`). This task closes that legibility gap.

**This is the payoff of the whole "Gaia realness" thread**: the user reaches a real star from
the ~4.6M-star DR3 catalog and sees its real physical identity, not a debug id.

---

## Why this design (read before Step 0 — it is the load-bearing decision)

Two facts, verified against live code this session, determine the shape:

1. **The picked star's `absMag`, `colorIndexBV`, and position are all in the decoded
   `StarBatch`** (`packages/core-types/src/batches.ts:11-13`) at the picked index — magnitude,
   colour and coordinates are one array-read away inside `pickNearestGaia`. **Sol is the
   galaxy-frame origin** (`GalaxyScene.tsx:517`), so a Gaia star's absolute position
   (`tile.originPc + local`) has magnitude = distance from Sol, exactly like the HYG card's
   `dist = |positionPc|`.
2. **The selection store holds ONLY a `BodyId` string** (`packages/app-state/src/selection.ts:4-6`)
   — no attribute channel. For HYG/exo the card gets data via `combined.getBody('hyg:N')`; there
   is **no equivalent pack lookup for a Gaia `source_id`**.

So the rich card needs a channel from pick-time to the card. **We do NOT change the frozen
selection store.** Instead we reuse the established single-slot *holder* pattern
(`octreePickHolder`, `pickProbeHolder`, `controllerHolder`): a module-scoped holder populated at
the select site, surfaced to the `@cosmos/ui` InfoPanel through a new **optional adapter method**
(mirroring the existing `hostSystemIdFor?` / `planetCountFor?` optional methods). The selection
store stays pure `BodyId`; `@cosmos/data` and `@cosmos/core-types` are untouched.

**Performance (assessed, not asserted):** pick-time capture is O(1) per click — `pickNearestGaia`
already scans every visible Gaia point (`octree-pick.ts:59-75`); we capture 3 extra scalars for
the *winner* only, inside the existing `if (angle < bestAngle)` block, once per click, never per
frame. The card re-renders on selection *change* only and lives outside `<SceneHost>` (§5.12), so
zero Canvas / frame-rate impact. The real risk is **coherence with the async id upgrade**, pinned
in D3/D4 and Failure modes below — not performance.

---

## Step 0 — Facts to re-verify against LIVE code before writing any code

Specs age; the code moved after TASK-088 merged. Re-confirm each against the file, not this text.
Log any drift to `NOTES.md` and STOP if a load-bearing fact is false (CLAUDE.md rule 1).

- **(a) Pick site & provisional id.** `StarScene.tsx` `pickAt` builds `gaiaHit` locally
  (`:299-307`) and, when the gaia hit wins, returns the PROVISIONAL `gaia:${gaiaHit.catalogId}`
  (`:312-314`). `pickAt` is documented "no selection side-effect" and is exposed as
  `__cosmos.pickAt` (`:354`) — the e2e sweep calls it thousands of times. **Do not add a holder
  write inside `pickAt`.** Confirm these line anchors.
- **(b) Select sites — there are TWO.** The select + async upgrade is `selectAndUpgrade(id)` →
  `selectWithGaiaUpgrade(id, selectionPort, gaiaIds)` (`StarScene.tsx:359-364`), called from
  BOTH `onPointerUp` (`:381-386`) AND `onDoubleClick`'s gaia branch (`:388-399`): for a `gaia:*`
  id `onDoubleClick` calls `selectAndUpgrade(id)` (`:394-396`) — it falls to `onActivate` (go-to)
  ONLY for non-gaia ids (`:398`), because a Gaia star is not a flyable host (TASK-088 D4 added
  this). So the holder must be populated at BOTH select sites (D3), not `onPointerUp` alone.
  (Confirm the double-click gaia branch is still there — if TASK-088's D4 branch were reverted the
  holder plumbing would differ.)
- **(c) `pickNearestGaia` return shape** = `{ catalogId, angleRad, distancePc }`
  (`octree-pick.ts:21-27, 79-80`); the winning index captures only `bestCatalogId` (`:73`). The
  batch at that index carries `positionsPc` (`:60-62`), and ALSO `absMag` / `colorIndexBV`
  (`batches.ts:11-13`) — confirm both are `Float32Array` on the decoded `StarBatch` the pick
  iterates, and that `tile.batch.originPc` is available (it is used at `octree-pick.ts:52-54`).
- **(d) Async upgrade + staleness guard.** `selectWithGaiaUpgrade` (`glue/gaia-identity.ts:23-36`)
  selects the provisional id, then `gaiaIds.resolve(catalogId)` → replaces with `gaia:${sid}`
  ONLY if `getSelectedId() === id` still (staleness guard, JC-3). Confirm this exact guard — the
  details holder must ride the SAME guard (D4).
- **(e) InfoPanel fallthrough + adapter.** `InfoPanel.tsx:160-167` renders bare `{selectedId}`
  when `getBody` is undefined; the adapter is built in `Hud.tsx:69-92` (`adapter.getBody =
  source.getBody`; optional `hostSystemIdFor?` / `planetCountFor?`). `BodyLookupAdapter` is
  declared in `packages/ui/src/types.ts:4-19`. Confirm the optional-method pattern still holds.
- **(f) Breadcrumb fallthrough.** `Breadcrumb.tsx:32-39` shows `combined.getBody(id)?.name ??
  localGroupGalaxyName(id) ?? selectedId` — for a `gaia:*` id this is the raw string. Confirm.
- **(g) Existing astro-derive helpers.** InfoPanel already imports `spectralClassFromBV`,
  `spectralPlainLanguage`, `spectralTint`, `apparentMagnitude`, `nakedEyeVisibility`,
  `formatLightTravel`, `formatEtaAtC` (`InfoPanel.tsx:1-18`); `fmtSig3` (`:21`) and `PC_TO_LY`
  (`:19`) are in-file module-local helpers, not imports. All reachable for the new gaia branch
  (same file). Confirm.

---

## Context files (real files, one-line why)

- `apps/web/src/glue/octree-pick.ts` — `pickNearestGaia` + `GaiaPickHit`; **extend the hit** (D1).
- `apps/web/src/glue/octree-pick.test.ts` — the pick unit test; add hit-attribute assertions (D1).
- `apps/web/src/glue/gaia-identity.ts` — `selectWithGaiaUpgrade` + `SelectionPort`; the async
  upgrade the details holder must ride (D3/D4).
- `apps/web/src/glue/gaia-identity.test.ts` — staleness-guard unit test; extend for details (D4).
- `apps/web/src/scene/StarScene.tsx` — pick + select sites; capture + populate the holder (D3).
- `apps/web/src/hud/Hud.tsx` — builds the `BodyLookupAdapter`; wire the new gaia-card method (D5).
- `apps/web/src/hud/Breadcrumb.tsx` — the other raw-string surface; legible label (D6).
- `packages/ui/src/InfoPanel.tsx` — the card; new gaia branch reusing astro-derive (D5).
- `packages/ui/src/types.ts` — `BodyLookupAdapter`; add the optional gaia-card method (D5).
- `packages/ui/test/InfoPanel.test.tsx` — card unit test; add gaia-card cases (D5, the gate).
- `docs/research/gaia-pick-identity-gap.md` — the reframe; why B and C are split.
- `docs/agent-tasks/NOTES-2026-08-01-task-088.md` — Task B's JC log; JC-3 staleness guard, the
  holder-pattern precedents, and the "Task C handoff" note (`:108-110`).

---

## Frozen — changing any of these is a separate thaw task, not a side effect

- **`packages/app-state/src/selection.ts`** — the selection store shape stays exactly
  `{ selectedId: BodyId | null; select() }`. The whole design exists to avoid changing it. The
  `selection/changed` bus emit (`app-state/src/bridge.ts:12-14`) keys on `selectedId` — do not
  break it.
- **`packages/core-types`** — `StarBatch`, `BodyRecord`/`StarRecord`, `BodyId`. Read-only.
- **`packages/data`** — `CombinedSource.getBody` / `search`. The gaia card does NOT route through
  `@cosmos/data` (wrong layer — pick details are app-glue). Do not add gaia logic here.
- **`GaiaSourceIdResolver` signature** (`packages/data/src/gaia-sourceids.ts`) — reader only.
- **The pick's cross-source arbitration** (`gaiaHitWins`, `pickNearestStar` result) and every
  existing `hyg:*` / `exo:*` / `null` pick outcome — strictly unchanged (additive only).

`GaiaPickHit` / `pickNearestGaia` (app glue, TASK-088's own) and `BodyLookupAdapter` (adding an
OPTIONAL method) are **not** frozen — extending them is in scope.

---

## Out of scope

- **Go-to / enter-system for a Gaia star.** The card shows identity; it does NOT get a "Go to"
  button that flies the camera to the Gaia star. Gaia stars are not nav anchors in this task
  (`onGoTo(gaia:*)` has no target in the nav tree) — a Gaia go-to is a separate future task. The
  gaia card renders NO action button.
- **Search-by-id (TASK-070).** Reaching a Gaia star by typing its id is a separate task.
- **HYG-octree identity.** A pick in a `hyg-v41` sub-range is still not claimed (TASK-088 scope
  rule). Unchanged.
- **RA/Dec / equatorial coordinates.** Show the galactic-frame pc vector (what the data is in).
  Converting to RA/Dec is a presentation nicety, deferred; if attempted it is a finding, not
  this diff.
- **Rebuilding packs / new sidecar fields.** The committed 135-star sample + its sidecar are
  sufficient. Reader only.
- **Any exposure / render / visibility change.** Card only.

**Standing rule:** Findings during this task go to `docs/research/` (create the file if the
finding is substantial); scope creep goes to a **new task file**, not into this diff.

---

## Deliverables / Steps

Order matters: D1→D2 are the data capture (unit-testable, no WebGL); D3→D4 wire it through the
scene; D5→D6 render it.

### D1 — Extend `GaiaPickHit` to carry the picked star's attributes
In `apps/web/src/glue/octree-pick.ts`, add to `GaiaPickHit`:
- `absMag: number`
- `colorIndexBV: number`
- `positionPc: readonly [number, number, number]` — the **absolute galactic-frame** position of
  the winning star = `batch.originPc + local` (Sol-origin ⇒ `|positionPc|` = distance from Sol).

Capture them at the winning index inside the existing `if (angle < bestAngle || …)` block
(`octree-pick.ts:70-74`), alongside `bestCatalogId`. Read `batch.absMag[i]`, `batch.colorIndexBV[i]`,
and reconstruct absolute position: `positionsPc[i*3{,+1,+2}] + batch.originPc[{0,1,2}]` (NOT the
tile-local rebased `ox/oy/oz` used for the ray — that is camera-relative; the card wants
Sol-relative). Keep `distancePc` (camera-relative) as-is for the arbitration.

**Test (D1):** in `octree-pick.test.ts`, extend an existing "gaia hit wins" case to assert the
returned hit's `absMag` / `colorIndexBV` equal the batch values at the expected index and
`positionPc` equals `local + originPc` (use a non-zero `originPc` in the fixture so the
Sol-vs-camera frame distinction is actually tested — a zero origin would hide a rebase bug).

### D2 — Define the gaia-card detail type + single-slot holder (app glue)
Add a small module (e.g. `apps/web/src/glue/gaia-card.ts`) exporting:
```ts
export interface GaiaCardDetails {
  readonly catalogId: number;                 // provisional-id lineage
  sourceId: bigint | null;                     // filled by the async upgrade (D4)
  readonly positionPc: readonly [number, number, number]; // absolute galactic (Sol-origin)
  readonly absMag: number;
  readonly colorIndexBV: number;
}
export const gaiaCardHolder: { current: GaiaCardDetails | null } = { current: null };
```
Rationale for a single slot: only one body is selected at a time; the InfoPanel reads the holder
only when it matches the current `selectedId` (D5), so a stale entry can never render against a
newer selection.

### D3 — Populate the holder at the select site (StarScene)
`pickAt` must stay a pure query (Step 0a). Refactor so the SELECT path can obtain the winning
gaia hit's details WITHOUT a holder write inside `pickAt`. Suggested shape (pin whatever you
choose in NOTES):
- Extract a `pickAtDetailed(x, y): { id: BodyId | null; gaia: GaiaCardDetails | null }` that runs
  the same body as today's `pickAt` and, when a gaia hit wins, also returns the details built
  from the extended `GaiaPickHit`. Make `pickAt = (x,y) => pickAtDetailed(x,y).id` so
  `__cosmos.pickAt` is byte-identical to today.
- In `onPointerUp` (`:381-386`), call `pickAtDetailed`; set `gaiaCardHolder.current = gaia`
  (with `sourceId: null`) when `gaia !== null`, else set it to `null`; then call
  `selectAndUpgrade(id)` as today.
- In `onDoubleClick`'s gaia branch (`:394-396`) — which ALSO selects (Step 0b) — do the same:
  populate the holder via `pickAtDetailed` before `selectAndUpgrade(id)`. Do NOT rely on the
  preceding `onPointerUp` having set it; populate it explicitly so the plumbing is robust to event
  ordering. The non-gaia `onActivate` path (`:398`) is unchanged and touches no holder.

### D4 — Fill `sourceId` on the async upgrade, under the SAME staleness guard
When `selectWithGaiaUpgrade` resolves the real `source_id` and the guard passes
(`getSelectedId() === id`), the holder's `sourceId` must be set so the card can show the 19-digit
DR3 id. Two acceptable shapes — choose and log:
- (a) Extend `selectWithGaiaUpgrade` with an optional `onUpgrade?(catalogId, sourceId)` callback
  that StarScene wires to `if (gaiaCardHolder.current?.catalogId === catalogId)
  gaiaCardHolder.current.sourceId = sid`, called inside the guarded branch, OR
- (b) have StarScene pass a holder-aware `SelectionPort` whose `select('gaia:<sid>')` also updates
  the holder.

Prefer (a): it keeps the guard's single source of truth in `gaia-identity.ts` and stays
unit-testable there. **The holder update MUST be inside the guarded branch** (`if
(selection.getSelectedId() === id)`), never before it — a slow resolve of an old click must not
write a `sourceId` onto a holder a newer click already replaced. **Ordering inside the branch:**
set `holder.sourceId` (call `onUpgrade`) BEFORE `selection.select('gaia:<sid>')`, so the holder is
coherent at the instant the store change fires and its synchronous subscribers (InfoPanel) read a
matching holder — otherwise there is a possible one-render flash to the bare id. The D5.2
match-check already prevents *stale* data regardless of ordering; this only removes the flash.

**Test (D4):** in `gaia-identity.test.ts`, extend the staleness-guard test: assert the upgrade
callback fires with the resolved `sourceId` ONLY when the provisional id is still selected, and
does NOT fire (or is ignored) when a newer selection has superseded it.

### D5 — Render the gaia card (InfoPanel) via a new optional adapter method
1. `packages/ui/src/types.ts`: add to `BodyLookupAdapter` an OPTIONAL method:
   ```ts
   /** App-glue resolver for a picked Gaia DR3 star (TASK-089). Returns null for non-gaia ids
    *  or when no pick detail is held. Kept optional + adapter-injected so @cosmos/ui stays
    *  decoupled from app glue, exactly like hostSystemIdFor?/planetCountFor?. */
   getGaiaCard?(id: BodyId): GaiaCardView | null;
   ```
   with `GaiaCardView = { sourceId: bigint | null; catalogId: number; positionPc: readonly
   [number,number,number]; absMag: number; colorIndexBV: number }` (declare in `types.ts` AND
   re-export it from the `@cosmos/ui` package index/barrel alongside `BodyLookupAdapter`, so
   `Hud.tsx` — which consumes ui types via `from '@cosmos/ui'` — can name it).
2. `apps/web/src/hud/Hud.tsx`: implement `getGaiaCard(id)` in the `adapter` useMemo — parse the
   `gaia:` id, read `gaiaCardHolder.current`, and return it only if the holder's lineage matches
   the id (`holder.catalogId` matches a provisional `gaia:<catalogId>`, OR
   `holder.sourceId === BigInt(idTail)` for an upgraded `gaia:<source_id>`; guard `BigInt()`
   against a non-numeric tail). Return `null` otherwise. This is the match-check that makes the
   single-slot holder safe.
3. `packages/ui/src/InfoPanel.tsx`: BEFORE the `if (!body)` fallthrough (`:160`), add a gaia
   branch: if `selectedId.startsWith('gaia:')` and `adapter.getGaiaCard?.(selectedId)` returns a
   view, render a star-style card REUSING the existing helpers:
   - **name / hero identity:** heading "Gaia DR3 star"; the source_id (grouped/monospace) as the
     identity line — if `sourceId === null` (sidecar unavailable / not yet resolved) show the
     provisional catalogId with a "resolving…" affordance or just the catalogId, NOT a crash.
   - **distance:** `dist = |positionPc|`, then the same ly hero block + `formatLightTravel` +
     `formatEtaAtC` the star branch uses (`:247-258`).
   - **magnitude / visibility:** `apparentMagnitude(absMag, dist)` → `nakedEyeVisibility(...)`.
   - **spectral / colour:** `spectralClassFromBV(colorIndexBV)`, `spectralPlainLanguage(...)`,
     and the `spectralTint(...)` panel tint (`:242`).
   - **coordinates:** the galactic-frame pc vector (x, y, z) in a details row.
   - **NO action button** (out of scope) and NO HIP row.
   - `role="complementary"`, `aria-label="Gaia star information"`; keep the close button.

**Test (D5, the gate):** in `packages/ui/test/InfoPanel.test.tsx`, following the existing pattern
(`useSelectionStore.setState({ selectedId })` + a mock adapter whose `getGaiaCard` returns a
fixed view), assert the rendered card shows: the 19-digit source_id, a ly distance, a spectral
class, a naked-eye visibility line, and the coordinates — and that it shows NO "Go to"/"Enter
system" button. Add a second case where `getGaiaCard` returns `null` → the panel falls through to
today's bare-`selectedId` behavior (no throw). Add a `sourceId: null` case → renders without
crashing (degrade path).

### D6 — Legible Breadcrumb segment for a Gaia selection
`Breadcrumb.tsx:34-39`: for a `gaia:*` `selectedId` with no `combined.getBody` name, show a
legible body crumb (e.g. `Gaia DR3` or `Gaia <short-id>`) instead of the raw
`gaia:6827136600469308288`. Keep it minimal — the InfoPanel is the detailed surface. Do not
reach into the holder here (the Breadcrumb has no adapter); derive the label from the id string
alone.

**Test (D6):** none required beyond a render smoke if a Breadcrumb test exists; if none exists,
say so in NOTES rather than adding a bespoke harness (rule: don't invent test scaffolding for a
one-line label).

### D7 — NOTES + judgment log
Create `docs/agent-tasks/NOTES-2026-08-03-task-089.md`. **Log every judgment call — anything this
task didn't decide and you had to — to it, visibly, as you go (not reconstructed after)** — the
D3 refactor shape, the D4 (a)/(b) choice, any Step-0 drift, the Breadcrumb label wording.

---

## Failure modes (mined from `git log` + Task B NOTES + the reframe research — the traps that
already happened in this area)

- **Stale attributes on a newer selection (the #1 risk).** The single-slot holder + async upgrade
  is exactly JC-3's staleness class. If D4 writes `sourceId` outside the guard, or D5's
  `getGaiaCard` skips the lineage match, a slow resolve of click A can paint A's magnitude/colour
  onto click B's card. Guard (D4) + match-check (D5.2) are both mandatory; the D4 test must prove
  the guarded write, and D5's null-mismatch case must prove the match-check.
- **`Number(source_id)` / `BigInt` corruption (BUG-6 class).** DR3 source_ids are 19 digits (>
  2^53). Task B's `gaia-identity.ts` interpolates the `bigint` directly and NEVER does
  `Number(sid)` (`:20-22` docstring). The card and the `getGaiaCard` match-check must likewise use
  `bigint` (`BigInt(tail)`), never `parseInt`/`Number`, or the id truncates. Guard `BigInt()`
  against a non-numeric tail (`try`/`catch` or a `/^\d+$/` test) so a malformed id returns null,
  not a throw.
- **Camera-relative vs Sol-relative frame (silent wrong distance).** `pickNearestGaia`'s
  `distancePc` is CAMERA-relative (rebased by `originPc` for the ray, `octree-pick.ts:52-54`). The
  card's distance must be **Sol-relative** = `|originPc + local|`. Using the ray-rebased local
  position, or `distancePc`, yields a plausible-but-wrong distance that no type error catches —
  hence D1's fixture requires a non-zero `originPc`.
- **Holder write inside the pure `pickAt` (breaks the e2e sweep contract).** `__cosmos.pickAt` is
  called thousands of times in the CLAIM-1 sweep with "no selection side-effect" (`:353-354`).
  Writing the holder there both violates that contract and thrashes the slot during a sweep. D3
  keeps the write in the select path only.
- **Coupling gaia logic into `@cosmos/data` or the selection store (layer/frozen violation).** The
  tempting shortcut — make `combined.getBody('gaia:*')` synthesize a record, or add an attributes
  field to the selection store — either couples pick details into the data package or thaws the
  frozen store. The adapter-injected `getGaiaCard?` keeps it in app glue (Task B established this
  exact discipline: pick feeds via holders, `@cosmos/data` untouched).
- **InfoPanel star-branch assumptions leak (go-to / system / HIP).** Reusing the star branch
  verbatim would render an "Enter system ▸"/"Go to" button and try `hostSystemIdFor`/HIP on a
  gaia star — a go-to with no target. The gaia branch is SEPARATE and renders no action button
  (out-of-scope). Don't synthesize a `StarRecord` and fall into the star branch.
- **`vitest` has no WebGL here.** The pick + upgrade logic is deliberately extracted to pure
  functions (`octree-pick.ts`, `gaia-identity.ts`) precisely so the gate is unit-testable
  (TASK-088 JC-2/JC-3). Keep D1/D4 logic in those pure functions; do NOT put the new capture or
  guarded-write logic in the WebGL closure where only e2e can reach it.
- **Additive-only regression.** Every existing `hyg:*` / `exo:*` / `null` pick + card outcome must
  be byte-identical. The gaia branch is reached only for `gaia:` ids; the `pickAtDetailed`
  refactor must leave `pickAt`'s returned string unchanged (assert in the pick test that a
  non-gaia scenario is untouched).

(This area's written history is thin beyond TASK-088 — `InfoPanel.tsx`'s git log is the C1-C7
redesign, `Breadcrumb`/`selection.ts` have no isolated history. The load-bearing traps above come
from TASK-088's NOTES and the reframe doc, which ARE the area's real history.)

---

## Acceptance gate (deterministic, CI-blocking)

`pnpm verify` (lint + typecheck + unit + build) exit 0, AND specifically:
1. **D1 pick test** — `octree-pick.test.ts`: the extended `GaiaPickHit` carries the correct
   `absMag`/`colorIndexBV` and a Sol-relative `positionPc` (non-zero-origin fixture).
2. **D4 upgrade test** — `gaia-identity.test.ts`: `sourceId` is delivered to the holder/callback
   ONLY under the passing staleness guard; superseded selections do not write.
3. **D5 card test** — `InfoPanel.test.tsx`: a `gaia:<19-digit>` selection with a matching
   `getGaiaCard` renders source_id + ly distance + spectral class + visibility + coordinates and
   NO action button; a `null` `getGaiaCard` falls through without throwing; a `sourceId: null`
   view renders without throwing.
4. **Additivity** — a non-gaia pick scenario in `octree-pick.test.ts` returns the identical
   bodyId string it did before the `pickAtDetailed` refactor.

All four are pure vitest (no WebGL, no pixels, no wall-clock) — deterministic CI proxies per
CLAUDE.md gate rule 4. Screenshots are reference-only, never blocking.

---

## Verification beyond the gate (reference-only, not CI-blocking)

- **Real-run smoke (local, `!CI`):** in the app (galaxy context, near a mounted Gaia tile), click
  a Gaia star; confirm the InfoPanel shows "Gaia DR3", a 19-digit source_id, a distance in ly, a
  spectral/visibility line, and coordinates — and updates from provisional to the real source_id
  as the sidecar resolves. This is the BUG-6-class check a fetch mock can't catch (mirrors
  TASK-088 Gate 5's real-run smoke); fold it into the existing `e2e/tests/gaia-pick-identity.spec.ts`
  as a reference-only (`test.skip(!!process.env.CI, …)`) assertion on the InfoPanel text if it is
  cheap to reach the mounted-tile state; otherwise a manual note in NOTES is acceptable —
  tile-mount timing is machine-dependent (TASK-088 JC-5), so it is NOT a blocking gate.
- Confirm the Breadcrumb (D6) shows the legible label, not the raw string, on the same click.
