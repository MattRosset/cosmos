# @cosmos/scene-host

Render-loop owner for cosmos (architecture §5.1). Owns the single R3F `<Canvas>`,
renderer configuration, and priority-ordered frame subscribers. **Public API
freezes at the end of Phase 0 (TASK-006).**

## Purpose

`apps/web` and future `render-*` / `nav` packages compose against a stable host
instead of each owning canvas setup. Phase 0 delivers:

- Logarithmic depth buffer + `antialias: false` (mandatory from day one).
- Shared `FrameContext` passed to subscribers without per-frame allocation.
- Priority-ordered frame callbacks matching the §3 data flow:
  `nav → coords rebase → streaming → render`.

## API

```tsx
import {
  SceneHost,
  useFrameContext,
  PRIORITY_NAV,
  PRIORITY_COORDS,
  PRIORITY_STREAMING,
  PRIORITY_RENDER,
} from '@cosmos/scene-host';

function App() {
  return (
    <SceneHost onFrame={(ctx) => { /* app-level render hook */ }}>
      <Starfield />
    </SceneHost>
  );
}

// Inside the Canvas tree (e.g. packages/nav, packages/coords adapter):
function NavDriver() {
  useFrameContext((ctx) => {
    // ctx.camera, ctx.dtMs (clamped to 100 ms), ctx.epochJD (J2000 stub)
  }, PRIORITY_NAV);
  return null;
}
```

## Frame priorities

| Constant | Value | Stage |
|---|---|---|
| `PRIORITY_NAV` | -200 | Camera / input |
| `PRIORITY_COORDS` | -100 | Floating-origin rebase |
| `PRIORITY_STREAMING` | -50 | Visible-set updates |
| `PRIORITY_RENDER` | 0 | Render packages + app hook |

Lower numbers run earlier within a frame.

## Boundaries

- **Glue package:** may import React, Three.js, R3F, `@cosmos/coords`.
- **No body rendering** — star/planet meshes live in `render-*` or app placeholders.
- **Canvas isolation:** HUD state must not force `<Canvas>` re-renders; pass scene
  content as stable children.

## Extension points (later tasks)

- Coords rebase: subscribe at `PRIORITY_COORDS`, shift root render groups on
  `RebaseEvent`.
- Streaming: subscribe at `PRIORITY_STREAMING` for tile visibility.
- Post chain / quality tiers: mount inside `SceneHost` after scene content.

## Testing

`pnpm --filter @cosmos/scene-host test` — priority ordering, dt clamp, epoch
stub, unmount cleanup (@react-three/test-renderer + Vitest).
