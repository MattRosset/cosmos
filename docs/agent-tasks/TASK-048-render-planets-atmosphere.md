# Task: `render-planets` v2 — atmospheric scattering shell (O'Neil analytic)

**ID:** TASK-048
**Target package:** `packages/render-planets`
**Size:** M
**Phase:** 4 — lane (render); additive v2 of `render-planets`
**Depends on:** TASK-042

## Goal

Add a planetary **atmosphere** renderer to `render-planets`, per
[ADR-005](../decisions/ADR-005-atmospheric-scattering.md) and architecture §5.10: an
inverted-shell mesh with the **O'Neil analytic single-scattering** shader (explicitly
*not* Bruneton precomputed). It composes with the existing v1 sphere/ring/orbit-line API
(unchanged) and is gated by the quality tier at the app level (the §9 degradation order).
Earth gets a visible limb glow + day-side blue scatter + sunset reddening near the
terminator; the same shader serves any body given `AtmosphereParams`.

## Frozen Interface

Additive — the existing `createPlanetMesh` / `createOrbitLine` API is untouched.

```ts
import type * as THREE from 'three';
import type { AtmosphereParams } from '@cosmos/core-types';

export interface AtmosphereOptions {
  /** Planet surface radius in CONTEXT UNITS (e.g. AU for the system context). */
  readonly planetRadiusUnits: number;
  /** Scattering params; absent fields fall back to ATMOSPHERE_DEFAULTS (ADR-005 §3). */
  readonly params?: AtmosphereParams;
  readonly widthSegments?: number;  // default 64
  readonly heightSegments?: number; // default 48
}
export interface Atmosphere {
  readonly object: THREE.Object3D; // the inverted shell mesh (BackSide)
  /** Per frame: camera-relative shell-center position, CONTEXT UNITS. Zero alloc. */
  setRenderOffset(offsetUnits: readonly [number, number, number]): void;
  /** Per frame: unit vector planet→star (same convention as PlanetMesh). */
  setStarDirection(dir: readonly [number, number, number]): void;
  setExposure(v: number): void;
  /** Cross-fade alpha in [0,1]. */
  setOpacity(a: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}
export function createAtmosphere(opts: AtmosphereOptions): Atmosphere;
```

## Construction & shader spec (fixed — transcribe ADR-005, don't redesign)

- **Geometry:** a sphere of radius `planetRadiusUnits × atmosphereRadiusScale`
  (default 1.025), `material.side = THREE.BackSide` (inverted shell, ADR-005 §1–§2),
  `widthSegments/heightSegments` default 64/48 (matches `createPlanetMesh`).
- **Material:** custom `ShaderMaterial`, `transparent: true`, `depthWrite: false`,
  **additive** over the lit planet (it adds in-scattered light), drawn in the §10
  transparent band (the app mounts it after the opaque planet, before orbit lines).
- **Fragment:** the **O'Neil GPU-Gems-2 analytic single-scattering** integral with
  `uSamples = 5` in-scatter samples and the standard `scale()` optical-depth exp-fit
  (ADR-005 §1–§2); Rayleigh + Henyey-Greenstein-Mie phase functions; **no LUT textures,
  no marching loop beyond the fixed sample count**. Cite the reference in a comment
  (architecture §15: every formula cites its source).
- **Uniforms (ADR-005 §5, §10 naming):** `uStarDir`, `uRenderOffset`, `uPlanetRadius`,
  `uAtmosphereRadius`, `uBetaRayleigh`, `uBetaMie`, `uRayleighScaleHeight`, `uMieG`,
  `uSunIntensity`, `uCameraExposure`, `uOpacity`. Camera position in shell space is
  derived as `-uRenderOffset` (floating origin, ADR-001 §5) — **no absolute-position
  uniform**.
- **Defaults:** `params` fields absent ⇒ the matching `ATMOSPHERE_DEFAULTS` value (read
  the const from `core-types`; do not hard-code a second copy).
- **Quality gating:** `render-planets` does **not** read quality state. The atmosphere is
  mounted/unmounted by the app from `useQuality().atmosphereEnabled` (ADR-005 §5; the
  scene-host post-chain pattern). This task only exposes the object.
- All `set*` methods mutate preallocated uniforms — **zero allocations** (§9);
  geometry + material created once; `dispose()` never disposes anything injected (no
  textures are injected here, but keep the contract).

