# Research — jitter when approaching a star inside the galaxy

> Reported symptom: "when we get very close to a star inside a galaxy it jitters, it
> starts jumping all over the place."

## TL;DR

The jitter is **not** a failure of the f64 floating origin (that path is correct and
tested). It is a **catastrophic f32 cancellation done on the GPU**: the star vertex
shader sums `position + uRenderOffset` in single precision, where both summands can
be **tens of parsecs** (up to ±32 pc, the size of the deepest octree leaf). The f32
ULP at that magnitude is **~0.4–0.8 AU**, and since `uRenderOffset` is recomputed
every frame as the camera moves, the rounded result hops between f32 buckets frame
to frame → the star "jumps all over the place" when you are a few AU from it.

It only happens with **Gaia/HYG catalog stars that have no associated system**:
those never trigger the context switch to `system` (AU units), so they keep being
rendered as octree sprites in parsec units.

**Recommended fix (surgical):** pass `uRenderOffset` as an f32 hi/lo pair
(emulated-double / render-to-eye) and have the shader do
`(position + offHi) + offLo`. By the Sterbenz lemma the near subtraction is exact in
f32 and the low part refines the offset → jitter eliminated, without repacking the
positions.

---

## 1. The precision architecture (what DOES work)

The project uses a floating origin with rebasing in f64 (`@cosmos/coords`, ADR-001):

- `packages/coords/src/frame-tree.ts` — f64 conversions between contexts.
- `packages/coords/src/origin.ts` — `toRenderSpace(pos, out)` computes
  `render = bodyLocal − cameraLocal` **in f64**, and only the caller does the
  downcast to f32.

Units per context (`packages/core-types/src/coords.ts`):

| context  | 1 unit | rebase threshold |
|----------|--------|------------------|
| universe | 1 Mpc (3.0857e22 m) | 10 000 u |
| galaxy   | **1 pc** (3.0857e16 m) | 10 000 u |
| system   | 1 AU (1.496e11 m) | 10 000 u |
| planet   | 1 km | 10 000 u |

For **individual** objects (planets, nebulae, markers), each frame does
`origin.toRenderSpace(pos)` per object → the camera-relative position is small and
the final `fround` is precise. This is what `JitterProbe.tsx` (`?debug=jitter`)
validates: camera orbiting a marker at 1 AU, 8 kpc from the center, max deviation
< 0.5 px. **That gate passes and will keep passing — it does not cover this bug**
(see §5).

## 2. The star path is different (the GPU does the subtraction in f32)

Field stars are drawn in **a single draw call per tile** of the octree
(`packages/render-stars/src/star-points.ts`). There is no per-star `toRenderSpace`;
there is:

- A `position` attribute (f32) = **tile-local position in parsecs**, relative to the
  tile center. It is encoded as `s.x − center[x]` in
  `tools/pack-octree/src/encode.ts:46` and stored in a `Float32Array`.
- A `uRenderOffset` uniform (f32, `THREE.Vector3`) = the tile center in
  camera-relative coordinates, fed each frame by `origin.toRenderSpace(originPc)`
  (`apps/web/src/scene/GalaxyScene.tsx:487-501`).

The vertex shader (`packages/render-stars/src/shaders/stars.vert.glsl.ts:22`):

```glsl
vec3 viewPos = mat3(viewMatrix) * (position + uRenderOffset);
```

`position + uRenderOffset` is evaluated **in f32 on the GPU**. The star's real
camera-relative position is the difference (near cancellation) of two f32 numbers
that, close to the star, are both ~the same in tile magnitude.

## 3. The magnitude — why it jumps ~0.4–0.8 AU

The Gaia octree (`apps/web/public/packs/octree-gaia/octree.json`):

- `rootHalfExtentUnits: 65536` pc.
- Measured real depth: up to **level 11**, deepest leaf `halfExtentUnits = 32` pc
  (1267 tiles, 1093 leaves).

⇒ `position` (tile-local) can be up to **±32 pc** in f32. The f32 ULP at that
magnitude:

| `position` magnitude | ULP in f32 | in meters | in AU |
|----------------------|------------|-----------|-------|
| 32 pc (leaf edge)    | 3.8e-6 pc  | 1.18e11 m | **0.79 AU** |
| 16 pc                | 1.9e-6 pc  | 5.9e10 m  | **0.39 AU** |
| 1 pc                 | 1.2e-7 pc  | 3.7e6 m   | 0.025 AU |

