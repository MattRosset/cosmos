# The galaxy impostor's radius never reaches a pixel — `mesh.scale` is inert under its shader

**Date:** 2026-07-26
**Status:** measured, blocking TASK-082 as written
**Trigger:** Step 0 fact-check of `TASK-082-impostor-context-scale.md`

## Summary

TASK-082 is premised on the far-LOD Milky Way impostor being drawn at a **physical** size of
`radiusUnits`, and therefore being 1e6× oversized in `universe` context. That premise is
false. `radiusUnits` has **no effect on what is rendered, in any context**. The impostor is
always a plane of **one render-space unit**, so at galaxy distances it is sub-pixel and draws
nothing at all.

The fix TASK-082 specifies (convert `radiusUnits` per frame via `pcToUnits`) would therefore
change zero pixels, and its proposed unit test would pass while proving nothing.

## Why the radius is inert

`impostor.ts:42` bakes the radius with `mesh.scale.set(radiusUnits, radiusUnits, 1)`. In
three.js, `mesh.scale` reaches the GPU **only** through `modelMatrix` / `modelViewMatrix`.
The impostor's vertex shader (`shaders/impostor.vert.glsl.ts`) uses neither:

```glsl
vec3 camCenter = mat3(viewMatrix) * uRenderOffset;
vec3 viewPos   = camCenter + position;   // `position` = raw object-space attribute
gl_Position    = projectionMatrix * vec4(viewPos, 1.0);
```

`position` is the unscaled `PlaneGeometry(1, 1)` attribute (±0.5). The mesh's world matrix is
never consulted, so the drawn quad is 1 unit across whatever `radiusUnits` says. The source
comment at `impostor.ts:41` ("Scale bakes the radius into world space") states the opposite of
what the shader does.

## Measurement

Rendered the real `createGalaxyImpostor` offscreen (256×256, WebGL, solid-white 8×8 sprite,
`uOpacity = 1`), counted lit pixels. Temporary probe page, since deleted.

| case | `radiusUnits` | `mesh.scale.x` | lit px |
| --- | --- | --- | --- |
| positive control — centre 1 unit away | 1 | 1 | **49284** |
| same distance, 15000× the radius | 15000 | 15000 | **49284** |
| centre 1000 units away | 15000 | 15000 | **0** |
| centre 1000 units away | 1.5e10 | 1.5e10 | **0** |

Rows 1–2 are the finding: a 15000× radius change moves the lit-pixel count by **exactly
zero**, while the control proves the probe renders. Rows 3–4 show the consequence at
realistic distances: nothing is drawn.

The real feed is `milkyWayRadiusPc = 28,002.33 pc` (measured, see below) against offsets of
kiloparsecs, i.e. rows 3–4. **The impostor has never contributed a pixel in production.**

### Second defect found while measuring the feed

TASK-082 states the fed radius is "≈ 15,000 pc". It is not. `milkyWayRadiusPc` is
`milkyWay.radiusKpc * 1000`, and `milkyWay.radiusKpc` comes from `generateLocalGroup({seed:1})[0]`,
whose radius is a **random draw**, `rng.range(5, 50)` (`packages/nav/src/local-group.ts:39`).
Measured for the shipped seed:

| quantity | value | source |
| --- | --- | --- |
| `milkyWay.radiusKpc` | **28.00232553971** | `generateLocalGroup({seed:1})[0]` |
| `milkyWayRadiusPc` fed to the impostor | **28,002.33 pc** | `× 1000`, `StarApp.tsx:593` |
| `discRadiusPc` — streaming's half-extent for the same galaxy | **15,000 pc** | `PROCGEN_GALAXY_DEFAULTS`, via `ensureProcgenChunk` (`policy.ts:326`) |
| ratio | **1.867** | |

So the impostor's size is driven by a random local-group draw that has nothing to do with the
disc actually rendered, and disagrees by 1.87× with the half-extent the LOD system uses to
decide *when* to show the impostor. Latent until the radius reaches the GPU; then it matters.

## Where this actually bites (measured — corrects an earlier overstatement in this doc)

An earlier revision of this doc claimed "the far-LOD galaxy is empty, in galaxy context too".
That was wrong twice: it asserted the consequence without checking whether the handover
distance is reachable in galaxy context (it is not), and it fed `projectedPixelExtent` a
diameter when the function takes a **half**-extent (`sse.ts:31`, `halfExtentUnits`).

Re-measured with the production `projectedPixelExtent` / `STREAM_TAN_HALF_FOV` and the shipped
`lod` formula (`policy.ts:527`), using the real half-extent `discRadiusPc = 15,000 pc`.
`cloud`/`impostor` are `1 - smoothstep(2, 6, lod)` and its complement (`GalaxyScene.tsx:265`).
**The table is viewport-dependent** — both heights shown:

| distance | px @720 | lod | impostor | px @1024 | lod | impostor |
| --- | --- | --- | --- | --- | --- | --- |
| 10 kpc | 1871 | 0 | 0% | 2660 | 0 | 0% |
| 45 kpc | 416 | 1 | 0% | 591 | 0 | 0% |
| 100 kpc | 187 | 2 | 0% | 266 | 1 | 0% |
| 300 kpc | 62 | 4 | **50%** | 89 | 3 | **16%** |
| **600 kpc (0.6 Mpc)** | 31 | 5 | **84%** | 44 | 4 | **50%** |
| 1.7 Mpc | 11 | 6 | **100%** | 16 | 6 | **100%** |

