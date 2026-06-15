# Task: `render-galaxy` v1 — particle clouds, dust-lane billboards, far-LOD impostor

**ID:** TASK-036
**Target package:** `packages/render-galaxy` (new)
**Size:** M
**Phase:** 3 — lane (render)
**Depends on:** TASK-031

## Goal

Galaxy-scale rendering per architecture §5.9: render a `StarBatch` (real octree tile
OR procedural galaxy) as additive GPU point sprites — the same point machinery as
`render-stars` — plus two galaxy-specific additions: **dust-lane billboards**
(camera-facing alpha-textured quads darkening the disc) and a **baked far-LOD
impostor sprite** (a single camera-facing quad standing in for the whole galaxy at
ultra-far distance, §5.9). Like `render-stars`: Three.js only, **no React, no data
fetching, no `coords` import** — camera-relative offsets and pre-loaded textures are
injected by the caller; fully testable with jsdom (no GPU).

## Frozen Interface

```ts
// public API of @cosmos/render-galaxy
import type * as THREE from 'three';
import type { StarBatch } from '@cosmos/core-types';

// ── Particle cloud (point sprites; additive) ─────────────────────────────────
export interface GalaxyPointsOptions {
  readonly batch: StarBatch;
  /** Min/max/base point size in px (same contract as render-stars). */
  readonly minPointPx?: number;   // default 1
  readonly maxPointPx?: number;   // default 32
  readonly basePointPx?: number;  // default 4
}
export interface GalaxyPoints {
  readonly object: THREE.Points;
  /** Per frame: batch-origin camera-relative position, CONTEXT UNITS. Zero alloc. */
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setViewportHeight(px: number): void;
  setExposure(v: number): void;
  /** Cross-fade alpha in [0,1] for LOD transitions (§5.8 ~0.3 s fades). */
  setOpacity(a: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
export function createGalaxyPoints(opts: GalaxyPointsOptions): GalaxyPoints;

// ── Dust lanes (camera-facing alpha billboards) ──────────────────────────────
export interface DustLanesOptions {
  /** Billboard centers, CONTEXT UNITS relative to the batch origin, 3×N f32. */
  readonly centersUnits: Float32Array;
  /** Per-billboard radius, context units, N f32. */
  readonly radiiUnits: Float32Array;
  /** Pre-loaded soft dust texture (alpha). */
  readonly dustTexture: THREE.Texture;
}
export interface DustLanes {
  readonly object: THREE.Object3D;
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setOpacity(a: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
export function createDustLanes(opts: DustLanesOptions): DustLanes;

// ── Far-LOD impostor (single baked sprite) ───────────────────────────────────
export interface GalaxyImpostorOptions {
  /** Pre-baked galaxy sprite (the app/offline bake supplies it). */
  readonly spriteTexture: THREE.Texture;
  /** World radius of the impostor quad, context units. */
  readonly radiusUnits: number;
}
export interface GalaxyImpostor {
  readonly object: THREE.Object3D;
  /** Per frame: camera-relative position of the galaxy center, context units. */
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setOpacity(a: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
export function createGalaxyImpostor(opts: GalaxyImpostorOptions): GalaxyImpostor;
```

## Construction & shader spec (fixed — transcribe, don't redesign)

- **Particle cloud** (§5.9): identical point-sprite contract to `render-stars` —
  ONE `THREE.Points`, one draw call per batch; custom `ShaderMaterial`, additive
  blending, `depthWrite: false`, `transparent: true`; magnitude-based sizing
  `clamp(basePointPx * 10^(−0.2·m), min, max) * pixelScale`; B–V → linear RGB via
  the same blackbody LUT as `render-stars` (vendor the LUT build or import the
  shared helper — do NOT invent a different color pipeline, §5.9/§10); `uRenderOffset`
  uniform applied as `position + uRenderOffset`, camera rotation only (floating
  origin, ADR-001 §5). `uOpacity` multiplies fragment alpha for cross-fades.
- **Dust lanes** (§5.9): camera-facing billboards (an `InstancedMesh` of a unit quad,
  one instance per center, sized by `radiiUnits`) oriented to face the camera in the
  vertex shader; material samples `dustTexture` alpha and **subtracts** brightness
  (`blending: THREE.CustomBlending` with `src = ONE_MINUS_DST_COLOR`-style darkening,
  OR a documented multiply blend) — the dust occludes/darkens the additive star
  cloud behind it. `depthWrite: false`. Cap instance count; no per-frame allocation.
- **Far-LOD impostor** (§5.9): a single camera-facing quad (`THREE.Sprite` or a quad
  with a billboard vertex shader) of radius `radiusUnits`, sampling `spriteTexture`,
  additive, `depthWrite: false`. The CALLER (streaming/app) cross-fades between
  impostor and particle cloud by driving `setOpacity` on both (§5.8 hysteresis +
  ~0.3 s cross-fade).
