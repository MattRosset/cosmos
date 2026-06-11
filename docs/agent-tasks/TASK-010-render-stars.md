# Task: `render-stars` v1 — point-sprite star field + pick helper

**ID:** TASK-010
**Target package:** `packages/render-stars` (new)
**Size:** M
**Phase:** 1 — lane B (render)
**Depends on:** TASK-007

## Goal

GPU rendering of a `StarBatch` as a single draw call of shader point sprites
(architecture §5.9): magnitude-based sizing and brightness, B–V → color via a
blackbody LUT baked into a 1D texture, soft circular falloff, additive blending.
Also exports `pickStar`, the pure-math ray pick used by the M1 integration
(§5.12 picking). This package never fetches data and never imports React; it can be
built and tested entirely against synthetic batches — it does not need the real pack.

## Frozen Interface

```ts
// public API of @cosmos/render-stars
import type * as THREE from 'three';
import type { StarBatch } from '@cosmos/core-types';

export interface StarPointsOptions {
  readonly batch: StarBatch;
  /** Screen-space point size clamp, px. Defaults: min 1, max 64 (§5.9). */
  readonly minPointPx?: number;
  readonly maxPointPx?: number;
  /** Base size factor at apparent magnitude 0, px. Default 8. */
  readonly basePointPx?: number;
}

export interface StarPoints {
  /** Mount into the scene (one THREE.Points, ONE draw call for the whole batch). */
  readonly object: THREE.Points;
  /**
   * Per frame: the batch origin's camera-relative position in galaxy units,
   * i.e. coords' originManager.toRenderSpace(batchOrigin). Copies into a uniform —
   * ZERO allocations.
   */
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  /** Viewport height in physical px (point-size scaling). Call on resize. */
  setViewportHeight(px: number): void;
  /** Exposure multiplier (UI-controlled later). Default 1. */
  setExposure(exposure: number): void;
  dispose(): void;
}

export function createStarPoints(opts: StarPointsOptions): StarPoints;

export interface StarPickHit {
  readonly index: number;
  readonly distancePc: number;
  /** Angle between the ray and the star direction, radians. */
  readonly angleRad: number;
}

/**
 * Nearest star to a ray, by angular distance, within maxAngleRad. Ray origin and
 * direction are TILE-LOCAL parsecs (caller subtracts batch.originPc). Pure math,
 * no Three.js types. Click-time only — may allocate.
 */
export function pickStar(
  batch: StarBatch,
  rayOriginPc: readonly [number, number, number],
  rayDirUnit: readonly [number, number, number],
  maxAngleRad: number,
): StarPickHit | null;
```

## Shader & color spec (fixed — transcribe, don't redesign)

- **Vertex:** `viewPos = position + uRenderOffset` (both tile-local; the offset makes
  it camera-relative, ADR-001 §5). Distance `dPc = length(viewPos)` (galaxy units are
  parsecs). Apparent magnitude `m = aAbsMag + 5.0 * (log2(dPc) / log2(10.0) - 1.0)`.
  Size `gl_PointSize = clamp(uBasePointPx * pow(10.0, -0.2 * m), uMinPointPx,
  uMaxPointPx) * uPixelScale` where `uPixelScale` derives from viewport height.
- **Fragment:** circular soft falloff `alpha = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5))`,
  brightness `pow(10.0, -0.4 * m)` clamped to [0, 1] then × `uExposure`; color from the
  B–V LUT texture sampled at `(bv + 0.4) / 2.4` (LUT domain B–V ∈ [−0.4, 2.0]).
- **LUT (CPU, once per material):** 256×1 RGBA texture. B–V → temperature via
  Ballesteros (2012): `T = 4600 * (1/(0.92*bv + 1.7) + 1/(0.92*bv + 0.62))` K.
  Temperature → linear RGB via the Tanner Helland piecewise approximation (copy the
  published coefficients into `src/blackbody.ts` with the source cited, §15).
