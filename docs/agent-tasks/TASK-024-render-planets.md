# Task: `render-planets` v1 — textured spheres, terminator, rings, orbit lines

**ID:** TASK-024
**Target package:** `packages/render-planets` (new)
**Size:** L
**Phase:** 2 — lane J (render)
**Depends on:** TASK-018

## Goal

Phase-2 planet rendering per architecture §5.10: PBR-ish custom-shader **spheres**
(albedo texture for solar-system bodies, flat procedural color for exoplanets),
day/night terminator from the star direction, Saturn's rings as an alpha-textured
annulus, and orbit-line polylines. **No chunked terrain, no atmospheres** (the #1
scope trap — spheres are 90% of perceived value). Like `render-stars`: no React,
no data fetching, no `coords` import — camera-relative offsets and pre-loaded
`THREE.Texture` objects are injected by the caller. Fully testable with jsdom
(no GPU).

## Frozen Interface

```ts
// public API of @cosmos/render-planets
import type * as THREE from 'three';
import type { PlanetRecord } from '@cosmos/core-types';

export interface PlanetMeshOptions {
  readonly record: PlanetRecord;
  /** Meters per context unit of the mounting context (system: 1.495978707e11). */
  readonly contextUnitMeters: number;
  /** Pre-loaded textures (KTX2 loading is the app's job). */
  readonly albedoTexture?: THREE.Texture | null;
  readonly ringTexture?: THREE.Texture | null;
  /** Sphere resolution. Defaults: widthSegments 64, heightSegments 48. */
  readonly widthSegments?: number;
  readonly heightSegments?: number;
}

export interface PlanetMesh {
  /** Group containing the sphere (+ ring annulus when record.ring is set). */
  readonly object: THREE.Group;
  /** Per frame: camera-relative position of the planet CENTER, context units.
   *  Copies into object.position — ZERO allocations. */
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  /** Per frame: unit vector planet→star, context axes. Ignored when unlit. */
  setStarDirection(dirUnit: readonly [number, number, number]): void;
  /** Per frame: rotation about the (tilted) spin axis, radians. */
  setSpinAngleRad(angleRad: number): void;
  setVisible(visible: boolean): void;
  /** Disposes geometry + materials. NEVER disposes injected textures. */
  dispose(): void;
}

export function createPlanetMesh(opts: PlanetMeshOptions): PlanetMesh;

export interface OrbitLineOptions {
  /** Closed polyline, parent-relative CONTEXT UNITS, (N+1)×3 f32 (from
   *  orbits.orbitPolylineAu — already rotated to context axes by the caller). */
  readonly pointsUnits: Float32Array;
  /** Linear RGB. Default [0.35, 0.45, 0.60]. */
  readonly colorLinear?: readonly [number, number, number];
  /** Default 0.55. */
  readonly opacity?: number;
}

export interface OrbitLine {
  readonly object: THREE.Line;
  /** Per frame: camera-relative position of the PARENT body, context units. */
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createOrbitLine(opts: OrbitLineOptions): OrbitLine;
```

## Construction & shader spec (fixed — transcribe, don't redesign)

- **Scale:** sphere geometry is unit-radius, scaled once at creation to
  `record.radiusKm * 1000 / contextUnitMeters` (f64 math, then set). Throw
  `RangeError` if `radiusKm` is missing/non-positive.
- **Axial tilt:** an inner "tilt" group rotated about +X by
  `record.axialTiltRad ?? 0` at creation; `setSpinAngleRad` writes
  `sphereMesh.rotation.y` inside it. The ring annulus lives in the tilt group
  (rings share the equatorial plane).
- **Sphere material** — custom `ShaderMaterial` (§10 chunk conventions, uniforms
  `u*`, varyings `v*`):
  - Vertex: standard MVP; pass `vNormalWorld` (normal matrix × normal) and `vUv`.
  - Fragment: base color = `texture2D(uAlbedo, vUv).rgb` when `uHasAlbedo`,
    else `uBaseColor` (from `record.surfaceColorLinear`, default
    `[0.5, 0.5, 0.5]`).
    Lighting: `light = 0.035 + 0.965 * smoothstep(-0.08, 0.12, dot(N, uStarDir))`
    — the smoothstep IS the day/night terminator (§5.10). `unlit` records skip
    lighting entirely (`light = 1.0`).
  - No tone mapping here — scene-host owns the color pipeline (§10). Textures:
    caller sets color space; material does not touch `colorSpace`.
- **Ring annulus** (only when `record.ring` present): `THREE.RingGeometry` with
  inner/outer radii from `RingSpec` (km → context units, same conversion),
  64 theta segments. **Rewrite the UVs radially** (three's RingGeometry UVs are
  planar): `u = (r − inner) / (outer − inner)`, `v = 0.5` — so a 1-D ring strip
  texture maps correctly. Material: `ShaderMaterial`, `transparent: true`,
  `side: THREE.DoubleSide`, `depthWrite: false`; color =
  `texture2D(uRingTex, vUv)` when provided else `vec4(0.6, 0.55, 0.45, 0.5)`;
  brightness × `(0.05 + 0.95 * abs(dot(uRingNormalWorld, uStarDir)))`.
