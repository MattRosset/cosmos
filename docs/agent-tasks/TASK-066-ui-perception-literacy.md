# Task: `ui` perception v1 — literacy: human units, mode badge, hints

**ID:** TASK-066
**Target package:** `packages/ui` (+ thin wiring in `apps/web`)
**Size:** M
**Phase:** Perception track (post-4a; not a roadmap phase)
**Depends on:** TASK-053 (Phase 4a gate), TASK-061 (App.tsx decomposition — this task edits
the HUD modules 061 creates; do not run against the monolithic `App.tsx`). Serialize with
TASK-065 (both touch `apps/web`).

Source research: [`../research/ui-ux-perception-and-polish.md`](../research/ui-ux-perception-and-polish.md)
§3, §4.3, §5, §7.2 — **Phase 1 items: strings module, S1, S2, S5, D1, D7, D8, W4, V1.**
Read the research doc before starting; the IDs below refer to its proposal tables.

## Goal

A first-time user can answer "what scale am I at, how fast am I moving, and why does WASD
barely move at galactic vantage?" from on-screen copy alone. Concretely: the speed readout
shows km/s alongside context units; a movement-mode badge distinguishes threshold-gated
scale jumps from free exploration; InfoPanel leads with light-years + light-travel time
(pc demoted to a detail row); search results and InfoPanel show an `@ c` ETA; a
scale-aware hint explains near-static WASD at Milky Way vantage; the permanent help wall
is replaced by a one-time first-run overlay teaching the three movement modes, collapsing
to a `?` in the dock. All user-facing perception copy lives in one strings module.

## Frozen Interface

This task is **read-only** against nav, core-types, app-state, and scene-host. It may NOT
modify any of them. It consumes (from the app glue's `controllerHolder`, on the existing
rAF loop — never per-frame React state):

```ts
// @cosmos/nav — READ ONLY
interface FlightState {
  readonly position: UniversePosition;
  readonly orientation: readonly [number, number, number, number];
  readonly speedUnitsPerS: number;
}
interface FlightController {
  readonly state: FlightState;
  readonly goToActive: boolean;
  readonly contextId: ContextId;
  onGoToEnd(cb: (completed: boolean) => void): () => void; // returns unsubscribe
  // ...rest unused by this task
}

// @cosmos/core-types — READ ONLY
type ContextId = 'universe' | 'galaxy' | 'system' | 'planet';
const CONTEXT_UNIT_METERS: Record<ContextId, number>; // universe 1 Mpc, galaxy 1 pc, system 1 AU, planet 1 km
```

New public surface added to `@cosmos/ui` (additive; this is the sanctioned `ui` v4 thaw):

```ts
// packages/ui/src/format.ts — pure, unit-tested, no DOM
export function formatSpeedKmS(speedUnitsPerS: number, contextId: ContextId): string;
export function formatLightTravel(distanceLy: number): string;   // "4.2 years" / "8.6 light-minutes"
export function formatEtaAtC(distanceLy: number): string;        // "at c: 4.2 years"
export function formatCrossingTime(speedUnitsPerS: number, contextId: ContextId, spanM: number): string; // D7

// packages/ui/src/strings.ts — ALL new perception copy, English, one module
export const STRINGS: Readonly<Record<string, string>>;
```

Component additions (`ModeBadge`, first-run overlay, InfoPanel copy changes) follow the
existing `packages/ui` React-only conventions; exact prop shapes are the agent's choice
but must be driven by props/adapters, never by importing nav or three.js.

## Inputs / Outputs

- **Inputs:** live `FlightController` read surface via the app's existing rAF readout loop
  (see `SpeedReadout` — imperative DOM writes, §5.12); selected-body distance fields
  already passed to `InfoPanel` (`distPc`); search result rows' distance data.
- **Outputs (behavioral):**
  - Speed readout: `"3.2 pc/s · 9.9×10⁴ km/s"` (context unit first, km/s second). km/s
    from `speedUnitsPerS × CONTEXT_UNIT_METERS[contextId] / 1000`. **No ×c in free
    flight** — ×c is reserved for the Jump HUD (TASK-067) and the `?` glossary, per the
    research doc's §3.3 honesty decision.
  - Mode badge: `"Scale jump"` only while `goToActive` **and** the jump's target distance
    (snapshotted at `goTo` start by the glue) ≥ `SCALE_JUMP_THRESHOLD_PC = 100` (export the
    constant; TASK-067 reuses it). Short flights: no badge. WASD moving: `"Exploring"`.
    Tour active: badge hidden (tour chrome owns the screen).
  - InfoPanel star distance: primary line `"N ly — light takes N years to reach us"`;
    pc moved to a secondary detail row. Planet cards unchanged (TASK-068).
  - `@ c` ETA line on InfoPanel + SearchPalette rows: `formatEtaAtC`.
  - D7/D8 hint at galactic vantage (contextId `galaxy` + camera beyond a named distance
    constant): dim single line, e.g. crossing-time copy + *"use ◂ Galaxy to descend"*.
  - V1: first-run overlay (localStorage key `cosmos.firstrun.v1`), content = the three-mode
    taxonomy (research §5.1), collapses to `?` dock button; the permanent top-left help
    text and build stats (`M4a — N stars`) are removed from the production HUD (build
    stats behind a dev flag).
  - A11y (S5): readout container gets a throttled `aria-live="polite"` mirror updated at
    most every ~3 s; remove `aria-hidden="true"`.

