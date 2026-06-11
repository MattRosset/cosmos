# @cosmos/ui

React HUD components for the Cosmos explorer: a keyboard-driven search palette and a selected-star info panel.

## Components

### `SearchPalette`

A keyboard-driven search palette that queries a `BodyLookupAdapter`.

**Props:**
- `adapter: BodyLookupAdapter` — data source (injected by the app)
- `onGoTo(id: BodyId): void` — called on Enter or click; the app handles selection and fly-to

**Keyboard shortcuts:**
- `Ctrl+K` or `/` (when no input is focused) — opens the palette
- `Esc` — closes without selecting
- `↑` / `↓` — move the highlighted result (wraps around)
- `Enter` — calls `onGoTo` with the highlighted result's id and closes

Renders **nothing** while closed. Shows at most 12 results with an 80 ms input debounce.

### `InfoPanel`

Subscribes to `useSelectionStore` from `@cosmos/app-state`. Hidden when no body is selected.

**Props:**
- `adapter: BodyLookupAdapter` — used to look up the selected star's record
- `onGoTo(id: BodyId): void` — called by the "Go to" button

Displays: name (or id as fallback), distance from Sol in parsecs and light-years (3 significant digits, 1 pc = 3.26156 ly), absolute magnitude, B–V color index with spectral class, and HIP number (for `hyg:*` ids).

### `spectralClassFromBV(bv: number)`

Pure function exported for testing. Maps a B–V color index to an approximate main-sequence spectral class:

| B–V range     | Class |
|---------------|-------|
| `< 0.0`       | B     |
| `[0.0, 0.3)`  | A     |
| `[0.3, 0.58)` | F     |
| `[0.58, 0.81)`| G     |
| `[0.81, 1.40)`| K     |
| `≥ 1.40`      | M     |

## Pointer-events contract

These panels use `pointer-events: auto` on their root elements so they capture clicks and keyboard events. The **app** is responsible for wrapping all HUD panels in a shared overlay container styled with `pointer-events: none`, preventing the overlay from blocking the 3D canvas beneath it:

```css
/* app-level */
.hud-overlay {
  pointer-events: none;
  position: fixed;
  inset: 0;
  z-index: 80;
}
```

```html
<!-- app-level HTML -->
<div class="hud-overlay">
  <!-- panels mount here; each has pointer-events: auto -->
</div>
```

Import `@cosmos/ui/ui.css` in the app entry point for the default panel styles.

## Boundaries

- **No Three.js** — enforced by ESLint (`packages/ui/**` rule).
- No fetch or `@cosmos/data` imports — all data flows through the injected `BodyLookupAdapter`.
- No per-frame data — components subscribe only to `useSelectionStore` (low-frequency selection state).