## Inputs / Outputs

- **Inputs:** `planetRadiusUnits` (e.g. Earth radius in AU for the system context), an
  optional `AtmosphereParams` (Earth uses defaults), per-frame star direction + offset.
- **Outputs:** a Three.js shell object the app mounts alongside the Earth `PlanetMesh`;
  one extra draw call per atmosphere.

## Constraints & Forbidden Actions

- Do not modify `core-types`. **Do not change** `createPlanetMesh`, `createOrbitLine`,
  their options, or the planet shaders — this is purely additive. Existing
  `render-planets` tests pass unmodified.
- **No React**, no data fetching, no texture loading, no `coords` import (offsets
  injected). Allowed dependencies: `three`, `@cosmos/core-types` (the existing set).
- No allocations in any `set*` method. No `Math.random()`.
- Do NOT implement Bruneton multiple-scattering, a precomputed LUT, or a ray-marched
  volumetric atmosphere (ADR-005 §1 / Alternatives — all rejected).
- Do NOT read or import quality state — gating is the app's job (ADR-005 §5).

## Common Mistakes (architecture §5.10 — copy kept verbatim where it applies)

- Atmosphere shader perf: full per-pixel ray-marched scattering — gate behind quality
  tier (here: app-gated; the shader itself is fixed-sample analytic, ADR-005 §1).
- Texture pole pinching / wrong winding — `BackSide` is required so the *inner* surface
  shows; a front-side shell vanishes when the camera is outside.
- sRGB/linear confusion — work in linear RGB (§10); `betaRayleigh` is linear-RGB.
- Allocating in the frame loop (`new THREE.Vector3()` in `set*`) — scratch is
  module-scoped (§9 / §15 frame-loop rules).
- Hard-coding the defaults instead of reading `ATMOSPHERE_DEFAULTS` (two copies drift).

## Acceptance Tests

The task is DONE only when these pass in CI (visual baseline arrives with TASK-053):

1. `pnpm --filter @cosmos/render-planets test` — new `test/atmosphere.test.ts`:
   - `object` is a sphere mesh with `material.side === THREE.BackSide`, `transparent`,
     `depthWrite === false`, additive blending; radius reflects
     `planetRadiusUnits × atmosphereRadiusScale` (default 1.025).
   - The fragment shader source contains the O'Neil `scale(`/sample-loop term with
     `uSamples`/`5`, and the material uniforms include all ADR-005 §5 names.
   - Absent `params` ⇒ uniforms equal `ATMOSPHERE_DEFAULTS` (assert `uMieG === -0.758`,
     the three `uBetaRayleigh` channels); a partial `params` overrides only its fields.
   - `setRenderOffset`/`setStarDirection`/`setExposure`/`setOpacity` mutate uniforms in
     place (same-identity zero-alloc check).
   - `dispose()` disposes the geometry + material exactly once.
2. **All existing `render-planets` tests pass unmodified.**
3. `pnpm verify` exits 0 (boundary lint: no React; package coverage ≥ existing threshold).

## Deliverables

- `packages/render-planets/src/atmosphere.ts`,
  `src/shaders/atmosphere.vert.glsl.ts`, `src/shaders/atmosphere.frag.glsl.ts`,
  `src/index.ts` (additive export of `createAtmosphere`)
- `packages/render-planets/test/atmosphere.test.ts`
- `packages/render-planets/README.md` (an "Atmosphere (Phase 4)" section)

## Context Files

- `docs/decisions/ADR-005-atmospheric-scattering.md` (the whole model + params + uniforms
  to transcribe)
- `docs/architecture.md` §5.10 (atmosphere requirement + common mistakes), §9 (quality
  gating / frame-loop rules), §10 (transparent layer order, color pipeline, uniform
  naming), §15 (cite formulas)
- `packages/render-planets/src/planet-mesh.ts` (the shader-material + `setRenderOffset` +
  `setStarDirection` + dispose patterns to copy; the star-direction convention),
  `test/planet-mesh.test.ts` (zero-alloc test pattern)
- `packages/core-types/src/atmosphere.ts` (`AtmosphereParams`, `ATMOSPHERE_DEFAULTS`),
  `packages/scene-host/README.md` (how the app gates `atmosphereEnabled` — for context,
  not imported here)
