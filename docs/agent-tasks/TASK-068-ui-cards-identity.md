# Task: `ui` perception v3 — insight cards + visual identity

**ID:** TASK-068
**Target package:** `packages/ui` (+ token/style wiring in `apps/web`)
**Size:** L
**Phase:** Perception track (post-4a; not a roadmap phase)
**Depends on:** TASK-066 (strings/format modules), TASK-067 (HUD composition settled).
**Provenance:** spec-reviewed 2026-07-12 against main@61c1373 — C2/C5 input sourcing made
explicit, C3 adapter exception sanctioned (moons-count trap), V2/V3 storage+store facts
corrected, e2e gate 4 exposure observability fixed.
Consider a lightweight design sketch before starting (research open question 5) —
if none exists, implement the §6.2 table as specified and keep layout swappable.

Source research: [`../research/ui-ux-perception-and-polish.md`](../research/ui-ux-perception-and-polish.md)
§6, §7 — **Phase 3 items: C1–C7 (C3 card-only), V2, V3, typography + spectral tint.**

## Goal

Info cards deliver insight, not just correct astronomy: a star card leads with a hero
metric and says "Yellow dwarf — similar to the Sun"; a planet card shows its size relative
to Earth as a visual bar and its year in human terms. The HUD gains a distinct visual
identity (display face for names, tabular numerals for quantities, spectral-tinted panel
accent) and a unified View drawer replacing today's split settings. Every derived label
comes from existing pack fields at display time — **no new data pipeline**.

## Frozen Interface

Read-only against all non-`ui` packages. Existing `InfoPanel` props (star: distance, abs
magnitude, B−V, spectral class, HIP; planet: radius km, semi-major axis AU, eccentricity,
period, parent) are the ONLY data inputs — if a proposal needs a field that isn't already
passed, cut the line item rather than widening adapters (that is the sibling data lane).

**Single sanctioned exception (C3):** `BodyLookupAdapter` gains ONE optional method,
`planetCountFor?(systemId: BodyId): number | null` (absent ⇒ badge omitted). Implement it
in the app glue (`apps/web/src/hud/Hud.tsx`, next to the existing `hostSystemIdFor`) via
`source.getSystem(systemId)`. **Trap:** `StarSystemRecord.bodies` is planets AND moons flat
(`packages/core-types/src/systems.ts:18`; the Sol pack contains `sol:moon`, Titan, …) —
count only bodies whose `parentId === system.star.id`, or Sol reads "10 known planets".
No other adapter/prop widening; anything else still gets cut.

Note on derived inputs (not new fields): apparent magnitude (C2) does not exist on
`StarRecord` (`packages/core-types/src/bodies.ts` — only `absMag`); derive it in
`astro-derive.ts` as `apparentMagnitude(absMag, distancePc)` = `absMag + 5·log10(d/10)`
(InfoPanel already computes `dist` from `positionPc`). Planet period-in-days (C5) comes
from an extracted `orbitalPeriodDays(aAu, muKm3S2)` exported from `format.ts` (the Kepler
math already lives inside `formatOrbitalPeriod`, format.ts:129 — export it, don't
re-derive it). The B−V for `habitableZoneHint` is the PARENT STAR's `colorIndexBV`,
reachable in the existing planet path via `adapter.getBody(body.parentId)`.

New additive `@cosmos/ui` surface:

```ts
// packages/ui/src/astro-derive.ts — pure display-time derivations, unit-tested
export function spectralPlainLanguage(bv: number | null, spectral?: string | null): string | null; // C1
export function apparentMagnitude(absMag: number, distancePc: number): number | null;              // C2 input (see Frozen Interface note)
export function nakedEyeVisibility(apparentMag: number | null): string | null;                     // C2, mag ≤ ~6.5
export function radiusVsEarth(radiusKm: number): { ratio: number; label: string };                 // C4
export function orbitInHumanTerms(periodDays: number, semiMajorAxisAu: number): string;            // C5; periodDays from format.ts orbitalPeriodDays
export function habitableZoneHint(semiMajorAxisAu: number, bv: number | null): string | null;      // C5 (null when insufficient data; bv = PARENT star)
export function spectralTint(bv: number | null): string | null; // C7 → CSS color string
```

Fixed copy (badge variants, visibility lines, "similar to the Sun" comparisons) lives in
`packages/ui/src/strings.ts` per the TASK-066 convention (research open question 1:
perception copy is centralized, never scattered literals); `astro-derive.ts` composes
from `STRINGS`, it does not embed its own English sentences.

## Inputs / Outputs

