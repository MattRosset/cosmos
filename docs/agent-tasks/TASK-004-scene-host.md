# Task: `scene-host` — extract render-loop owner from `apps/web`

**ID:** TASK-004
**Target package:** `packages/scene-host` (new) + `apps/web` (consumer changes only)
**Size:** S
**Phase:** 0
**Depends on:** TASK-003

## Goal

The R3F `<Canvas>`, renderer configuration, and frame-loop ordering move out of
`apps/web` into `@cosmos/scene-host`, so that `nav` (TASK-005) and later `render-*`
packages mount against a stable host instead of app code. `apps/web` becomes thin
composition: `<SceneHost>` + HUD. Visual behavior of the placeholder starfield is
unchanged.

## Frozen Interface

```ts
// public API of @cosmos/scene-host
import type { ReactNode } from 'react';
import type * as THREE from 'three';

/** Per-frame data passed to subscribers (architecture §5.1). */
export interface FrameContext {
  readonly camera: THREE.PerspectiveCamera;
  /** Wall-clock delta, CLAMPED to 100 ms (tab-switch protection, §5.4). */
  readonly dtMs: number;
  /** Simulation epoch. Phase 0 stub: constant J2000 = 2451545.0 until sim-time lands. */
  readonly epochJD: number;
}

export type FrameCallback = (ctx: FrameContext) => void;

/** Frame-loop ordering (lower runs earlier). Matches §3 data flow:
 *  input/nav → coords rebase → streaming → render. */
export const PRIORITY_NAV: -200;
export const PRIORITY_COORDS: -100;
export const PRIORITY_STREAMING: -50;
export const PRIORITY_RENDER: 0;

/** Subscribe to the frame loop from inside the Canvas tree. */
export function useFrameContext(cb: FrameCallback, priority?: number): void;

export interface SceneHostProps {
  /** Scene content (render packages, debug markers). Rendered inside the Canvas. */
  children?: ReactNode;
  /** Escape hatch for the app shell; runs at PRIORITY_RENDER. */
  onFrame?: FrameCallback;
}

/** Owns the only <Canvas>. Renderer config is THIS package's responsibility:
 *  logarithmicDepthBuffer: true, antialias: false (§5.1 — mandatory from day one). */
export function SceneHost(props: SceneHostProps): React.JSX.Element;
```

## Inputs / Outputs

- **Inputs:** React children; nothing else in Phase 0 (quality tiers, postprocessing,
  and context-group mounting come in later tasks — leave extension comments, not code).
- **Outputs:** rendered frames; `FrameContext` to subscribers in priority order.

## Constraints & Forbidden Actions

- Do not modify `packages/core-types` or `packages/coords`.
- scene-host is GLUE (§4): it may import React, Three.js, R3F, and `@cosmos/coords` —
  but contains **no rendering logic for any body type** (§5.1 boundary). The placeholder
  `Starfield` stays in `apps/web/src/scene/` and is passed as a child.
- Keep `OrbitControls` in `apps/web` for now (it is deleted by TASK-005).
- Isolate the Canvas from HUD state: no props that change per HUD interaction.
- No allocations inside the frame loop (`FrameContext` object reused, fields mutated).
- Allowed dependencies (new package only): `react`, `three`, `@react-three/fiber`,
  `@cosmos/core-types`, `@cosmos/coords` — same versions as `apps/web`.

## Common Mistakes (architecture §5.1 — copy kept verbatim)

- Forgetting the logarithmic depth buffer → z-fighting at astronomical scale. Enable
  from day one.
- Letting React re-render the Canvas subtree on UI state changes — isolate Canvas from
  HUD state with separate stores/selectors.
- Using MSAA + postprocessing together on WebGL2 (broken/expensive) — use FXAA/SMAA in
  the post chain. (No post chain yet — keep `antialias: false` anyway.)

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/scene-host test` — unit tests (Vitest + jsdom or
   @react-three/test-renderer):
   - Subscribers run in ascending priority order within one frame.
   - `dtMs` is clamped: a simulated 5 s gap delivers `dtMs === 100`.
   - `epochJD === 2451545.0`.
   - Unsubscribe on unmount (no callback after unmount; no leak across 100 mount cycles).
2. `pnpm --filter @cosmos/web build` succeeds; `apps/web/src/App.tsx` no longer imports
   `@react-three/fiber` directly (grep gate: `Canvas` appears only in scene-host).
3. `pnpm verify` exits 0; dependency-boundary lint still green.
4. Manual smoke (note in PR): `pnpm dev` shows the same starfield as before the change.

## Deliverables

- `packages/scene-host/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/scene-host/src/SceneHost.tsx`, `src/frame-loop.ts`, `src/index.ts`
- `packages/scene-host/test/frame-loop.test.tsx`
- `packages/scene-host/README.md` (< 150 lines)
- `apps/web/src/App.tsx` (rewritten as consumer), `apps/web/package.json` (add dep)

## Context Files

- `docs/architecture.md` §3 (frame data flow), §5.1 (whole section), §9
- `apps/web/src/App.tsx`, `apps/web/src/scene/Starfield.tsx` (current state to extract)
- `packages/coords/README.md` (from TASK-003)
