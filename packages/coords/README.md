# @cosmos/coords

Pure-math implementation of the coordinate & scale architecture (ADR-001,
architecture §5.2). Every `render-*` package and `nav` sit on top of this API.
**The public API freezes at the end of Phase 0 (TASK-006).**

## Purpose

The universe spans ~26 orders of magnitude; GPUs work in f32. This package keeps
all positions in f64 inside *scale contexts* (local frames with their own unit)
and produces **camera-relative** positions that are safe to downcast to f32:

- `universe` (1 Mpc) → `galaxy` (1 pc) → `system` (1 AU) → `planet` (1 km),
  a fixed parent chain with f64 anchors.
- `render = bodyLocal - cameraLocal`, subtracted in **f64 before** any downcast.
- A floating origin rebases atomically at frame start when the camera drifts
  more than `REBASE_THRESHOLD_UNITS` from the render origin.

## API

```ts
import { createScaleFrameTree, createOriginManager } from '@cosmos/coords';

const tree = createScaleFrameTree();
tree.setAnchor('system', [8000, 0, 0]); // system origin, in galaxy units (pc)

tree.convert(pos, 'galaxy');     // pure f64 conversion between contexts
tree.distanceMeters(a, b);       // ONLY sanctioned cross-context comparison

const origin = createOriginManager(tree, initialCamera);
const rebase = origin.setCameraPosition(cameraPos); // once per frame, at frame start
origin.toRenderSpace(bodyPos, out);                 // camera-relative, f32-safe
origin.switchContext('system');                     // mechanical reparenting only
```

- `setCameraPosition` returns a `RebaseEvent` (`{ context, offsetUnits }`) when a
  rebase fired; `nav` uses `offsetUnits` to patch velocity, `scene-host` shifts
  root render groups by `-offsetUnits`.
- `toRenderSpace(pos, out)` writes into `out` and returns it — zero allocations
  on frame paths (scratch arrays are module-scoped).

## Invariants

1. **f64 everywhere inside this package.** f32 appears nowhere; the *caller*
   downcasts `toRenderSpace` output.
2. **Subtraction before downcast.** Camera-relative values are computed in f64.
3. **Rebasing is atomic at frame start** — never mid-frame. The event carries
   the exact applied offset.
4. **Cross-context math routes through `distanceMeters`** (common-ancestor
   frame). Direct subtraction across contexts is banned (ADR-001).
5. **Precision is relative to the traversed scale.** Conversions are exact to
   ~1e-16 relative to the largest magnitude involved. Absolute detail finer
   than that scale cannot survive (e.g. km detail inside a Mpc representation)
   — which is exactly why positions stay context-local and GPU buffers must be
   context-local too.
6. **Pure package:** no Three.js, no React, no DOM, no `Math.random()`.

## Testing

`pnpm --filter @cosmos/coords test` — property-based round-trips (seeded PRNG
from `@cosmos/core-types`, 1000+ cases), rebase semantics, context-switch
drift, zero-allocation contract. Statement coverage gate: ≥ 90%.
