# Task: `ui` v2 — time controls, bookmarks/history panel, planet info

**ID:** TASK-026
**Target package:** `packages/ui`
**Size:** M
**Phase:** 2 — lane K (HUD; after the stores exist)
**Depends on:** TASK-025

## Goal

The sanctioned Phase-2 thaw of `ui` (additions below; SearchPalette/InfoPanel keep
their exact Phase 1 behavior except the explicit InfoPanel extension): `TimeControls`
(pause + signed acceleration stepper + epoch readout, §5.4 UI), `BookmarksPanel`
(capture/list/fly-to/delete bookmarks + exploration-history tab, §5.12), and
`InfoPanel` support for planet records now that `BodyLookupAdapter` can return
planets. Still React-only — no Three.js, no fetch, no `@cosmos/data`; everything
flows through the injected adapter, the `app-state` stores, and callback props.

## Frozen Interface (additions to @cosmos/ui — existing API unchanged)

```ts
import type { BodyId, BodyRecord, BookmarkRecord } from '@cosmos/core-types';

// types.ts — CHANGED (sanctioned): adapter now returns any BodyRecord
export interface BodyLookupAdapter {
  getBody(id: BodyId): BodyRecord | undefined;   // was StarRecord-only
  search(query: string, max?: number): BodyRecord[];
}

export interface TimeControlsProps {
  /** Optional: "sync to now" button handler. Hidden when absent. */
  readonly onSyncToNow?: () => void;
}
/** Reads/writes useTimeStore from @cosmos/app-state. */
export function TimeControls(props: TimeControlsProps): JSX.Element;

/** Pure, exported for tests: epochJD → "2026-06-12 14:05 UTC" (UTC, minutes). */
export function formatEpochJD(epochJD: number): string;

export interface BookmarksPanelProps {
  /** Returns a COMPLETE BookmarkRecord (id, createdAtIso, camera snapshot built
   *  by the app) for the current view, or null when capture is impossible. The
   *  panel adds it to useBookmarkStore. The panel supplies the user-typed name. */
  readonly onCapture: (name: string) => BookmarkRecord | null;
  readonly onGoToBookmark: (bookmark: BookmarkRecord) => void;
  /** History tab row click. */
  readonly onGoToBody: (id: BodyId) => void;
  readonly adapter: BodyLookupAdapter; // resolves history ids → display names
}
export function BookmarksPanel(props: BookmarksPanelProps): JSX.Element;
```

## Fixed UX spec (transcribe, don't redesign)

- **TimeControls** (compact bar, bottom-center by default stylesheet):
  - Buttons, left → right: `⏪` (cycle |accel| UP through `ACCEL_STEPS` with sign
    forced negative), `⏸`/`▶` toggle (aria-label "Pause"/"Resume"),
    `⏩` (cycle UP positive), text button `1×` (reset accel to 1, forward), and the
    optional `Now` button (`onSyncToNow`).
  - Stepper law: pressing ⏩ when accel is positive moves to the next larger
    `ACCEL_STEPS` entry (saturate at 1e7); pressing ⏩ when accel is negative
    resets to `+1`. Mirror-image for ⏪. Display the factor as `−10 000×` style
    grouped text next to the epoch readout.
  - Epoch readout: `formatEpochJD(epochJD)` — conversion:
    `unixMs = (epochJD − 2440587.5) × 86_400_000`, render via
    `new Date(unixMs).toISOString()` sliced to `YYYY-MM-DD HH:MM` + " UTC".
    (Duplicating this one-line formula is sanctioned — `ui` must not import
    `sim-time`.)
  - Subscribes to `useTimeStore` only (≤ 4 Hz epoch — no per-frame data, §5.12).
- **BookmarksPanel** (right-side panel, toggled by a `🔖` button rendered by the
  panel itself; hidden state renders only the toggle button):
  - Two tabs: **Bookmarks** / **History**.
  - Bookmarks tab: name input + "Save view" button → `onCapture(name)`; null
    return → inline error "Can't bookmark here". Rows: name, `createdAtIso`
    date, fly-to (calls `onGoToBookmark`), rename (inline), delete. Store
    operations go through `useBookmarkStore` actions only.
  - History tab: rows from `useHistoryStore` newest-first — display name via
    `adapter.getBody(id)?.name ?? id`, click → `onGoToBody(id)`. "Clear" button.