- **Material flags:** `transparent: true`, `blending: AdditiveBlending`,
  `depthWrite: false`. Uniform naming `u*`, attributes `a*` (§15).
- Geometry: `BufferGeometry` with `position` (from `batch.positionsPc`, no copy),
  `aAbsMag`, `aColorBV` attributes, preallocated once — never recreated (§5.9).

## Inputs / Outputs

- **Inputs:** synthetic `StarBatch` fixtures (built with the seeded PRNG), e.g. 1000
  stars in a 100 pc sphere with absMag ∈ [−5, 15], bv ∈ [−0.4, 2.0].
- **Outputs:** one `THREE.Points`; `pickStar` hit for a ray aimed exactly at star i
  returns `index === i, angleRad ≈ 0`.

## Constraints & Forbidden Actions

- Do not modify `core-types`. **No React** (lint-enforced for `render-*`), no data
  fetching, no `coords` import (offsets arrive pre-computed via `setRenderOffset`).
- Allowed dependencies: `three`, `@cosmos/core-types`.
- No allocations in `setRenderOffset` / `setExposure` / `setViewportHeight`.
- No `Math.random()` — fixtures use `createPrng` (lint rule extends to this package's
  tests via existing config; keep it true regardless).

## Common Mistakes (architecture §5.9 — copy kept verbatim)

- One draw call per star (must be one draw per tile/batch).
- Point size in world units only (clamp screen-space size to [1px, ~64px] in vertex
  shader or near stars become screen-filling squares).
- Updating buffers by recreating geometry (use `BufferAttribute.set` + `needsUpdate`,
  preallocate to tile max).
- sRGB/linear confusion making stars look washed out — LUT is generated in linear
  space; scene-host owns the output color pipeline (do not tone-map here).

## Acceptance Tests

The task is DONE only when these pass in CI (visual-regression baselines arrive with
the E2E harness, TASK-014/015 — unit level here):

1. `pnpm --filter @cosmos/render-stars test` (Vitest, jsdom; no GPU):
   - Geometry layout: attribute item sizes/counts match the batch; `position` shares
     the batch's underlying buffer (no copy).
   - Blackbody LUT: bv = −0.3 → blue channel > red; bv = +1.5 → red > blue;
     bv = +0.6 → all channels within 35% of each other (sun-ish white); LUT values
     finite and in [0, 1].
   - Shader strings: contain `uRenderOffset`, the magnitude formula’s `-0.2` size
     exponent and `-0.4` brightness exponent, and the [min,max] px clamp (cheap
     regression guards against silent shader edits).
   - `pickStar`: exact-aim returns the star; two stars 0.5° apart, ray between them →
     smaller angle wins; nothing within `maxAngleRad` → null; ties broken by nearer
     `distancePc` (property test, seeded PRNG, ≥ 500 cases vs. brute force).
   - `setRenderOffset` zero-allocation (same-identity scratch check) and mutates the
     uniform in place.
   - `dispose()` disposes geometry, material, and LUT texture exactly once.
2. **Coverage gate:** statement coverage ≥ 85% on `src` (shader strings excluded via
   coverage ignore comments are NOT allowed — test the builders instead).
3. `pnpm verify` exits 0 (boundary lint: no React import anywhere in the package).

## Deliverables

- `packages/render-stars/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/render-stars/src/star-points.ts`, `src/blackbody.ts`, `src/pick.ts`,
  `src/shaders/stars.vert.glsl.ts`, `src/shaders/stars.frag.glsl.ts`, `src/index.ts`
- `packages/render-stars/test/star-points.test.ts`, `test/blackbody.test.ts`,
  `test/pick.test.ts`
- `packages/render-stars/README.md` (< 150 lines)

## Context Files

- `docs/architecture.md` §5.9 (whole section), §9 (budgets), §10 (color pipeline), §15
- `docs/decisions/ADR-001-coordinates.md` §5 (renderer contract)
- `packages/core-types/src/batches.ts` (from TASK-007)
