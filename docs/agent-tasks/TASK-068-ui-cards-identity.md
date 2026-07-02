# Task: `ui` perception v3 — insight cards + visual identity

**ID:** TASK-068
**Target package:** `packages/ui` (+ token/style wiring in `apps/web`)
**Size:** L
**Phase:** Perception track (post-4a; not a roadmap phase)
**Depends on:** TASK-066 (strings/format modules), TASK-067 (HUD composition settled).
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

New additive `@cosmos/ui` surface:

```ts
// packages/ui/src/astro-derive.ts — pure display-time derivations, unit-tested
export function spectralPlainLanguage(bv: number | null, spectral?: string | null): string | null; // C1
export function nakedEyeVisibility(apparentMag: number | null): string | null;                     // C2, mag ≤ ~6.5
export function radiusVsEarth(radiusKm: number): { ratio: number; label: string };                 // C4
export function orbitInHumanTerms(periodDays: number, semiMajorAxisAu: number): string;            // C5
export function habitableZoneHint(semiMajorAxisAu: number, bv: number | null): string | null;      // C5 (null when insufficient data)
export function spectralTint(bv: number | null): string | null; // C7 → CSS color string
```

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
  - **V3 View drawer:** one surface consolidating exposure, overlays, labels, cinematic,
    auto-hide; existing stores only (`app-state` untouched). Old scattered controls removed.
  - **V2:** auto-hide preference persisted (existing safe-storage util in app glue).

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
4. **E2E — View drawer:** open drawer via role locator; toggle overlays + exposure from
   it; assert `__cosmos.overlays` reflects the change; assert the old scattered controls
   are gone.
5. **Perf/bundle:** existing bundle-size gate stays green with any added font assets;
   no new per-frame React renders (existing §5.12 discipline).
6. Visual identity screenshots: reference-machine only (`!process.env.CI`).

## Deliverables

- `packages/ui/src/astro-derive.ts` + tests; InfoPanel card redesign + updated tests
- `packages/ui/src/ViewDrawer.tsx` + tests; removal of superseded control mounts
- `packages/ui/src/ui.css` token extensions; font assets (if any) + `ATTRIBUTIONS.md` entry
- `apps/web` wiring: drawer mount, auto-hide preference, spectral-tint variable plumbing
- e2e spec `e2e/tests/perception-cards.spec.ts`

## Context Files

- `docs/research/ui-ux-perception-and-polish.md` (§6, §7, §9–§12)
- `docs/research/navigation-ux.md` (C3 copy rationale; host-star items are the OTHER lane)
- `packages/ui/src/InfoPanel.tsx`, `packages/ui/src/ui.css`, `packages/ui/src/Dock.tsx`
- `apps/web/src/styles.css` (TASK-029 bookmark override debt — resolve placement here if trivial)
- `docs/testing-conventions.md`