- **InfoPanel extension:** when the selected record is a `PlanetRecord`: show
  name (fallback id), "Planet" tag, radius (km, grouped), parent body name via
  `adapter.getBody(parentId)`, and — when `elements` present — semi-major axis
  (AU, 3 sig figs), eccentricity (2 decimals), and orbital period
  `2π·√((a·1.495978707e8)³/μ)` rendered in days when < 1000 days else years
  (3 sig figs). Star records render exactly as in Phase 1 (existing tests
  unmodified). `kind: 'galaxy'` → name + "Galaxy" tag only.
- All new roots follow the pointer-events contract: `pointer-events: auto` on the
  panel root, app owns the `pointer-events: none` overlay (README contract).
- Keyboard: panel buttons are real `<button>`s (a11y smoke per §5.12); `Esc`
  closes the BookmarksPanel when open and focus is inside it.

## Inputs / Outputs

- **Inputs:** mocked adapter + the real `app-state` stores (reset between tests).
- **Outputs:** e.g. select `sol:saturn` → InfoPanel shows "Saturn", radius
  58 232 km, parent "Sol", a ≈ 9.54 AU, period ≈ 29.4 years.

## Constraints & Forbidden Actions

- **No Three.js** (lint-enforced), no fetch, no `@cosmos/data`, no `sim-time`,
  no `coords` — adapter + stores + callbacks only.
- Existing `SearchPalette`/`InfoPanel`/`spectralClassFromBV` behavior for STARS is
  frozen: all TASK-012 tests pass UNMODIFIED (the adapter type widening must be
  backward-compatible — `StarRecord` is a `BodyRecord`).
- No per-frame subscriptions; no `setInterval` polling in components (the store
  IS the throttle).
- `Math.random()` banned; ids/timestamps come from props/stores, never generated
  in `ui`.
- No new dependencies.

## Common Mistakes (architecture §5.12 — copy kept verbatim)

- Subscribing HUD components to per-frame data (camera position readout must be
  throttled to ~10 Hz via a transient store outside React state).
- Blocking the canvas with full-screen DOM overlays that eat pointer events
  (`pointer-events: none` on the overlay root, opt-in per panel).
- Plus: importing `sim-time` for date formatting (boundary: duplicate the
  one-liner); writing `epochJD` from the component (it's read-only here — only
  the glue calls `syncEpochJD`).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/ui test` (Vitest + @testing-library/react, jsdom):
   - `formatEpochJD(2451545.0) === '2000-01-01 12:00 UTC'`; J2000 + 0.5 day →
     `'2000-01-02 00:00 UTC'`.
   - TimeControls: ⏸ toggles store `paused`; ⏩ from 1 → 10 → … → 1e7 (saturates);
     ⏪ from +100 → −1; `1×` resets; `Now` hidden without prop, fires with it;
     epoch readout re-renders on `syncEpochJD`.
   - BookmarksPanel: capture happy path adds the record returned by `onCapture`
     (spy receives the typed name); null capture shows the error and adds
     nothing; fly-to/delete/rename wired to store + props; History tab lists
     newest-first with resolved names, click fires `onGoToBody`, Clear empties;
     Esc closes.
   - InfoPanel: Saturn fixture renders radius/parent/a/e/period (period
     formatter unit-tested: a = 9.5826 AU, μ = 1.32712440018e11 → ≈ 29.4 yr);
     planet without `elements` renders without the orbit block; star rendering
     snapshot unchanged; galaxy fixture renders name + tag.
   - a11y smoke: every interactive element reachable by role/name queries
     (`getByRole('button', { name: … })`).
   - All TASK-012 suites green, unmodified.
2. **Coverage gate:** unchanged from TASK-012 (do not lower thresholds).
3. `pnpm verify` exits 0 (boundary lint: no Three.js import).

## Deliverables

- `packages/ui/src/TimeControls.tsx`, `src/BookmarksPanel.tsx`,
  `src/format.ts` (formatEpochJD + period formatter, pure),
  `src/InfoPanel.tsx` (planet branch), `src/types.ts` (adapter widening),
  `src/index.ts` (export additions), `src/ui.css` (new panel styles appended)
- `packages/ui/test/TimeControls.test.tsx`, `test/BookmarksPanel.test.tsx`,
  `test/format.test.ts`, `test/InfoPanel.test.tsx` (extended)
- `packages/ui/README.md` (additions documented; keep < 150 lines)

## Context Files

- `docs/architecture.md` §5.4 (time controls behavior), §5.12 (HUD scope,
  pointer-events contract)
- `packages/ui/src/InfoPanel.tsx`, `src/types.ts`, `src/ui.css` (style to match)
- `packages/app-state/src/time.ts`, `src/bookmarks.ts`, `src/history.ts`
  (from TASK-025 — the binding store APIs)
- `packages/core-types/src/bookmarks.ts`, `src/bodies.ts`
