# Task: `render-fx` v1 — nebulae billboards + camera-relative line-set

**ID:** TASK-047
**Target package:** `packages/render-fx` (new)
**Size:** M
**Phase:** 4 — lane (render); new package
**Depends on:** TASK-042

## Goal

Stand up the `render-fx` package (architecture §4 folder, never built) with the two
Phase-4a effect renderers it needs:

1. **Nebulae** (§5.11) — camera-facing layered-noise billboards that read as volumetric
   nebulae *without* ray-marching (the §5.11 "billboard volumetric-look" doctrine).
2. **Line-set** — a generic camera-relative line-segment renderer in one draw call, used
   by the app to draw constellation lines from the resolved endpoints `data` provides
   (TASK-046). It lives here because `render-fx` is the §4 home for overlays/effects and
   `render-stars` is frozen.

Like the other `render-*` packages: **Three.js only, no React, no data fetching, no
`coords` import** — camera-relative offsets and pre-loaded textures/positions are injected
by the caller; fully testable with jsdom (no GPU).

## Frozen Interface

```ts
// public API of @cosmos/render-fx
import type * as THREE from 'three';
import type { NebulaField } from '@cosmos/core-types';

// ── Nebula (camera-facing layered-noise billboards; additive) ────────────────
export interface NebulaOptions {
  readonly field: NebulaField;
  /** Pre-loaded soft noise/sprite texture (alpha). */
  readonly noiseTexture: THREE.Texture;
}
export interface Nebula {
  readonly object: THREE.Object3D;
  /** Per frame: field-origin camera-relative position, CONTEXT UNITS. Zero alloc. */
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setExposure(v: number): void;
  /** Cross-fade alpha in [0,1] for LOD/quality transitions. */
  setOpacity(a: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
export function createNebula(opts: NebulaOptions): Nebula;

// ── Line-set (generic camera-relative line segments; e.g. constellation lines) ─
export interface LineSetOptions {
  /** Segment endpoints, CONTEXT UNITS relative to `originUnits`: 6×N f32
   *  [ax,ay,az, bx,by,bz, …]. The caller rebases data's absolute f64 to this. */
  readonly segments: Float32Array;
  readonly colorLinear?: readonly [number, number, number]; // default [0.4,0.55,0.8]
  readonly opacity?: number;                                 // default 0.5
  /** Constant screen-space line width in px where supported (else 1). */
  readonly widthPx?: number;                                 // default 1
}
export interface LineSet {
  readonly object: THREE.Object3D;
  /** Per frame: origin camera-relative position, CONTEXT UNITS. Zero alloc. */
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setOpacity(a: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
export function createLineSet(opts: LineSetOptions): LineSet;
```

## Construction & shader spec (fixed — transcribe, don't redesign)

- **Nebula** (§5.11): one `THREE.InstancedMesh` of a unit quad, one instance per
  `NebulaLayer` (cap at `MAX_NEBULA_LAYERS = 32` — ignore extras), each instance
  positioned at `layer.centerUnits`, scaled by `layer.radiusUnits`, **camera-facing**
  (billboard in the vertex shader). Fragment samples `noiseTexture` (offset/rotated per
  layer by `layer.seed`) × `layer.colorLinear` × `layer.opacity`, **additive blending**,
  `depthWrite: false`, `transparent: true`. `uRenderOffset` applied as
  `instanceCenter + uRenderOffset`, camera rotation only (floating origin, ADR-001 §5).
  `uOpacity` multiplies fragment alpha for cross-fades. **No ray marching, no real
  volumetrics** (§5.11) — the layered billboards + noise are the whole effect.
  Cap layer count to bound overdraw (§5.11 "cap layer count, dither").
- **Line-set**: one `THREE.LineSegments` (or `Line2`/`LineSegments2` if `widthPx > 1`
  needs it) with a single geometry holding all `segments`, one draw call. Custom
  `ShaderMaterial`: `position + uRenderOffset`, camera rotation only; `uColor`, `uOpacity`.
  `depthWrite: false`, `transparent: true`. The position buffer is preallocated to the
  segment count; `setRenderOffset` mutates a uniform — no geometry rebuild.
- All `set*` methods write into preallocated uniforms/instance attributes — **zero
  allocations** (§9); geometry + materials created exactly once; **injected textures are
  NEVER disposed** by `dispose()`.