- **Orbit line:** `THREE.Line` + `LineBasicMaterial`
  (`transparent: true`, given opacity, `depthWrite: false`); geometry position
  attribute wraps `pointsUnits` WITHOUT copying.
- All `set*` methods write into preallocated uniforms/vectors — zero allocations
  (§9); geometry and materials are created exactly once per mesh.

## Inputs / Outputs

- **Inputs:** synthetic `PlanetRecord` fixtures (Earth-like with tilt + rotation;
  Saturn-like with `ring`; exo-like with only `surfaceColorLinear`; Sol-like with
  `unlit: true`); `contextUnitMeters = 1.495978707e11`.
- **Outputs:** for Earth (radiusKm 6371) the sphere world scale is
  `6371e3 / 1.495978707e11 ≈ 4.2588e-5` context units.

## Constraints & Forbidden Actions

- Do not modify `core-types`. **No React** (lint-enforced for `render-*`), no data
  fetching, no texture loading (KTX2Loader is `apps/web`'s problem), no `coords`
  import.
- Allowed dependencies: `three`, `@cosmos/core-types`.
- No allocations in any `set*` method.
- No `Math.random()` — fixtures use `createPrng`.
- Do NOT add atmosphere shells, cube-sphere mapping, or LOD switching (Phase 4;
  §5.10 phase split is explicit).

## Common Mistakes (architecture §5.10 — copy kept verbatim)

- Starting with chunked terrain (the #1 scope trap — textured spheres are 90% of
  perceived value at 5% of cost; chunked terrain only matters below ~2× planet
  radius).
- Texture pole pinching with naive UV spheres — use cube-sphere mapping when
  terrain arrives; tolerate UV spheres for Phase 2.
- Cracks between terrain chunks — n/a in Phase 2.
- Atmosphere shader perf — n/a in Phase 2 (do not add one).
- Plus: disposing injected textures in `dispose()` (the app shares them across
  remounts); ring UVs left planar (texture renders as a smeared disc); scaling via
  geometry parameters instead of object scale (forces geometry rebuilds).

## Acceptance Tests

The task is DONE only when these pass in CI (visual baselines arrive with TASK-029):

1. `pnpm --filter @cosmos/render-planets test` (Vitest, jsdom; no GPU):
   - Scale: Earth fixture → group's sphere scale within 1e-9 relative of
     `4.2588e-5`; missing radius throws `RangeError`.
   - Tilt/spin: tilt group rotation.x equals `axialTiltRad`; `setSpinAngleRad(θ)`
     sets sphere rotation.y = θ and allocates nothing (same-identity check).
   - Shader strings contain: `uStarDir`, the terminator `smoothstep(-0.08, 0.12`,
     the `0.035` ambient floor; unlit fixture's fragment shader contains no
     `uStarDir` lighting term (or a compiled `uUnlit` branch — assert the chosen
     mechanism explicitly).
   - Ring: present only when `record.ring` set; UV attribute of the ring geometry
     is radial — u at inner radius vertices ≈ 0, outer ≈ 1 (inspect attribute
     values); material flags `transparent`, `DoubleSide`, `depthWrite === false`.
   - Orbit line: position attribute shares `pointsUnits`' underlying buffer (no
     copy); material flags as specced.
   - `setRenderOffset`/`setStarDirection` mutate in place, zero allocation.
   - `dispose()`: sphere + ring geometry/materials disposed exactly once; injected
     texture's `dispose` NOT called (spy).
2. **Coverage gate:** statement coverage ≥ 85% on `src` (TASK-010 precedent).
3. `pnpm verify` exits 0 (boundary lint: no React import anywhere in the package).

## Deliverables

- `packages/render-planets/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/render-planets/src/planet-mesh.ts`, `src/ring.ts` (geometry + UV
  remap, pure helper exported for tests), `src/orbit-line.ts`,
  `src/shaders/planet.vert.glsl.ts`, `src/shaders/planet.frag.glsl.ts`,
  `src/shaders/ring.frag.glsl.ts`, `src/index.ts`
- `packages/render-planets/test/planet-mesh.test.ts`, `test/ring.test.ts`,
  `test/orbit-line.test.ts`
- `packages/render-planets/README.md` (< 150 lines)

## Context Files

- `docs/architecture.md` §5.10 (whole section), §9 (budgets), §10 (color
  pipeline + layer order), §15 (shader naming)
- `docs/decisions/ADR-001-coordinates.md` §5 (renderer contract)
- `packages/render-stars/src/star-points.ts` (offset-uniform + dispose patterns
  to copy), `test/star-points.test.ts` (zero-allocation test pattern)
- `packages/core-types/src/bodies.ts` (PlanetRecord fields from TASK-018)
