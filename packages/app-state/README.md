# @cosmos/app-state

Zustand stores for selection, settings, time, bookmarks, and exploration history,
plus a one-way bridge from the selection store to the typed event bus.

## Stores

### `useSelectionStore`

Currently selected body (`BodyId | null`).

```ts
useSelectionStore.getState().select('hyg:32263');
```

### `useSettingsStore`

UI settings: `exposure` (star-field brightness, [0.1, 10], default 1).

### `useTimeStore`

Simulation time state: `paused`, `accel` (±1e7), `epochJD` (display copy, throttled
≤ 4 Hz, NOT persisted). The glue from `sim-time` calls `syncEpochJD`.

```ts
useTimeStore.getState().setPaused(true);
useTimeStore.getState().setAccel(1000); // 1000× speed
```

### `useBookmarkStore` (persisted)

User bookmarks: `{ id, name, position, orientation, epochJD, anchorSystemId }`.
Persisted to `localStorage` under `cosmos.bookmarks` with version 1 migration.

```ts
useBookmarkStore.getState().add({ id: 'b1', name: 'Saturn ringside', ... });
useBookmarkStore.getState().rename('b1', 'Ring time');
useBookmarkStore.getState().remove('b1');
```

### `useHistoryStore` (persisted)

Exploration history: newest-first list of visited bodies, max 50 entries, caps at 50
and dedupes consecutive visits. Persisted under `cosmos.history`, version 1.

```ts
useHistoryStore.getState().push('sirius', '2026-06-12T10:00:00Z');
```

## Tours & overlays (Phase 4)

### `useTourStore` (not persisted)

The active guided tour and playback position. A tour is an in-session activity —
reloading the page does not resurrect a half-finished tour.

```ts
useTourStore.getState().start(tour); // active=tour, stepIndex=0, playing=true
useTourStore.getState().next();      // advances; clamps at the last step
useTourStore.getState().prev();      // clamps at 0
useTourStore.getState().setPlaying(false); // pause
useTourStore.getState().stop();      // active=null, stepIndex=-1, playing=false
```

### `useOverlayStore` (persisted)

Which overlays are on: `constellations`, `labels`, `cinematic` (default false).
Persisted to `localStorage` under `cosmos.overlay` with version 1 migration.

```ts
useOverlayStore.getState().setConstellations(true);
useOverlayStore.getState().setLabels(true);
useOverlayStore.getState().setCinematic(true);
```

## Event bridge

`bindSelectionToBus(bus)` emits `selection/changed` on every selection change.

## Boundaries

- No Three.js, no `sim-time` imports (stores are deterministic; caller supplies time).
- No per-frame data: `epochJD` is glue-throttled ≤ 4 Hz.
- Persistence: zustand `persist` middleware + safe localStorage shim (works offline).
