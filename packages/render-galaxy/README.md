# @cosmos/render-galaxy

Galaxy-scale rendering (§5.9): additive particle cloud, dust-lane billboards, and
a far-LOD impostor sprite. Three.js only — no React, no data fetching.

## Components

### `createGalaxyPoints(opts)` — particle cloud

One `THREE.Points`, one draw call per `StarBatch`. Identical point-sprite contract
to `render-stars` (magnitude-based screen-space sizing, B–V blackbody color) plus
`setOpacity` for LOD cross-fades (§5.8).

```ts
import { createGalaxyPoints } from '@cosmos/render-galaxy';

const pts = createGalaxyPoints({ batch, minPointPx: 1, maxPointPx: 32, basePointPx: 4 });
scene.add(pts.object);

// per-frame (floating origin, ADR-001):
pts.setRenderOffset(tileOriginCameraRelative);
```

### `createDustLanes(opts)` — dust-lane billboards

Camera-facing `InstancedMesh` of soft alpha quads. Blending is `MultiplyBlending`
so the dust **darkens** the additive star cloud behind it (not additive).

```ts
import { createDustLanes } from '@cosmos/render-galaxy';

const lanes = createDustLanes({ centersUnits, radiiUnits, dustTexture });
scene.add(lanes.object);
lanes.setRenderOffset(batchOriginCameraRelative);
```

### `createGalaxyImpostor(opts)` — far-LOD impostor

Single camera-facing `THREE.Mesh` (ShaderMaterial, additive) standing in for the
whole galaxy at ultra-far distance. The caller cross-fades between impostor and
particle cloud by driving `setOpacity` on both objects (§5.8 hysteresis + ~0.3 s).

```ts
import { createGalaxyImpostor } from '@cosmos/render-galaxy';

const imp = createGalaxyImpostor({ spriteTexture, radiusUnits: 15_000 });
scene.add(imp.object);
imp.setRenderOffset(galaxyCenterCameraRelative);
```

## Common set* contract

All `set*` methods are **zero-allocation** — they write into preallocated uniforms or
instance attributes. Call them every frame from the render loop.

| Method | Description |
|---|---|
| `setRenderOffset([x,y,z])` | Batch-origin camera-relative position (context units) |
| `setOpacity(a)` | Cross-fade alpha in [0,1] — driven by caller for LOD transitions |
| `setVisible(v)` | Show/hide the object |
| `dispose()` | Frees geometry + material; **never** disposes injected textures |

## B–V color pipeline

The particle cloud shares the same blackbody LUT as `render-stars` by importing
`buildBlackbodyLutData` / `bvToLinearRgb` directly from `@cosmos/render-stars`.
Color parity is guaranteed by construction and verified in the acceptance tests.

## Constraints

- No React, no data fetching, no `coords` import (lint-enforced).
- One draw call per batch — never per-star or per-billboard.
- Injected textures (`dustTexture`, `spriteTexture`) are owned by the caller.