## Inputs / Outputs

- **Inputs:** a synthetic `NebulaField` (seeded layers), a stub `THREE.Texture`, a
  `Float32Array` of camera-relative segment endpoints.
- **Outputs:** Three.js objects mounted into `scene-host` slots by the app; each is a
  single draw call (§9 batching rule).

## Constraints & Forbidden Actions

- Do not modify `core-types`. **No React** (lint-enforced for `render-*`), no data
  fetching, no texture loading, no `coords` import.
- Allowed dependencies: `three`, `@cosmos/core-types`. (If a screen-space-width line needs
  drei/three `Line2`, that lives in `three/examples`/`three-stdlib` — list it explicitly
  under "Allowed dependencies" or fall back to `THREE.LineSegments` at 1px; pick one and
  document it.)
- No allocations in any `set*` method. No `Math.random()` (layer noise is driven by
  `layer.seed`; fixtures use `createPrng`).
- Do NOT add real nebula volumetrics or a galaxy mesh (§5.11 doctrine).
- One draw call per nebula field and per line-set (the §9 cardinal rule).

## Common Mistakes (architecture §5.9, §5.11 — kept verbatim where they apply)

- One draw call per billboard/segment (must be one draw per field / per line-set).
- Nebula overdraw tanking fill-rate — cap layer count, dither (§5.11).
- Attempting real volumetrics first (§5.11: billboards over volumetrics is doctrine).
- Disposing injected textures in `dispose()` (the app shares them).
- Updating buffers by recreating geometry (preallocate; mutate the offset uniform).
- Absolute positions in f32 — endpoints/centers are camera-relative + an offset uniform
  (ADR-001 §5); the caller rebases `data`'s absolute f64.

## Acceptance Tests

The task is DONE only when these pass in CI (visual baselines arrive with TASK-052/053):

1. `pnpm --filter @cosmos/render-fx test` (Vitest, jsdom; no GPU):
   - **Nebula:** `object` is a single `InstancedMesh` with `count === min(layers.length,
     32)`; material is additive, `depthWrite === false`, `transparent`; the vertex shader
     billboards (contains the camera-facing term) and uses `uRenderOffset`;
     `setRenderOffset`/`setExposure`/`setOpacity` mutate uniforms in place (same-identity
     zero-alloc check); a field with > 32 layers mounts exactly 32.
   - **Line-set:** `object` is a single `LineSegments`(/`Line2`) with one geometry whose
     vertex count matches `segments.length / 3`, one draw; additive/transparent,
     `depthWrite === false`; `setRenderOffset`/`setOpacity` zero-alloc; `uColor` reflects
     `colorLinear`.
   - **Dispose:** geometries + materials of both disposed exactly once; the injected
     `noiseTexture.dispose` is NOT called (spy).
2. **Coverage gate:** statement coverage ≥ 85% on `src` (render-package precedent).
3. `pnpm verify` exits 0 (boundary lint: no React import anywhere in the package).

## Deliverables

- `packages/render-fx/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/render-fx/src/nebula.ts`, `src/line-set.ts`,
  `src/shaders/nebula.vert.glsl.ts`, `src/shaders/nebula.frag.glsl.ts`,
  `src/shaders/lineset.vert.glsl.ts`, `src/shaders/lineset.frag.glsl.ts`, `src/index.ts`
- `packages/render-fx/test/nebula.test.ts`, `test/line-set.test.ts`
- `packages/render-fx/README.md` (< 150 lines)

## Context Files

- `docs/architecture.md` §5.11 (nebulae + billboards-over-volumetrics doctrine), §5.9
  (point/billboard rendering patterns), §9 (budgets/overdraw), §10 (color pipeline +
  transparent layer order), §15 (shader naming)
- `docs/decisions/ADR-001-coordinates.md` §5 (renderer camera-relative contract)
- `packages/render-galaxy/src/dust-lanes.ts` + `src/impostor.ts` (the billboard
  `InstancedMesh` + offset-uniform + dispose patterns to copy — the closest precedent),
  `packages/render-galaxy/test/dust-lanes.test.ts` (zero-alloc test pattern)
- `packages/core-types/src/nebula.ts` (`NebulaField`, `NebulaLayer`, `MAX_NEBULA_LAYERS`)
