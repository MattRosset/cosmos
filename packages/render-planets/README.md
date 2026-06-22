# @cosmos/render-planets

Phase-2 planet rendering: PBR-ish textured spheres, day/night terminator, Saturn-style rings, and orbit-line polylines.

No React, no data fetching, no texture loading — all injected by the caller.

## API

```ts
import { createPlanetMesh, createOrbitLine } from '@cosmos/render-planets';
```

### `createPlanetMesh(opts)`

Returns a `PlanetMesh` — a `THREE.Group` (sphere + optional ring) driven by per-frame calls.

```ts
const pm = createPlanetMesh({
  record,                  // PlanetRecord from @cosmos/core-types
  contextUnitMeters,       // e.g. 1 AU = 1.495978707e11 m
  albedoTexture?,          // pre-loaded THREE.Texture (KTX2 is the app's job)
  ringTexture?,
  widthSegments?,          // default 64
  heightSegments?,         // default 48
});

scene.add(pm.object);

// Per frame:
pm.setRenderOffset([x, y, z]);    // camera-relative position, context units
pm.setStarDirection([x, y, z]);   // unit vector planet→star
pm.setSpinAngleRad(angle);        // sidereal rotation angle, radians

// Cleanup:
pm.dispose(); // never disposes injected textures
```

**Sphere shader** — Lambert-like with smooth terminator:
```glsl
light = 0.035 + 0.965 * smoothstep(-0.08, 0.12, dot(N, uStarDir));
```
Records with `unlit: true` (e.g. Sol) skip lighting entirely.

**Ring annulus** — created when `record.ring` is set; UVs are radial (`u=0` at inner, `u=1` at outer) so a 1-D strip texture maps correctly.

### `createOrbitLine(opts)`

```ts
const ol = createOrbitLine({
  pointsUnits,       // Float32Array (N+1)×3, parent-relative context units
  colorLinear?,      // default [0.35, 0.45, 0.60]
  opacity?,          // default 0.55
});

scene.add(ol.object);

// Per frame:
ol.setRenderOffset([x, y, z]); // camera-relative position of parent body

ol.dispose();
```

The position buffer is shared directly — no copy.

## Atmosphere (Phase 4)

`createAtmosphere(opts)` returns an inverted-shell mesh running the **O'Neil analytic
single-scattering** shader (Sean O'Neil, *Accurate Atmospheric Scattering*, GPU Gems 2
ch. 16) — explicitly *not* Bruneton precomputed scattering. See
[ADR-005](../../docs/decisions/ADR-005-atmospheric-scattering.md).

```ts
import { createAtmosphere } from '@cosmos/render-planets';

const atm = createAtmosphere({
  planetRadiusUnits,  // planet surface radius in CONTEXT UNITS (e.g. AU)
  params?,            // AtmosphereParams; absent fields fall back to ATMOSPHERE_DEFAULTS
  widthSegments?,     // default 64
  heightSegments?,    // default 48
});

scene.add(atm.object); // mount in the §10 transparent band: after the opaque planet,
                       // before orbit lines

// Per frame (all zero-alloc):
atm.setRenderOffset([x, y, z]); // camera-relative shell-center position, context units
atm.setStarDirection([x, y, z]); // unit vector planet→star
atm.setExposure(v);
atm.setOpacity(a);               // cross-fade [0,1]

atm.dispose();
```

- **Shell:** sphere of radius `planetRadiusUnits × atmosphereRadiusScale` (default 1.025),
  `side: THREE.BackSide` so the inner surface shows from inside or outside the shell.
- **Material:** `transparent`, `depthWrite: false`, **additive** over the lit planet
  (it adds in-scattered light). Rayleigh + Henyey-Greenstein-Mie phases, `uSamples = 5`
  fixed in-scatter samples — no LUT, no marching loop.
- **Defaults** come from `ATMOSPHERE_DEFAULTS` in `@cosmos/core-types` (single source of
  truth); a partial `params` overrides only the fields it sets.
- **Quality gating is the app's job** — this package never reads quality state. The app
  mounts/unmounts the shell from `useQuality().atmosphereEnabled` (ADR-005 §5).

## Constraints

- No React, no texture loading, no `coords` import.
- All `set*` methods are zero-allocation.
- `dispose()` never disposes injected textures.
- Tested with jsdom (no GPU required).