## Constraints & Forbidden Actions

- Do not modify `packages/core-types`, `packages/nav`, `packages/scene-host`,
  `packages/app-state` — **zero nav-law changes; this is the perception lane.**
- Do not change `goTo` durations, thresholds, hysteresis, or free-flight speed.
- No new dependencies.
- `packages/ui` never imports Three.js; render packages never import React (boundary lint).
- No per-frame React re-renders: readout/badge/hint follow the existing imperative-DOM rAF
  pattern or ≤10 Hz store updates (research §11 criterion 8).
- No allocations inside the rAF readout callback (format only when the displayed string
  would change, as `SpeedReadout` does today).
- All new user-facing copy goes through `strings.ts` — no scattered literals.
- Do not remove or rename existing `ui` exports (additive thaw only).

## Common Mistakes (architecture §5.12 — HUD)

- Putting HUD state in React state updated per frame — drives full-tree re-renders; use
  refs + imperative DOM writes on rAF, or throttled stores.
- Reading nav state via polling `useEffect` timers instead of the existing rAF loop.
- Re-deriving camera/projection math in the HUD instead of asking the controller/test-hook.
- Coupling `packages/ui` components to app glue types — pass plain props/adapters.

## Acceptance Tests

The task is DONE only when these pass in CI (`pnpm verify` + `pnpm test:e2e`):

1. **Vitest (`packages/ui`)** — table tests for `formatSpeedKmS`, `formatLightTravel`,
   `formatEtaAtC`, `formatCrossingTime`: unit conversion per context (galaxy pc/s → km/s,
   system AU/s → km/s), rounding, and order-of-magnitude sanity (assert invariants, not
   incidental digits).
2. **E2E — mode badge:** drive a breadcrumb `viewGalaxy` jump (existing `__cosmos` /
   role locators); assert badge text is the `strings.ts` scale-jump label while
   `__cosmos.goToActive === true` and disappears after `onGoToEnd` (query the hook —
   never infer from timing). Then drive a short in-system fly and assert the scale-jump
   label does NOT appear.
3. **E2E — InfoPanel copy:** select a known star (search palette, `getByRole`); assert the
   distance line contains `ly` and a light-travel phrase before any `pc` text, and an
   `at c` ETA line exists. Log the star id + displayed strings (CI-triagable, conventions §6).
4. **E2E — first-run:** fresh context shows the three-mode overlay once; after dismissal +
   reload it does not reappear and the `?` dock button restores it. Assert the permanent
   HUD no longer contains build stats text in production mode.
5. **A11y:** assert the readout region has `aria-live="polite"` and no `aria-hidden`.
6. No hard-coded pixel/font geometry anywhere (conventions rule 2); no screenshot gates in CI.

## Deliverables

- `packages/ui/src/format.ts` + `packages/ui/test/format.test.ts`
- `packages/ui/src/strings.ts`
- `packages/ui/src/ModeBadge.tsx` (+ test), InfoPanel copy changes + updated tests
- First-run overlay component + `?` dock entry (`packages/ui`)
- `apps/web` wiring: readout module (post-061 location of `SpeedReadout`), badge/hint
  mount, first-run flag, dev-flag for build stats; `styles.css` additions
- e2e spec `e2e/tests/perception-literacy.spec.ts`

## Context Files

- `docs/research/ui-ux-perception-and-polish.md` (§0–§5, §7.2, §9, §11)
- `docs/research/navigation-ux.md` (§2.3 overlap table — do NOT duplicate data-lane fixes)
- `packages/ui/README.md`, `packages/ui/src/InfoPanel.tsx`, `packages/ui/src/Dock.tsx`
- `apps/web/src/App.tsx` `SpeedReadout` (or its post-TASK-061 module) — the rAF pattern to reuse
- `packages/nav/src/controller.ts` (read surface only), `packages/core-types/src/coords.ts`
- `docs/testing-conventions.md`, `apps/web/src/glue/test-hook.ts`
