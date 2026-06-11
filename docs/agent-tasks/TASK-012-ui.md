# Task: `ui` v1 — search palette + selected-star info panel

**ID:** TASK-012
**Target package:** `packages/ui` (new)
**Size:** M
**Phase:** 1 — lane C (state/UI)
**Depends on:** TASK-011

## Goal

The two M1 HUD components of architecture §5.12, built and tested against a **mocked
search adapter** (lane C never waits for the data lane): a keyboard-driven search
palette (fuzzy-ish name search, fly-to on Enter) and an info panel showing the selected
star's educational data. React only — Three.js is lint-banned here; everything 3D
arrives through props and the app-state stores.

## Frozen Interface

```ts
// public API of @cosmos/ui
import type { JSX } from 'react';
import type { BodyId, StarRecord } from '@cosmos/core-types';

/** Injected by the app (TASK-015 passes the real @cosmos/data source). */
export interface BodyLookupAdapter {
  search(query: string, maxResults?: number): readonly StarRecord[];
  getBody(id: BodyId): StarRecord | null;
}

export interface SearchPaletteProps {
  readonly adapter: BodyLookupAdapter;
  /** Called on Enter/click of a result: the app selects AND flies to it. */
  onGoTo(id: BodyId): void;
}
/** Opens on Ctrl+K or "/" (when no input focused); Esc closes; ↑/↓ + Enter navigate.
 *  Renders nothing while closed. Max 12 results, 80 ms input debounce. */
export function SearchPalette(props: SearchPaletteProps): JSX.Element;

export interface InfoPanelProps {
  readonly adapter: BodyLookupAdapter;
  onGoTo(id: BodyId): void;
}
/** Subscribes to useSelectionStore. Hidden when nothing selected. Shows: name (or
 *  id), distance from Sol in pc AND light-years (1 pc = 3.26156 ly), absolute
 *  magnitude, B–V with approximate spectral class, HIP number if present, a "Go to"
 *  button (→ onGoTo) and a close button (→ select(null)). */
export function InfoPanel(props: InfoPanelProps): JSX.Element;

/** B–V → approximate main-sequence spectral class (exported for tests).
 *  Fixed table: bv < 0.0 → 'B'; [0.0, 0.3) → 'A'; [0.3, 0.58) → 'F';
 *  [0.58, 0.81) → 'G'; [0.81, 1.40) → 'K'; ≥ 1.40 → 'M'. */
export function spectralClassFromBV(bv: number): 'B' | 'A' | 'F' | 'G' | 'K' | 'M';
```

Styling: components ship semantic class names (`cosmos-ui-palette`, `cosmos-ui-info`,
…) and one `src/ui.css` imported by the app (TASK-015). Root overlay rule per §5.12:
panels themselves are `pointer-events: auto`; the shared overlay container the app
provides is `pointer-events: none` — document this contract in the README.

## Inputs / Outputs

- **Inputs:** mocked adapter in tests, e.g. returning fixtures
  `[{ id: 'hyg:32263', kind: 'star', name: 'Sirius', positionPc: [-1.8, -1.9, -0.4], absMag: 1.45, colorIndexBV: 0.009 }]`.
- **Outputs:** DOM + callbacks. Example: select `hyg:32263` in the store → panel shows
  "Sirius", "2.64 pc / 8.6 ly", "A" class.

## Constraints & Forbidden Actions

- Do not modify `core-types` or `app-state`.
- Allowed dependencies: `react`, `@cosmos/core-types`, `@cosmos/app-state`;
  devDependencies `@testing-library/react`, `@testing-library/user-event`, `jsdom`.
  **No Three.js** (lint-enforced), no fetch, no `@cosmos/data` import — the adapter
  interface exists precisely so this lane is mock-testable (§8.3 lane c).
- Distance shown is from Sol = `|positionPc|` (Phase 1 convention: galaxy origin is
  the Sun — TASK-007). Format: 3 significant digits.
- Keyboard a11y is mandatory: palette is fully operable without a mouse; panel close
  reachable via keyboard; sensible roles/labels (`role="dialog"`, `role="listbox"`,
  `aria-selected`).
- The "/" hotkey must NOT fire while focus is in an input/textarea/contenteditable.

## Common Mistakes (architecture §5.12 — copy kept verbatim)

- Subscribing HUD components to per-frame data (camera position readout must be
  throttled… outside React state) — these components subscribe only to selection.
- Blocking the canvas with full-screen DOM overlays that eat pointer events
  (`pointer-events: none` on the overlay root, opt-in per panel).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/ui test` (Vitest + jsdom + testing-library):
   - Palette: closed by default; Ctrl+K opens; "/" opens except when an input is
     focused; typing queries the adapter (debounced — fake timers); ↑/↓ moves the
     highlighted row with wraparound; Enter calls `onGoTo` with the highlighted id and
     closes; Esc closes without calling.
   - Palette renders at most 12 results and shows a "no matches" state.
   - InfoPanel: hidden when `selectedId === null`; selecting a fixture star renders
     name, pc + ly (3 sig figs), absMag, spectral class, HIP; "Go to" calls `onGoTo`;
     close calls `select(null)`; selecting an id the adapter can't resolve renders a
     safe fallback (id only), no crash.
   - `spectralClassFromBV` boundary cases (exact table edges).
   - a11y smoke: palette dialog has a label; full keyboard flow open→type→Enter works
     via `user-event` keyboard only.
2. `pnpm verify` exits 0 (boundary lint: no `three` anywhere in the package).

## Deliverables

- `packages/ui/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/ui/src/SearchPalette.tsx`, `src/InfoPanel.tsx`, `src/spectral.ts`,
  `src/ui.css`, `src/index.ts`
- `packages/ui/test/SearchPalette.test.tsx`, `test/InfoPanel.test.tsx`,
  `test/spectral.test.ts`
- `packages/ui/README.md` (< 150 lines; documents the pointer-events contract)

## Context Files

- `docs/architecture.md` §5.12 (whole section), §4 (ui boundary), §8.3 (lane c)
- `packages/app-state/README.md` (from TASK-011)
- `packages/core-types/src/bodies.ts`
