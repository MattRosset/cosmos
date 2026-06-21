# Task: `ui` v3 — overlay toggles, screen-space label layer, guided-tour chrome

**ID:** TASK-050
**Target package:** `packages/ui`
**Size:** M
**Phase:** 4 — lane (HUD); serialized after TASK-049 (same lane)
**Depends on:** TASK-049

## Goal

Add the educational-overlay HUD (architecture §5.12): a small **overlay controls** panel
(toggle constellations / labels / cinematic), a **screen-space label layer** that draws
body name labels at app-supplied screen positions, and the **guided-tour chrome**
(title + narration card with play/pause/prev/next/exit, driven by `useTourStore`). All
**React only — no Three.js** (lint-enforced); the app supplies world→screen projections
because `ui` may not import Three.js (§5.12). Additive: the existing `SearchPalette` and
`InfoPanel` are unchanged.

## Frozen Interface

```tsx
import type { LabelRecord } from '@cosmos/core-types';

// ── Overlay controls (toggles bound to useOverlayStore) ──────────────────────
export function OverlayControls(): JSX.Element; // subscribes to useOverlayStore itself

// ── Label layer (the APP projects world→screen; ui never imports three) ───────
export interface ProjectedLabel {
  readonly id: string;
  readonly text: string;
  /** Screen-space pixel position (the app computed it from the camera). */
  readonly xPx: number;
  readonly yPx: number;
  /** Lower = more important; the layer shows the most important that fit. */
  readonly priority: number;
  /** false ⇒ behind the camera / off-screen; the layer skips it. */
  readonly visible: boolean;
}
export interface LabelLayerProps {
  /** Recomputed by the app at ≤ ~10 Hz (NOT per frame, §5.12) and passed in. */
  readonly labels: readonly ProjectedLabel[];
  /** Max labels rendered (de-cluttering); default 24. */
  readonly maxVisible?: number;
}
export function LabelLayer(props: LabelLayerProps): JSX.Element;

// ── Guided-tour chrome (driven by useTourStore) ──────────────────────────────
export interface TourChromeProps {
  /** Called when the user advances/finishes so the app can fly nav to the step. */
  onStepChange(stepIndex: number): void;
  /** Called on exit so the app can stop cinematic playback. */
  onExit(): void;
}
export function TourChrome(props: TourChromeProps): JSX.Element; // null when no active tour
```

## Inputs / Outputs

- **Inputs:** `useOverlayStore` / `useTourStore` (from `@cosmos/app-state`); a
  pre-projected `ProjectedLabel[]` (the app computes screen coords from the camera and
  `data.labelCandidates`, throttled ≤ 10 Hz).
- **Outputs:** rendered HUD; `onStepChange`/`onExit` callbacks the app wires to `nav`
  cinematic playback (TASK-052).

## Constraints & Forbidden Actions

- **No Three.js** — enforced by ESLint (`packages/ui/**`). The app does all world→screen
  projection and passes `ProjectedLabel[]` in; `ui` never sees the camera or Vector3.
- **Additive only.** Do not change `SearchPalette`, `InfoPanel`, `spectralClassFromBV`, or
  the `BodyLookupAdapter` contract. Existing `ui` tests pass unmodified.
- No fetch / `@cosmos/data` import — data flows through props/stores (the existing rule).
- No per-frame data — `LabelLayer` receives already-throttled props; `TourChrome`/
  `OverlayControls` react to store changes only (§5.12).
- Pointer-events: these panels use `pointer-events: auto`; labels are `pointer-events:
  none` (they must not block the canvas). The app wraps all HUD in the shared
  `pointer-events: none` overlay container (the existing contract).
- No new dependencies.

## Common Mistakes (architecture §5.12)

- Importing Three.js to project labels — that is the app's job; `ui` takes screen coords.
- Subscribing label positions to per-frame data — the app throttles to ≤ 10 Hz; the
  layer just renders what it is given.
- Labels eating canvas clicks — `pointer-events: none` on the label layer root.
- Overplotting every label — de-clutter: sort by `priority`, drop overlapping/`!visible`,
  cap at `maxVisible`.
- Coupling tour playback into `ui` — `TourChrome` only reflects store state + emits
  `onStepChange`/`onExit`; the app owns the camera flight (TASK-052).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/ui test` (jsdom + Testing Library) — new
   `test/OverlayControls.test.tsx`, `test/LabelLayer.test.tsx`, `test/TourChrome.test.tsx`:
   - `OverlayControls`: toggling each control flips the matching `useOverlayStore` field;
     reflects current store state.
   - `LabelLayer`: renders `text` at `(xPx,yPx)`; skips `visible:false`; caps at
     `maxVisible`, keeping the **lowest-`priority`** (most important); root has
     `pointer-events: none`.
   - `TourChrome`: renders nothing when `useTourStore.active` is null; with an active tour
     shows the current step `title`/`narration`; the next/prev buttons call
     `useTourStore.next/prev` and `onStepChange`; exit calls `useTourStore.stop` and
     `onExit`; play/pause toggles `playing`.
   - **Existing `ui` tests pass unmodified.**
2. `pnpm verify` exits 0 (boundary lint: no Three.js import anywhere in `ui`).

## Deliverables

- `packages/ui/src/OverlayControls.tsx`, `src/LabelLayer.tsx`, `src/TourChrome.tsx`,
  `src/index.ts` (additive exports), `src/ui.css` (additive styles for the three)
- `packages/ui/test/OverlayControls.test.tsx`, `test/LabelLayer.test.tsx`,
  `test/TourChrome.test.tsx`
- `packages/ui/README.md` (an "Overlays & tours (Phase 4)" section)

## Context Files

- `packages/app-state/src/overlay-store.ts`, `src/tour-store.ts` (TASK-049 — the stores
  these components bind to)
- `packages/core-types/src/overlay.ts` (`LabelRecord`), `src/tour.ts` (`Tour`, `TourStep`)
- `packages/ui/README.md` + `src/` (the `InfoPanel` store-subscription pattern, the
  pointer-events contract, the `ui.css` conventions to extend)
- `docs/architecture.md` §5.12 (labels, breadcrumb/overlays, throttling, pointer-events,
  a11y)