- All `set*` methods write into preallocated uniforms/instance attributes — zero
  allocations (§9); geometry and materials created exactly once per object;
  injected textures are NEVER disposed by `dispose()`.

## Inputs / Outputs

- **Inputs:** a procedural `StarBatch` (from `procgen`, `originPc = [0,0,0]`) or a
  decoded octree tile batch; synthetic dust centers/radii; a stub `THREE.Texture`.
- **Outputs:** Three.js objects mounted into `scene-host` slots by the app; the
  particle cloud is a single draw call (§9 ≤ 300 draw calls / batch-level batching).

## Constraints & Forbidden Actions

- Do not modify `core-types`. **No React** (lint-enforced for `render-*`), no data
  fetching, no texture loading (KTX2/sprite bake is the app's job), no `coords`
  import.
- Allowed dependencies: `three`, `@cosmos/core-types`. If the B–V LUT helper is
  shared from `render-stars`, add `@cosmos/render-stars` (a render-package → render-
  package import is allowed; render-* may depend on render-*; it never imports React)
  — list it explicitly OR vendor the LUT; pick one and document it.
- No allocations in any `set*` method. No `Math.random()` (fixtures use `createPrng`).
- Do NOT add volumetric ray-marching, real nebula volumetrics, or a galaxy mesh
  (§5.9/§5.11: billboards over volumetrics is doctrine; nebulae are Phase 4).
- One draw call per batch (the §5.9 cardinal rule) — never per-star or per-billboard.

## Common Mistakes (architecture §5.9 — copy kept verbatim)

- One draw call per star (must be one draw per tile/batch).
- Point size in world units only (clamp screen-space size to [1px, ~64px] in vertex
  shader or near stars become screen-filling squares).
- Updating buffers by recreating geometry (use `BufferAttribute.set` + `needsUpdate`,
  preallocate to tile max).
- sRGB/linear confusion making stars look washed out — define color pipeline once in
  scene-host and document it.
- Plus: disposing injected textures in `dispose()` (the app shares them); additive
  blending on dust (dust must DARKEN, not add — it is the one non-additive layer);
  forgetting `setOpacity` cross-fade hooks (LOD swaps pop without them, §5.8).

## Acceptance Tests

The task is DONE only when these pass in CI (visual baselines arrive with TASK-040):

1. `pnpm --filter @cosmos/render-galaxy test` (Vitest, jsdom; no GPU):
   - **Particle cloud:** `object` is a single `THREE.Points` with one draw (one
     geometry, one material); vertex shader contains the `clamp(...,min,max)`
     screen-space size term and `uRenderOffset`; material is additive,
     `depthWrite === false`, `transparent`. `setRenderOffset`/`setExposure`/
     `setOpacity` mutate uniforms in place, zero allocation (same-identity check).
   - **Dust lanes:** an `InstancedMesh` with `count === radiiUnits.length`;
     blending is NOT plain additive (assert the darkening/multiply mode chosen);
     `depthWrite === false`; instance matrices/attributes set once; `setRenderOffset`
     zero-alloc.
   - **Impostor:** a single billboard object; additive; `setOpacity` drives a
     uniform/material opacity; radius reflected in geometry/scale.
   - **Dispose:** geometries + materials of all three disposed exactly once;
     injected textures' `dispose` NOT called (spies).
   - **Color parity:** the cloud's B–V→RGB LUT matches `render-stars`' LUT at sample
     points (import or vendored — assert equality at bv ∈ {-0.3, 0.0, 0.65, 1.5}).
2. **Coverage gate:** statement coverage ≥ 85% on `src` (render-package precedent).
3. `pnpm verify` exits 0 (boundary lint: no React import anywhere in the package).

## Deliverables

- `packages/render-galaxy/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/render-galaxy/src/galaxy-points.ts`, `src/dust-lanes.ts`,
  `src/impostor.ts`, `src/shaders/galaxy.vert.glsl.ts`,
  `src/shaders/galaxy.frag.glsl.ts`, `src/shaders/dust.*.glsl.ts`,
  `src/shaders/impostor.*.glsl.ts`, `src/lut.ts` (shared/vendored B–V LUT),
  `src/index.ts`
- `packages/render-galaxy/test/galaxy-points.test.ts`, `test/dust-lanes.test.ts`,
  `test/impostor.test.ts`
- `packages/render-galaxy/README.md` (< 150 lines)

## Context Files

- `docs/architecture.md` §5.9 (whole section), §5.11 (billboards-over-volumetrics
  doctrine), §9 (budgets), §10 (color pipeline + layer order), §15 (shader naming)
- `docs/decisions/ADR-001-coordinates.md` §5 (renderer contract)
- `packages/render-stars/src/star-points.ts` (point-sprite + offset-uniform +
  dispose patterns to copy; the B–V LUT to share), `test/star-points.test.ts`
  (zero-allocation test pattern)
- `packages/core-types/src/batches.ts` (`StarBatch`)