When you are *inside* the tile, next to the star, `uRenderOffset ≈ −position` (same
magnitude, opposite sign). The f32 sum rounds to steps of ~ULP of that magnitude.
Since `uRenderOffset` changes continuously (the camera moves fractions of an AU per
frame), the rounded result **hops between f32 buckets every frame** → jitter of
amplitude ~0.4–0.8 AU. A few AU from the star that is a huge fraction of the screen
= "jumps all over the place." It matches the report exactly.

Note: the f32 `position` attribute already has a *static* error of ~sub-AU (fixed
per star, it does not jump — it just shifts slightly). The **jitter** is produced by
the *dynamic* term (`uRenderOffset`) re-quantizing every frame.

## 4. Why it only happens with "any" catalog star

There is a galaxy→system context switch at 5000 AU from the body
(`packages/nav/src/context-switch.ts`, `enterSystemAtM: 7.5e14`). In `system` the
units are AU and each body uses per-object `toRenderSpace` (correct f64 path) → no
jitter.

**But** that switch is only armed for registered *host systems*: the scan
`combined.nearestHostSystem()` (`packages/data/src/combined.ts:249`) walks
`hostBySystemId`, which is the curated set (Sol + exoplanet hosts), **not** the full
Gaia/HYG field (`apps/web/src/scene/NavDriver.tsx:132-144`).

⇒ If you fly toward Sol or an exoplanet host → it descends to `system`, no jitter.
⇒ If you fly toward any catalog star (no planets) → it never anchors, never switches
context, keeps being drawn as an octree sprite in pc via the f32 sum → **jitter**.

## 5. Blind spot of the acceptance gate

`JitterProbe.tsx` measures the correct path but does **not** reproduce this bug:

```js
// JitterProbe.tsx:114-126
origin.toRenderSpace(MARKER, renderScratch); // f64 → small value (~1 AU)
const fx = Math.fround(tx);                   // fround of the small result
markerRef.current.position.set(fx, fy, fz);
```

It does `fround` of the **already small** result (~1 AU, tiny ULP). It never sums
two f32 summands of ~30 pc like the real shader. That is why the gate is green while
the bug exists. Any fix should come with a probe variant that exercises
`position(f32, ~30 pc) + uRenderOffset(f32, ~−30 pc)`.

## 6. Fix options

### A — Emulated-double (hi/lo) offset in the star shader  ✅ recommended
Pass `uRenderOffset` as two f32 uniforms: `offHi = fround(off)` and
`offLo = fround(off − offHi)`, computed on the CPU from the f64 of `toRenderSpace`.
The shader does `(position + offHi) + offLo`.

- By **Sterbenz**, `position + offHi` (two f32 of similar magnitude and opposite
  sign, within a factor of 2) is **exact** in f32; `+ offLo` refines with the low
  part of the offset → the dynamic term stops quantizing → **jitter eliminated**.
- Residual: the static error of the f32 `position` attribute (~sub-AU, invisible).
- Cost: 1 extra uniform + 1 shader line + offset split per frame. Minimal change,
  aligned with the floating-origin design. Applies to **all** stars, anchored or
  not.
- If sub-AU precision is later needed in the attribute too, pack `position` as a
  hi/lo pair (6 f32) — not necessary to kill the current jitter.

### B — Smaller leaves (deeper octree)
Reduces `|position|` and therefore the ULP. It is palliative: it does not scale when
you approach arbitrarily, and it enlarges the pack. Does not fix the cause.

### C — CPU rebase of the near tile per frame
Recompute in f64 the positions of the single tile the camera occupies, relative to
the camera, and re-upload the buffer. Correct but implies an upload per frame; more
expensive and more invasive than A.

### D — Extend the descent to `system` context to any star
Create a "bare" `system` frame (no planets) for any body you approach. A
longer-term product solution (defines what is seen on arrival); orthogonal to the
jitter. It is not the bug fix.

**Recommendation:** A as the targeted jitter fix + a probe that covers the real path
(§5). C/D remain as evolution, not as a requirement to close this.

## 7. Relevant files

- `packages/render-stars/src/shaders/stars.vert.glsl.ts` — the f32 sum (cause).
- `packages/render-stars/src/star-points.ts` — `uRenderOffset` uniform.
- `apps/web/src/scene/GalaxyScene.tsx:487-501` — the per-frame offset feed.
- `tools/pack-octree/src/encode.ts:46` — tile-local f32 positions.
- `apps/web/public/packs/octree-gaia/octree.json` — min leaf `halfExtent=32` pc.
- `packages/nav/src/context-switch.ts`, `apps/web/src/scene/NavDriver.tsx:132` —
  why it only affects host-less stars.
- `apps/web/src/scene/JitterProbe.tsx` — gate with the blind spot (§5).
