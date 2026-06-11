# Task: `app-state` v1 — selection + settings stores, event-bus bridge

**ID:** TASK-011
**Target package:** `packages/app-state` (new)
**Size:** S
**Phase:** 1 — lane C (state/UI)
**Depends on:** TASK-007

## Goal

The Zustand layer of architecture §5.12, minimal Phase 1 cut: a selection store and a
settings store, plus the one-way bridge that mirrors selection changes onto the typed
event bus (`selection/changed`) so non-React modules (scene glue) can react without
importing React. Bookmarks, history, and tours are Phase 2+ — do not scaffold them.

## Frozen Interface

```ts
// public API of @cosmos/app-state
import type { BodyId, EventBus } from '@cosmos/core-types';
import type { StoreApi, UseBoundStore } from 'zustand';

export interface SelectionState {
  readonly selectedId: BodyId | null;
  select(id: BodyId | null): void;
}

export interface SettingsState {
  /** Star-field exposure multiplier, [0.1, 10]. Default 1. */
  readonly exposure: number;
  setExposure(exposure: number): void;
}

/** React hooks AND vanilla access (useSelectionStore.getState()) — standard zustand. */
export const useSelectionStore: UseBoundStore<StoreApi<SelectionState>>;
export const useSettingsStore: UseBoundStore<StoreApi<SettingsState>>;

/**
 * Mirror store → bus: emits 'selection/changed' on every selectedId change
 * (deduplicated — same id twice emits once). One direction only; the store is the
 * source of truth. Returns an unsubscribe function.
 */
export function bindSelectionToBus(bus: EventBus): () => void;
```

## Inputs / Outputs

- **Inputs:** store actions from UI/scene glue.
- **Outputs:** state via hooks/`getState()`; `selection/changed` events, e.g.
  `select('hyg:32263')` → bus receives `{ id: 'hyg:32263' }`.

## Constraints & Forbidden Actions

- Do not modify `core-types` (the `selection/changed` event already exists — no new
  events).
- Allowed dependencies: `zustand` (new, latest 5.x — pin exact minor), `@cosmos/core-types`,
  `react` (peer, via zustand). **No Three.js** (§4: this package sits on the UI side).
- No persistence yet (`localStorage`/IndexedDB is Phase 2 bookmarks scope, §5.12).
- No per-frame data in these stores (camera readouts etc. are transient-store
  territory, §5.12 — out of scope here).
- `setExposure` clamps to [0.1, 10].

## Common Mistakes (architecture §5.12 — copy kept verbatim)

- Subscribing HUD components to per-frame data — these stores must only ever hold
  low-frequency state (selection, settings), never camera position.
- Interaction with 3D goes exclusively through store actions and the typed event bus —
  hence `bindSelectionToBus`; scene code must never be imported here.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/app-state test` (Vitest, no DOM needed):
   - select/read round-trip; `select(null)` clears.
   - `bindSelectionToBus`: emits on change with correct payload; deduplicates repeats;
     unsubscribe stops emission; works against the real `createEventBus()`.
   - `setExposure` clamps (0.01 → 0.1; 100 → 10).
2. `pnpm verify` exits 0 (boundary lint: no `three` import).

## Deliverables

- `packages/app-state/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/app-state/src/selection.ts`, `src/settings.ts`, `src/bridge.ts`,
  `src/index.ts`
- `packages/app-state/test/selection.test.ts`, `test/bridge.test.ts`
- `packages/app-state/README.md` (< 150 lines)

## Context Files

- `docs/architecture.md` §5.12 (whole section), §4 (boundaries)
- `packages/core-types/src/events.ts`, `src/bodies.ts`
