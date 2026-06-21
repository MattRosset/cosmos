# ADR-005: Atmospheric Scattering Model (analytic single-scattering shell)

**Status:** Accepted
**Date:** 2026-06-21
**Refines:** architecture §5.10 (atmospheric scattering as a single analytic-approximation
shader on an inverted shell — *explicitly not* full Bruneton precomputed scattering), §9
(quality tiers), §10 (transparent layer order, uniform naming)

## Context

Phase 4 adds a visible atmosphere to planets that have one (Earth first; the same
shader serves any `PlanetRecord` carrying atmosphere params). Architecture §5.10 fixes
the *envelope* — "atmospheric scattering as a single analytic-approximation shader
(e.g., O'Neil-style) on an inverted shell — explicitly *not* full Bruneton precomputed
scattering" — and §9 fixes that it is *gated behind a quality tier*. It leaves the exact
model, parameters, shell geometry, uniform contract, and the fragment math undefined.

Three independent tasks must agree on this to interoperate: `core-types` (TASK-042) owns
the `AtmosphereParams` type, `render-planets` v2 (TASK-048) implements the shader, and
the Phase-4a gate (TASK-053) reviews a fixed visual baseline of the result. If each
restated the model they would drift, and an executing agent would be tempted to invent a
different scattering formulation. This ADR pins the model once so TASK-048 **transcribes**
rather than designs, and the baseline in TASK-053 is reproducible.

This ADR fixes the *model and contract*. The exact default parameter values for Earth
live in the planet/system pack and in `ATMOSPHERE_DEFAULTS` (§4 below), one source of
truth.

## Decision

### 1. Model: O'Neil analytic single-scattering on an inverted shell

The atmosphere is **one extra mesh** per planet: a sphere of radius
`atmosphereRadiusKm` (> the planet's `radiusKm`) rendered with **front-face culling**
(`THREE.BackSide`) so the camera sees its *inner* surface from inside or outside —
the "inverted shell" of §5.10. The fragment shader evaluates the **O'Neil
GPU-Gems-2-style analytic single-scattering** integral (Sean O'Neil, *Accurate
Atmospheric Scattering*, GPU Gems 2, ch. 16) along the view ray through the shell:
Rayleigh + Mie out-scattering with an optical-depth lookup approximated analytically
(the `scale()` exp-fit), and the standard Rayleigh + Henyey-Greenstein-approximated
Mie phase functions combined at the fragment. **No precomputed transmittance/scattering
LUT textures** (that is the Bruneton path §5.10 rejects); **no per-pixel ray marching
loop** beyond the fixed O'Neil sample count. This is single-scattering only — multiple
scattering is out of scope (documented limitation).

The atmosphere mesh is **transparent, additive-over-the-lit-planet** (it adds in-scattered
light), `depthWrite: false`, and is drawn in the §10 transparent layer band
(*after* opaque planet bodies, *before* orbit lines/overlays), back-to-front with other
transparent shells.

### 2. Shell geometry & sample count (fixed)

- Shell radius ratio: `atmosphereRadiusKm = planet.radiusKm × atmosphereRadiusScale`,
  `atmosphereRadiusScale` default **1.025** (≈ 160 km for Earth — the visible-limb
  thickness; documented approximation, not the Kármán line).
- Mesh: an icosphere/UV sphere at `widthSegments`/`heightSegments` **64 / 48** (matches
  `render-planets` planet mesh defaults), material `side: THREE.BackSide`.
- O'Neil out-scattering integral: **`uSamples = 5`** in-scatter sample points along the
  ray (O'Neil's "nSamples"); the optical-depth `scale()` term uses the standard
  exp-polynomial fit (transcribe from the reference; do not re-fit). These are fixed so
  the visual baseline is stable across machines.

### 3. Scattering parameters (fixed defaults, Earth-like)

All wavelengths in the **linear RGB** working space (§10). Earth defaults
(`ATMOSPHERE_DEFAULTS`):

- Rayleigh scattering coefficient `betaRayleigh` (per-channel, linear RGB):
  **`[5.8e-3, 13.5e-3, 33.1e-3]`** (the canonical 1/λ⁴ ratios, O'Neil's `Kr` family,
  normalized to the shell). Stored as a `readonly [number, number, number]`.
- Mie scattering coefficient `betaMie`: **`21e-3`** (scalar, grey).
- Rayleigh scale height fraction `rayleighScaleHeight`: **`0.25`** of the shell
  thickness (O'Neil's `fScaleDepth`).
- Mie scale height is folded into the same `scale()` fit (O'Neil uses one scale depth);
  no separate Mie height param.
- Mie phase asymmetry `mieG`: **`-0.758`** (forward-scattering, the O'Neil default).
- Sun intensity `sunIntensity`: **`20.0`** (the `ESun` term; tuned with `exposure`).
- These are the **single source of truth** in `core-types`' `ATMOSPHERE_DEFAULTS`;
  `AtmosphereParams` makes every field optional and the type's documented contract is
  "absent ⇒ the `ATMOSPHERE_DEFAULTS` value". Non-Earth atmospheres (e.g. a reddish
  exoplanet) override `betaRayleigh`/`sunIntensity` in their pack record.

### 4. `AtmosphereParams` (owned by core-types, TASK-042)

```ts
// src/atmosphere.ts (new) — ADR-005
export interface AtmosphereParams {
  /** Shell outer radius as a multiple of the planet radius (> 1). */
  readonly atmosphereRadiusScale?: number;        // default 1.025
  /** Rayleigh scattering coefficient, per-channel LINEAR RGB. */
  readonly betaRayleigh?: readonly [number, number, number]; // default [5.8e-3,13.5e-3,33.1e-3]
  readonly betaMie?: number;                       // default 21e-3
  readonly rayleighScaleHeight?: number;           // default 0.25 (fraction of thickness)
  readonly mieG?: number;                          // default -0.758
  readonly sunIntensity?: number;                  // default 20.0
}
/** The fixed Earth-like default table (single source of truth). */
export const ATMOSPHERE_DEFAULTS: Required<AtmosphereParams>;
```

`AtmosphereParams` is a standalone type (NOT added as a field on `PlanetRecord` in this
phase — that would re-thaw the frozen Phase-2 `bodies.ts`). The app/pack supplies an
`AtmosphereParams` to `createAtmosphere` for the bodies that have one (TASK-048/052).

### 5. Uniform contract (§10 naming) & quality gating

- Uniforms: `uStarDir` (unit vec3, planet→star, set per frame like the planet shader's
  `uStarDir`), `uRenderOffset` (camera-relative shell-center offset, context units),
  `uPlanetRadius`, `uAtmosphereRadius` (both context units), `uBetaRayleigh`, `uBetaMie`,
  `uRayleighScaleHeight`, `uMieG`, `uSunIntensity`, `uCameraExposure`, `uOpacity`
  (cross-fade). Camera position in shell space is derived from `uRenderOffset`
  (`cameraPosShell = -uRenderOffset`), never a separate absolute uniform (ADR-001 §5
  floating-origin rule).
- **Quality gating (§9):** the atmosphere mounts only when
  `QualitySettings.atmosphereEnabled` is true. The tier table (`QUALITY_TIERS`,
  scene-host) already sets `atmosphereEnabled: high=on, medium=off, low=off`. TASK-048
  exposes the object; the app (TASK-052) mounts/unmounts it from `useQuality()` exactly
  like the post chain's `<Atmosphere/>` slot in the scene-host README — render-planets
  itself does not read quality state.

## Alternatives Considered

- **Bruneton precomputed multiple-scattering:** higher fidelity but needs a precompute
  pass + 2D/3D LUT textures and is the §5.10-rejected path; rejected.
- **Per-pixel ray-marched volumetric scattering:** the §5.11 doctrine is
  billboards/analytic over ray-marching; too expensive on the Tier-Low budget; rejected.
- **Atmosphere as a screen-space post effect:** couples to the post chain and breaks
  for multiple simultaneous atmospheres / non-Earth bodies; the per-body shell composes
  cleanly with the existing planet meshes; rejected.
- **Adding `atmosphere` to `PlanetRecord`:** would re-thaw frozen Phase-2 `bodies.ts`
  for no functional gain; a standalone `AtmosphereParams` supplied by the app is enough.

## Consequences

- `core-types` (TASK-042) owns `AtmosphereParams` + `ATMOSPHERE_DEFAULTS` — one source
  of truth shared by the impl and the pack.
- `render-planets` v2 (TASK-048) transcribes §1–§3 + §5 into `createAtmosphere`; it
  imports Three.js only, no React, no `coords` (offsets injected), and never reads
  quality state (the app gates mounting).
- The Phase-4a gate (TASK-053) records a fixed Earth-atmosphere visual baseline and
  asserts the atmosphere is absent at tier `medium`/`low` (the §9 degradation contract).
- Changing any default or the sample count changes the baseline — treat as a new
  reviewed task, not a silent tweak (the ADR-004 doctrine).
