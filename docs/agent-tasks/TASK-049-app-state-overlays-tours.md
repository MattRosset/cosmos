# Task: `app-state` v3 — tour store + overlay store

**ID:** TASK-049
**Target package:** `packages/app-state`
**Size:** S
**Phase:** 4 — lane (state)
**Depends on:** TASK-042

## Goal

Add the two Zustand stores the educational overlay + cinematic features need
(architecture §5.12): `useTourStore` (the active guided tour + playback position) and
`useOverlayStore` (which overlays are on — constellations, labels, cinematic). This is an
**additive** extension; the existing stores (`useSelectionStore`, `useSettingsStore`,
`useTimeStore`, `useBookmarkStore`, `useHistoryStore`) and the event bridge are unchanged.

## Frozen Interface

```ts
import type { Tour } from '@cosmos/core-types';

// ── useTourStore (NOT persisted — a tour is an in-session activity) ───────────
export interface TourState {
  /** The running tour, or null when none is active. */
  readonly active: Tour | null;
  /** Index of the current step in active.steps; 0 when active, -1 when none. */
  readonly stepIndex: number;
  readonly playing: boolean;   // false ⇒ paused
  start(tour: Tour): void;     // sets active, stepIndex 0, playing true
  next(): void;                // advance; stops at the last step (clamps)
  prev(): void;                // clamp at 0
  setPlaying(playing: boolean): void;
  stop(): void;                // active=null, stepIndex=-1, playing=false
}
export const useTourStore: UseBoundStore</* StoreApi<TourState> */>;

// ── useOverlayStore (persisted — user preference) ─────────────────────────────
export interface OverlayState {
  readonly constellations: boolean; // default false
  readonly labels: boolean;         // default false
  readonly cinematic: boolean;      // default false (letterbox/chrome-hide)
  setConstellations(on: boolean): void;
  setLabels(on: boolean): void;
  setCinematic(on: boolean): void;
}
export const useOverlayStore: UseBoundStore</* StoreApi<OverlayState> */>;
```

## Inputs / Outputs

- **Inputs:** `Tour` objects (from the app's tour definitions); boolean toggles from `ui`.
- **Outputs:** reactive store state consumed by `ui` (TASK-050) and the app glue
  (TASK-052) that drives `nav` cinematic playback.

## Constraints & Forbidden Actions

- **Additive only.** Do not change existing stores, their persisted keys/versions, or the
  event bridge. Existing `app-state` tests pass unmodified.
- No Three.js, no `sim-time` import (stores are deterministic; caller supplies time) —
  the existing boundary rules.
- `useOverlayStore` is **persisted** (zustand `persist` + the existing safe-localStorage
  shim) under a NEW key `cosmos.overlay`, **version 1** with a migration stub from day one
  (the bookmark/history precedent). `useTourStore` is **not** persisted (a tour is a live
  activity, not a saved preference).
- No per-frame data: tour/overlay state changes on user action only, not per frame.
- No new dependencies.

## Common Mistakes (architecture §5.12)

- Persisting the tour store — a half-finished tour should not resurrect on reload; only
  the overlay *preferences* persist.
- Subscribing HUD/Canvas to per-frame data — these stores are low-frequency (toggles +
  step changes); nothing here updates per frame.
- Reusing an existing persisted key — use a fresh `cosmos.overlay` key with a v1
  migration so a future shape change is safe.
- Advancing `next()` past the last step — clamp (the app decides whether to `stop()` at
  the end).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/app-state test` — new `test/tour-store.test.ts`,
   `test/overlay-store.test.ts`:
   - `useTourStore`: `start(tour)` ⇒ `active===tour, stepIndex===0, playing===true`;
     `next()` advances and **clamps** at the last step; `prev()` clamps at 0; `stop()`
     resets to `active===null, stepIndex===-1, playing===false`; `setPlaying(false)`
     pauses.
   - `useOverlayStore`: defaults all false; setters flip the right field; state persists
     to the `cosmos.overlay` localStorage key (assert the persisted blob) and rehydrates;
     a v1 migration function exists.
   - **Existing stores untouched:** all existing `app-state` tests pass unmodified.
2. `pnpm verify` exits 0 (boundary lint unchanged; coverage ≥ existing threshold).

## Deliverables

- `packages/app-state/src/tour-store.ts`, `src/overlay-store.ts`,
  `src/index.ts` (additive re-exports)
- `packages/app-state/test/tour-store.test.ts`, `test/overlay-store.test.ts`
- `packages/app-state/README.md` (a "Tours & overlays (Phase 4)" section)

## Context Files

- `packages/core-types/src/tour.ts` (`Tour`, `TourStep` — TASK-042)
- `packages/app-state/README.md` + `src/` (the `useBookmarkStore`/`useHistoryStore`
  persisted-store pattern with version + migration + the safe-localStorage shim to reuse;
  the non-persisted `useSelectionStore` pattern for the tour store)
- `docs/architecture.md` §5.12 (HUD/app-state responsibilities, tours, persistence rules)
