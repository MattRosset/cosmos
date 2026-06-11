# @cosmos/app-state

Zustand stores for selection and settings state, plus a one-way bridge from the
selection store to the typed event bus.

## Stores

### `useSelectionStore`

Holds the currently selected body (`BodyId | null`). Standard zustand — usable as a
React hook or via `useSelectionStore.getState()` in vanilla code.

```ts
// React
const selectedId = useSelectionStore((s) => s.selectedId);
useSelectionStore.getState().select('hyg:32263');

// Vanilla
const { selectedId, select } = useSelectionStore.getState();
```

### `useSettingsStore`

Holds UI settings. Currently: `exposure` — star-field brightness multiplier, clamped
to [0.1, 10]. Default 1.

```ts
useSettingsStore.getState().setExposure(2.5);
```

## Event bridge

`bindSelectionToBus(bus)` mirrors every `selectedId` change onto the event bus as a
`selection/changed` event. Deduplicated — setting the same id twice emits once.
Returns an unsubscribe function.

```ts
import { createEventBus } from '@cosmos/core-types';
import { bindSelectionToBus } from '@cosmos/app-state';

const bus = createEventBus();
const unsub = bindSelectionToBus(bus);

bus.on('selection/changed', ({ id }) => console.log('selected:', id));
```

The bridge is one-way: store → bus. Scene glue subscribes to the bus and must never
import React or these stores directly.

## Boundaries

- No Three.js imports (UI-side package, architecture §4).
- No persistence — `localStorage`/IndexedDB is Phase 2 scope.
- No per-frame data — only low-frequency selection and settings state.
