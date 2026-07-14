# @cosmos/render-stars

GPU rendering of a `StarBatch` as a single draw-call of Three.js point sprites, plus a pure-math ray-pick helper.

## API

```ts
import { createStarPoints, pickStar } from '@cosmos/render-stars';
```

### `createStarPoints(opts)`

Returns a `StarPoints` object:

| member | description |
|---|---|
| `object` | `THREE.Points` — mount into the R3F scene once |
| `setRenderOffset([x,y,z])` | Per-frame: batch-origin camera-relative position (parsecs). Zero allocations. |
| `setViewportHeight(px)` | Physical viewport height in px — call on resize. |
| `setExposure(v)` | Exposure multiplier (default 1). |
| `dispose()` | Disposes geometry, material and LUT texture. Safe to call twice. |

Options:

| option | default | description |
|---|---|---|
| `batch` | required | `StarBatch` from `@cosmos/core-types` |
| `minPointPx` | `3` | Minimum rendered point size in px |
| `maxPointPx` | `64` | Maximum rendered point size in px |
| `basePointPx` | `8` | Size at apparent magnitude 0 |

### `pickStar(batch, rayOriginPc, rayDirUnit, maxAngleRad)`

Pure-math ray pick. Ray origin and direction are tile-local parsecs (subtract `batch.originPc` first). Returns the nearest `StarPickHit` by angular distance, or `null` if nothing is within `maxAngleRad`. Ties are broken by `distancePc`.

## Rendering contract (ADR-001 §5)

The caller must compute `setRenderOffset` each frame as `originManager.toRenderSpace(batch.originPc)`. The vertex shader treats `position + uRenderOffset` as the star's camera-relative position in world axes (parsecs), applies the rotational part of the camera view matrix, then the projection matrix. The camera's render-space position is identically zero under the floating origin (ADR-001), so **no view translation is applied — only rotation**. Place the `THREE.Points` at scene origin and don't add any position/rotation.

## Shader spec (§5.9)

- **Vertex:** apparent magnitude = absolute magnitude + distance modulus at `dPc = length(viewPos)` parsecs. Point size = `clamp(basePointPx * 10^(-0.2*m), min, max) * pixelScale`.
- **Fragment:** soft circular falloff via `gl_PointCoord`; brightness = `clamp(10^(-0.4*m), 0, 1) * exposure`; color from B–V blackbody LUT sampled at `(bv + 0.4) / 2.4`.
- **Blending:** additive, no depth write, transparent.

## Color pipeline

The B–V LUT (256 × 1 RGBA) converts B–V → temperature via Ballesteros (2012) → linear RGB via Tanner Helland piecewise approximation. Values are stored in linear space. Tone mapping and output encoding are owned by `scene-host`.

## Dependencies

- `three` — rendering
- `@cosmos/core-types` — `StarBatch`, `createPrng` (tests only)

No React, no data fetching, no DOM beyond what Three.js needs.
