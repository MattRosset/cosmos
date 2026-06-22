# @cosmos/render-fx

Phase-4a overlay/effect renderers (architecture §4). Three.js only — no React, no
data fetching, no `coords` import. Camera-relative offsets and pre-loaded textures
are injected by the caller; fully testable under jsdom (no GPU).

This package is the §4 home for overlays/effects because `render-stars` is frozen.

## Components

### `createNebula(opts)` — layered-noise nebula billboards (§5.11)

One `THREE.InstancedMesh` of unit quads, **one draw call per field**, one instance
per `NebulaLayer`, camera-facing in the vertex shader, **additive**. Stacking the
capped layer set reads as a volumetric nebula **without ray marching** — the
billboards-over-volumetrics doctrine (§5.11). Layers beyond `MAX_NEBULA_LAYERS`
(32) are dropped to bound overdraw.

Per-layer tint (`colorLinear`) is pre-multiplied by per-layer `opacity` and carried
on an instanced `aColor` attribute; the layer `seed` rotates the noise UVs so
stacked layers do not visibly repeat.

```ts
import { createNebula } from '@cosmos/render-fx';

const neb = createNebula({ field, noiseTexture });
scene.add(neb.object);

// per-frame (floating origin, ADR-001 §5):
neb.setRenderOffset(fieldOriginCameraRelative);
neb.setExposure(exposure);
neb.setOpacity(crossFadeAlpha);
```

### `createLineSet(opts)` — camera-relative line segments

One `THREE.LineSegments`, **one draw call**, holding every segment. Used by the app
to draw constellation lines from the endpoints `data` resolves (TASK-046). The
caller rebases `data`'s absolute f64 positions to a `Float32Array` of camera-relative
endpoints (`6×N`: `[ax,ay,az, bx,by,bz, …]`) plus a per-frame origin offset.

```ts
import { createLineSet } from '@cosmos/render-fx';

const lines = createLineSet({ segments, colorLinear: [0.4, 0.55, 0.8], opacity: 0.5 });
scene.add(lines.object);
lines.setRenderOffset(originCameraRelative);
```

`widthPx > 1` would require three-stdlib's `Line2` (an extra dependency + a
different geometry model). To keep allowed deps to `three` + `core-types`, the
line-set draws at the GL-native **1px** `LineSegments` and ignores wider requests;
swap to `Line2` here if thick lines become a requirement.

## Common set* contract

All `set*` methods are **zero-allocation** — they mutate preallocated uniforms or
instance attributes; geometry + materials are created exactly once. Call them every
frame from the render loop.

| Method | Description |
|---|---|
| `setRenderOffset([x,y,z])` | Origin camera-relative position (context units) |
| `setExposure(v)` (nebula) | Tone multiplier riding the additive alpha term |
| `setOpacity(a)` | Cross-fade alpha in [0,1] for LOD/quality transitions |
| `setVisible(v)` | Show/hide the object |
| `dispose()` | Frees geometry + material; **never** disposes injected textures |

## Constraints

- No React (lint-enforced for `render-*`), no data fetching, no texture loading, no
  `coords` import.
- Allowed dependencies: `three`, `@cosmos/core-types`.
- One draw call per nebula field and per line-set (the §9 cardinal rule).
- Endpoints/centers are camera-relative + an offset uniform (ADR-001 §5) — never
  absolute positions in f32. No `Math.random()`; layer noise is `seed`-driven.
- Injected textures are owned by the caller and are **never** disposed here.