So:

- **Galaxy context can never show the impostor.** `exitGalaxyAtM = 3.086e21 m`
  (`packages/nav/src/galaxy-switch.ts:23`) caps galaxy context at **100,009.7 pc**. At that
  edge the disc still projects 187 px (720) / 266 px (1024) ⇒ `lod` ≤ 2 ⇒ impostor opacity
  **exactly 0**. Measured critical viewport height: the impostor could only appear in galaxy
  context below **492.7 px** of canvas height. The e2e viewport is 1280×720
  (`e2e/playwright.config.ts:25`), so no galaxy-context baseline can move. This is why the
  breakage was invisible: in the Milky Way view the procgen cloud carries 100% of the visuals,
  by design.
- **The impostor only ever mattered in universe context.** At the `flythrough3` start
  (universe, 0.6 Mpc) it owes **84%** (720 px) of the galaxy's brightness and delivers 0%.
  That is a substantial dimming, not the marginal one an earlier revision estimated.
- **Priority.** Real defect, but its whole blast radius is the universe view, which is unbuilt
  (TASK-080's subject). Not an urgent galaxy-view regression.
- **The existing unit test is what hid it.** `test/impostor.test.ts:23` asserts
  `mesh.scale.x === radiusUnits` — a property of a value that never reaches the GPU. It is
  green today and would stay green through any of this. TASK-082's deliverable 3 proposes a
  second test in the same frame (`radiusUnits × CONTEXT_UNIT_METERS` invariance), which would
  also pass without a single pixel moving.
- **The impostor's offset unit is separately wrong.** `viewPos` is fed straight to
  `projectionMatrix`, so it must be in ACTIVE-CONTEXT units. Post-TASK-081 the procgen mount
  hands the impostor a **parsec** offset (`GalaxyScene.tsx:566-568, 283`), already flagged as
  knowingly-wrong-outside-galaxy at `GalaxyScene.tsx:274-278`. Any real fix has to settle both
  the radius and the offset unit together.

## Side observation (confounded — do not cite as a finding)

At the `soak3` universe apex (`universe`, 0.1 Mpc from centre, `procgenOpacity = 1`) the
viewport showed no Milky Way at all — not an oversized one. Consistent with the above, but the
camera's orientation at that instant was not verified, so this does not establish what the
procgen cloud does up there. That remains TASK-080's reporting job.

## The sibling that does it right

`dust-lanes` — same package, same billboard trick, same author-era — multiplies the attribute
by its radius explicitly (`shaders/dust.vert.glsl.ts`):

```glsl
vec3 viewPos = camCenter + vec3(position.xy * aRadius, 0.0);
```

That is exactly the multiplication the impostor is missing, and it is why the dust/HII sprites
*do* render (visible as the coloured blobs at the `flythrough3` Sol arrival). The impostor is
the odd one out, and the fix has a working, shipped template one file away.

## Sprite geometry (measured — needed to size the quad)

`createImpostorTexture()` is `radialSprite(256, 0.02)` (`apps/web/src/glue/galaxy-assets.ts:40`):
a radial gradient, opaque at the centre, alpha 0 at the canvas half-width. Sampled alpha along
a radius, as a fraction of the quad's half-width:

| r / halfWidth | 0 | 0.1 | 0.25 | 0.5 | 0.75 | 0.9 | 0.99 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| alpha | 255 | 238 | 198 | 132 | 65 | 26 | 1 |

Area coverage: alpha > 8 over 73.6% of the quad (an inscribed circle is 78.5%), alpha > 128
over 20.9%. Corner alpha 0. So **the glow's visible edge is the quad's half-width** and
half-brightness sits at half of it. `PlaneGeometry(1,1)` positions are exactly ±0.5, uv 0..1
(measured), so `position * K` yields a quad of half-width `K/2`.

## What a correct fix looks like

See `docs/agent-tasks/TASK-082-impostor-context-scale.md` (rewritten from this doc) for the
executable version. In outline: the vertex shader must apply a radius uniform to `position`
(copying `dust.vert.glsl.ts`), the radius and the offset must both be converted from parsecs
to active-context units by the same `pcScales` bridge TASK-081 introduced, the inert
`mesh.scale` write and its misdescribing comment must go, and the unit test must assert lit
pixels rather than `mesh.scale`.

Larger than TASK-082's stated **S**, but per the distance table the visible effect is confined
to universe context past ~0.3 Mpc. Galaxy-context baselines cannot move (impostor opacity is
exactly 0 there for any viewport ≥ 493 px), so TASK-082's "no galaxy baseline may move" gate
stands as a genuine regression check. Universe baselines will move.

## Related

- `docs/agent-tasks/TASK-082-impostor-context-scale.md` — the spec this blocks
- `docs/research/star-sprite-goes-dark-on-system-entry.md` — the bug class TASK-081 fixed
- `docs/agent-tasks/TASK-080-universe-ascent.md` — Decision 2 depends on what universe shows