- **Inputs:** existing InfoPanel prop data; `ui.css` design tokens.
- **Outputs (behavioral):**
  - **C1/C2:** star cards show plain-language class + naked-eye visibility line when the
    underlying fields exist; silently omitted otherwise (never "unknown" filler).
  - **C3 (card-only v1):** system badge on the card — *"N known planets"* / *"No known
    planetary system"* (drives honest expectations for the Go-to action, research §2.3).
    **Search-row badges are OUT OF SCOPE** (blocked on the Gaia/search data lane).
  - **C4/C5:** planet cards get an Earth-relative size bar (CSS proportion, no canvas) and
    human-terms orbit line; habitable-zone hint only when derivable.
  - **C6:** museum-style layout — hero metric (ly / light-minutes via TASK-066 helpers),
    supporting grid, one comparison line (D2). pc/abs-mag/eccentricity live in a
    collapsed "details" row.
  - **C7 + typography:** panel accent/border glow from `spectralTint`; token extensions in
    `ui.css` (display face for body names, mono/tabular numerals for quantities — bundled
    fonts must be license-compatible and added to `ATTRIBUTIONS.md`, or use system stacks).
  - **V3 View drawer:** one surface consolidating exposure (`useSettingsStore`),
    constellations/labels/cinematic (`useOverlayStore`), and auto-hide. Auto-hide has NO
    store today — it is local `useState(idle)` in `apps/web/src/app/StarApp.tsx` — so the
    drawer takes it as controlled props (`autoHide` + `onAutoHideChange`) wired from
    `apps/web`; the other toggles read/write the existing stores directly. `app-state`
    untouched. Old scattered control mounts (`OverlayControls`, `ExposureControl`) removed.
  - **V2:** auto-hide preference persisted from `apps/web` glue using the guarded
    try/catch `localStorage` pattern of `FIRST_RUN_KEY` in `apps/web/src/hud/Hud.tsx`
    (`useFirstRun`). Do NOT import `createSafeStorage` — it lives in frozen
    `packages/app-state/src/persist-util.ts` and is not exported from the package index.

## Constraints & Forbidden Actions

- Do not modify `packages/core-types`, `packages/app-state`, `packages/data`, nav, or any
  pack tool — display-time derivation only.
- No new runtime dependencies. Fonts: static assets only; keep the Lighthouse budget
  (self-host, `font-display: swap`, subset if needed; bundle-size gate must stay green).
- `packages/ui` never imports Three.js; no deep imports.
- Derivations must be total functions returning `null` for missing data — cards render
  without gaps, no "NaN" / "undefined" strings (assert in tests).
- Keep every existing `ui` export working (additive thaw); InfoPanel prop shape may gain
  optional fields but must not break TASK-066's e2e copy assertions — update that spec
  only if the hero-metric layout moves the same strings.
- No hard-coded pixel/font geometry in tests (conventions rule 2).

## Common Mistakes (architecture §5.12 — HUD)

- Reaching into `data`/pack loaders from `ui` for "just one more field" — boundary
  violation; the card renders what it is given.
- Encoding scientific thresholds (habitable zone, visibility limit) as magic inline
  numbers — name them as exported constants with a comment citing the approximation.
- Screenshot-gating typography/tint in CI — reference-machine only.

## Acceptance Tests

DONE only when these pass in CI (`pnpm verify` + `pnpm test:e2e`):

1. **Vitest** — table tests for every `astro-derive.ts` function: known anchors (Sol-like
   B−V → "similar to the Sun"; Mercury period → "88-day year"), boundary/null inputs,
   and the invariant that no function ever returns the strings `NaN`/`undefined`.
2. **E2E — star card:** select a bright known star; assert plain-language class line,
   hero ly metric before pc, system badge text (either variant), details row collapsed by
   default. Log star id + rendered strings.
3. **E2E — planet card:** enter Sol, select a planet; assert size-bar element present with
   an accessible label containing an Earth-ratio, and a human-terms orbit line.
4. **E2E — View drawer:** open drawer via role locator; toggle an overlay and assert
   `__cosmos.overlays` reflects it. For exposure, extend the test hook first:
   `__cosmos.overlays` mirrors only constellations/labels today
   (`apps/web/src/glue/test-hook.ts` `mirrorOverlayState`), so add an `exposure` mirror
   from `useSettingsStore` to the same ≤ 4 Hz mirror (glue file — allowed), move the
   slider, and assert the mirrored value changed. Log toggled control + observed values.
   Assert the old scattered controls are gone.
5. **Perf/bundle:** existing bundle-size gate stays green with any added font assets;
   no new per-frame React renders (existing §5.12 discipline).
6. Visual identity screenshots: reference-machine only (`!process.env.CI`).

## Deliverables

- `packages/ui/src/astro-derive.ts` + tests; InfoPanel card redesign + updated tests
- `packages/ui/src/format.ts`: extract + export `orbitalPeriodDays(aAu, muKm3S2)`
  (existing `formatOrbitalPeriod` delegates to it); `strings.ts` additions for new copy
- `packages/ui/src/ViewDrawer.tsx` + tests; removal of superseded control mounts
- `packages/ui/src/ui.css` token extensions; font assets (if any) + `ATTRIBUTIONS.md` entry
- `apps/web` wiring: drawer mount, auto-hide preference, spectral-tint variable plumbing,
  `planetCountFor` adapter impl (Hud.tsx), test-hook `exposure` mirror
- e2e spec `e2e/tests/perception-cards.spec.ts` (note: the card redesign must keep the
  `.cosmos-ui-info-name/-distance/-eta` hooks asserted by
  `e2e/tests/perception-literacy.spec.ts`, or update that spec in the same PR)

## Context Files

- `docs/research/ui-ux-perception-and-polish.md` (§6, §7, §9–§12)
- `docs/research/navigation-ux.md` (C3 copy rationale; host-star items are the OTHER lane)
- `packages/ui/src/InfoPanel.tsx`, `packages/ui/src/ui.css`, `packages/ui/src/Dock.tsx`
- `apps/web/src/styles.css` (TASK-029 bookmark override debt — resolve placement here if trivial)
- `docs/testing-conventions.md`
