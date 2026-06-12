# Task: `app-state` v2 — time store + persisted bookmarks & history

**ID:** TASK-025
**Target package:** `packages/app-state`
**Size:** S
**Phase:** 2 — lane K (UI state)
**Depends on:** TASK-018

## Goal

The sanctioned Phase-2 thaw of `app-state` (additions only; selection/settings
stores and the bus bridge keep their exact behavior): a low-frequency time store
that the HUD's time controls write to and the sim-clock glue reads from, plus the
persisted bookmark and exploration-history stores (§5.12: versioned schema with a
migration function from day one; persistence to `localStorage` — the Phase 1
"no persistence" boundary lifts here). Stores stay free of Three.js, free of
`sim-time` imports (the glue mediates), and free of per-frame data — `epochJD`
lands here at most a few times per second, throttled by the glue.

## Frozen Interface (additions to @cosmos/app-state — existing API unchanged)

```ts
import type { BodyId, BookmarkRecord } from '@cosmos/core-types';

// ── time store ───────────────────────────────────────────────────────────────
/** HUD stepper magnitudes (×, applied with the current sign). */
export const ACCEL_STEPS: readonly number[]; // [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7]

export interface TimeState {
  readonly paused: boolean;
  /** Signed; |accel| ≤ 1e7. UI intent — the glue applies it to the SimClock. */
  readonly accel: number;
  /** Display copy of the sim epoch. Glue-throttled to ≤ 4 Hz. NOT per-frame. */
  readonly epochJD: number;
  setPaused(paused: boolean): void;
  setAccel(accel: number): void; // clamp ±1e7, ignore non-finite
  /** GLUE ONLY (documented): throttled mirror of SimClock.epochJD. */
  syncEpochJD(epochJD: number): void;
}
export const useTimeStore: UseBoundStore<StoreApi<TimeState>>;

// ── bookmarks ────────────────────────────────────────────────────────────────
export interface BookmarkState {
  readonly bookmarks: readonly BookmarkRecord[];
  /** Caller builds the complete record (id, createdAtIso included) — stores stay
   *  clock-free and deterministic. Duplicate id → replace in place. */
  add(record: BookmarkRecord): void;
  remove(id: string): void;
  rename(id: string, name: string): void;
}
export const useBookmarkStore: UseBoundStore<StoreApi<BookmarkState>>;

// ── exploration history ──────────────────────────────────────────────────────
export interface HistoryEntry {
  readonly id: BodyId;
  readonly visitedAtIso: string;
}
export interface HistoryState {
  /** Newest first, length ≤ 50. */
  readonly entries: readonly HistoryEntry[];
  /** No-op when entries[0].id === id (consecutive dedupe). */
  push(id: BodyId, visitedAtIso: string): void;
  clear(): void;
}
export const useHistoryStore: UseBoundStore<StoreApi<HistoryState>>;
```

## Persistence spec (fixed)

- Use zustand's `persist` middleware (already a dependency feature — no new deps)
  with `createJSONStorage(() => localStorage)`:
  - bookmarks: `name: 'cosmos.bookmarks'`, `version: BOOKMARKS_SCHEMA_VERSION` (1).
  - history: `name: 'cosmos.history'`, `version: 1`.
  - time store is **NOT persisted** (sim time restarts at J2000 by design).
- `migrate(persisted, version)`: version 1 → pass through after shape-validating
  each record (a hand-rolled structural check — Zod stays out of runtime packages,
  §15); any record failing validation is dropped, the rest kept; unknown future
  version → return empty state and `console.warn` once. **Never throw from
  migrate** (a corrupt localStorage entry must not kill the app).
- SSR/test safety: when `localStorage` is unavailable (Node), stores still work
  in-memory (persist's default behavior with a storage getter that may throw —
  wrap with a try/catch storage shim, documented).

## Inputs / Outputs

- **Inputs:** e.g. `useBookmarkStore.getState().add({ id: 'b1', name: 'Saturn
  ringside', createdAtIso: '2026-06-12T00:00:00Z', position: { context: 'system',
  local: [9.5, 0, 0] }, orientation: [0, 0, 0, 1], epochJD: 2451545.0,
  anchorSystemId: 'sol' })`.
- **Outputs:** state snapshots via hooks/`getState()`; serialized envelopes in
  `localStorage` under the keys above (zustand persist format, `version` field
  included).

## Constraints & Forbidden Actions

- Do not modify `selection.ts`, `settings.ts`, or `bridge.ts`; all TASK-011 tests
  pass UNMODIFIED.
- No Three.js, no `sim-time` import, no `Date.now()`/`new Date()` inside stores
  (timestamps and ids are caller-supplied — keeps stores deterministic, §8.6).
- No per-frame writes: `syncEpochJD` is documented ≤ 4 Hz glue API; nothing in
  this package may subscribe to frame callbacks.
- No new dependencies (zustand persist middleware ships with zustand).
- No new events on the bus — selection bridge stays the only bridge (the time
  glue in TASK-029 emits `time/changed` itself).

## Common Mistakes (architecture §5.12 — copy kept verbatim)

- Subscribing HUD components to per-frame data (camera position readout must be
  throttled… via a transient store outside React state) — `epochJD` here is that
  throttled copy; resist wiring it per-frame.
- Bookmarks serialize `{ universePosition, contextId, cameraOrientation,
  simEpoch }` — versioned schema with migration function from day one — the
  `BookmarkRecord` from TASK-018 IS that schema; do not invent a parallel one.
- Plus: persisting the time store (restored stale epochs confuse users — spec says
  don't); throwing on corrupt persisted JSON (must degrade to empty).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/app-state test` — new `test/time.test.ts`,
   `test/bookmarks.test.ts`, `test/history.test.ts` (jsdom, fresh mock
   localStorage per test):
   - Time: clamp at ±1e7; NaN/Infinity ignored; `ACCEL_STEPS` exact;
     `syncEpochJD` updates state without touching paused/accel.
   - Bookmarks: add/remove/rename; duplicate-id add replaces; persisted envelope
     appears under `cosmos.bookmarks` with `version: 1`; a fresh store instance
     rehydrates the same records (round-trip).
   - Migration: corrupt JSON in the key → empty state, no throw; one invalid
     record among two valid → invalid dropped, valid kept; future version (99) →
     empty + single warn (spy).
   - History: newest-first; consecutive dedupe (push A, A → 1 entry; A, B, A → 3);
     cap at 50 (push 60 → oldest dropped); `clear()`; persisted round-trip.
   - No-localStorage environment: stores construct and operate in-memory without
     throwing (delete the global in the test).
   - Existing TASK-011 suites green, unmodified.
2. **Coverage gate:** unchanged from TASK-011 (do not lower thresholds).
3. `pnpm verify` exits 0 (boundary lint: no Three.js imports).

## Deliverables

- `packages/app-state/src/time.ts`, `src/bookmarks.ts`, `src/history.ts`,
  `src/persist-util.ts` (safe storage shim + migrate helpers), `src/index.ts`
  (export additions)
- `packages/app-state/test/time.test.ts`, `test/bookmarks.test.ts`,
  `test/history.test.ts`
- `packages/app-state/README.md` (additions documented; keep < 150 lines)

## Context Files

- `docs/architecture.md` §5.12 (app-state responsibilities, bookmark schema), §11
  (persistence strategy)
- `packages/core-types/src/bookmarks.ts` (from TASK-018 — the binding schema)
- `packages/app-state/src/selection.ts`, `src/settings.ts` (store style to match)
- `docs/agent-tasks/TASK-011-app-state.md` (the frozen v1 scope this extends)
