# Research — approach jitter persists on M1/phones (the hi/lo fix was only verified on Windows)

> Report (2026-07-14): "on this PC the jitter is basically gone, with the fix we
> made it runs perfectly; the problem is that on phones and on my Mac M1 there is
> jitter."

Prior doc: [star-approach-jitter.md](star-approach-jitter.md) — the original
diagnosis (catastrophic f32 cancellation on the GPU) and the chosen fix
(emulated-double hi/lo offset: `(position + offHi) + offLo`).

## Status: pre-investigation (questions + kill conditions, written before opening the code)

## Falsifiable questions

- **Q1** — Is the star vertex shader's hi/lo sum protected against compiler
  reassociation (`precise`, `invariant`, or a construct the optimizer cannot
  reorder)? Parentheses alone are **not** a guarantee under fast-math. Answered by
  reading `packages/render-stars/src/shaders/stars.vert.glsl.ts` and
  `star-points.ts` in their current state.
- **Q2** — Are all terms of that sum effectively `highp` in the vertex shader
  (attribute, uniforms, temporaries)? On mobile GPUs `mediump` can be real f16;
  on desktop it is always f32, which would also explain the Windows-fine/mobile-
  broken split. Answered by reading the shader's qualifiers.
- **Q3** — Was the fix ever verified on an Apple/mobile device, or only on this PC
  (ANGLE→D3D11)? Answered by finding the fix's probe or gate and where it ran.
- **Q4** *(requires the device)* — Does the jitter seen on the M1 have the same
  signature as the original bug — amplitude ~ULP of the tile magnitude
  (~0.4–0.8 AU), only on host-less stars, growing on approach — or is it another
  failure mode (frame pacing, DPR, half-float render target)? Answered with a
  console probe on the Mac, not here.

## Kill conditions (written before investigating)

- **KC1** — If Q1 says "not protected": the premise "the fix works" dies; it works
  *where the compiler does not reassociate*. The work stops being "research the
  jitter on the Mac" and becomes "harden the hi/lo sum against fast-math + a
  10-minute on-device probe to confirm." The Mac becomes a measurement bench, not
  a research site.
- **KC2** — If Q1/Q2 say "protected and all highp": the compiler/precision
  hypothesis dies from the desktop, and the investigation **does** have to happen
  on the device (Q4 becomes the center).
- **KC3** — If the on-device probe (Q4) shows amplitude that does **not** scale
  with the tile magnitude nor with proximity: the premise "it's the same precision
  bug" dies → reframe (it's another bug with the same symptom).

## Claims

```
CLAIM:    The star vertex shader's hi/lo sum depends solely on the source
          parenthesization; there is no anti-reassociation construct in the
          shader or in any shader in the repo.
EVIDENCE: packages/render-stars/src/shaders/stars.vert.glsl.ts:31 —
          `mat3(viewMatrix) * ((position + uRenderOffsetHi) + uRenderOffsetLo)`;
          grep `precise|invariant|#pragma` in packages/**/*glsl* → 0 matches.
VERIFIED: 2026-07-14
RECHECK:  rg "precise|invariant|#pragma" packages -g "*glsl*" ; read
          stars.vert.glsl.ts line 31.
```

```
CLAIM:    The `precise` qualifier does NOT exist in WebGL2 (GLSL ES 3.00): a
          `#version 300 es` vertex shader with `precise vec3 r = (pos + uHi) + uLo;`
          fails to compile with "'precise' : undeclared identifier", while the
          same shader without `precise` compiles. The mitigation cannot be a
          qualifier — it has to be structural.
EVIDENCE: live compilation via gl.compileShader in Chrome (win32), 2026-07-14;
          output: plain ok=true, withPrecise ok=false with that error.
VERIFIED: 2026-07-14
RECHECK:  in any page's console: create canvas → getContext('webgl2') → compile
          both vertex shaders and compare COMPILE_STATUS.
```

```
CLAIM:    The PC where "there is no jitter" compiles the shaders via
          ANGLE→Direct3D11 (AMD RX 9070 XT). That is, the only environment where
          the fix was validated uses a different backend from every environment
          that fails (M1 and phones = Metal / mobile GPUs).
EVIDENCE: WEBGL_debug_renderer_info on this machine, 2026-07-14: "ANGLE (AMD,
          AMD Radeon RX 9070 XT ... Direct3D11 vs_5_0 ps_5_0, D3D11)".
VERIFIED: 2026-07-14
RECHECK:  gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) on each device; on the M1
          a "... Metal ..." renderer is expected (record it when measuring).
```

```
CLAIM:    The CPU offset split is correct: hi = Math.fround(f64 component),
          lo = exact f64 residual stored in its own slot. The error, if any, is
          not on the CPU side.
EVIDENCE: packages/render-stars/src/star-points.ts:77-92.
VERIFIED: 2026-07-14
RECHECK:  read setRenderOffset in star-points.ts.
```

```
CLAIM:    All terms of the sum are f32 highp: three@0.184.0 injects
          `precision highp float;` into ShaderMaterial programs and the repo
          declares no precision overrides. mediump/f16 is not the mechanism.
EVIDENCE: node_modules/.pnpm/three@0.184.0/.../build/three.module.js:3410
          (`precision highp float;`); grep `precision|highp|mediump` in
          packages/render-stars/src → 0 matches.
VERIFIED: 2026-07-14
RECHECK:  both greps.
```

```
CLAIM:    The fix's only regression guard is a TEXT test — it checks that the
          shader string contains the sum with that parenthesization
          (`expect(VERT).toContain(...)`). No gate exercises the shader COMPILED
          by a real driver; JitterProbe still measures the f64→fround path of a
          small result (the blind spot documented in star-approach-jitter.md §5
          is still open).
EVIDENCE: packages/render-stars/test/star-points.test.ts:76-81;
          apps/web/src/scene/JitterProbe.tsx:122-124; fix = commit 6bd7d24
          (2026-06-28), with no associated on-device probe.
VERIFIED: 2026-07-14
RECHECK:  read star-points.test.ts:76-81 and JitterProbe.tsx:109-126.
```

## Beliefs (second class — no local mechanical RECHECK; do NOT cite as Step 0)

- **The proposed cause:** Metal compilers (Safari macOS/iOS, and Chrome macOS via
  ANGLE→Metal) compile with fast-math by default, which permits reassociating
  float sums: `(position + Hi) + Lo → position + (Hi + Lo)` collapses Lo into Hi
  and reproduces exactly the original bug of star-approach-jitter.md. It is the
  classic failure mode of emulated-double tricks in shaders (documented in
  deck.gl/luma.gl fp64 and in ANGLE Metal-backend issues). Consistent with the
  observed split (D3D11 fine / Metal+mobile broken), but only the on-device A/B
  (Q4) confirms it.
- ANGLE→D3D11 preserves the IEEE order of the expression (which is why this PC
  does not jitter) — inference, not measurement.
- In GLSL ES 3.00 the vertex shader mandatorily supports highp f32; the f16 path
  is ruled out by spec, not by on-device measurement.

## What I looked for and did not find

- **No anti-fast-math protection in any shader**: grep `precise|invariant|#pragma`
  over `packages/**/*glsl*` → 0 results.
- **No precision override** in render-stars: grep `precision|highp|mediump` in
  `packages/render-stars/src` → 0 results.
- **No gate exercising the compiled shader** (neither local nor CI): searching for
  "jitter" in apps/web returns only JitterProbe (per-object f64 path, known blind
  spot) and unrelated probes. The fix never had verification on a backend other
  than D3D11.
- **`precise` as an easy out**: it does not exist in WebGL2 (measured, see claim 2).

## Verdict — REFRAME

The entry question was "should I do the research on the Mac?". **No**: the implicit
premise — "the fix works and on mobile there is a new bug to investigate over there"
— died at the desk. What claims 1, 3 and 6 show is that the fix **was never
guaranteed**: its correctness depends on the textual order of a sum that no standard
requires to be respected, it was validated on a single backend (ANGLE→D3D11), and
its only guard is a string test. The environments that fail are exactly the
fast-math backends (Metal/mobile). KC1 triggered.

**What's next** (for a spec-task, not more research):

1. Harden the hi/lo sum against reassociation in `stars.vert.glsl.ts` — `precise`
   does not exist in WebGL2 (claim 2), so the option is structural (e.g. the
   deck.gl fp64 trick: interpose a uniform ≡ 1.0 the compiler cannot fold, or
   another opaque way to force the order). Choosing the variant is the spec's job.
2. The Mac M1 enters as a **10-minute measurement bench**, not a research site:
   A/B the build with and without the guard, flying to a host-less star. Record
   the UNMASKED_RENDERER (claim 3 RECHECK) and whether the jitter disappears. That
   A/B is the definitive RECHECK of the causal Belief.
3. Close the §5 blind spot of star-approach-jitter.md: a probe that exercises the
   real compiled shader (not a string match) — the only way a future driver/
   compiler change can't reintroduce this silently.
4. **Only if** the on-device A/B does NOT remove the jitter → KC3: it's another bug
   with the same symptom, and only then does on-device root-cause apply (signature
   probe: amplitude ~ULP of the tile? only host-less stars? grows on approach?).

## Addendum — TASK-077 implementation (2026-07-14)

Guard implemented and the compiled-shader gate is green on the CI backend
(ANGLE→Vulkan/SwiftShader, chromium). Two findings during execution:

1. **The spec-frozen `aAbsMag = 31.6` rendered the star invisible.** The shader
   (TASK-076) computes apparent magnitude from the *floored* distance
   `dPc = max(length(viewPos), 0.001)` pc (≈ 206 AU). At 1 AU the star sits far
   inside that floor, so its magnitude is evaluated at 0.001 pc, not at 1 AU. With
   31.6 that gives apparent magnitude ≈ 11.6 → brightness ~1e-5 → zero pixels above
   threshold (measured: full-frame scan `bestLum = 10` = background, `count = 0`).
   The spec derived 31.6 from the *true* 1 AU distance and overlooked the floor.
   Correction: `aAbsMag = 20.0` (apparent magnitude ≈ 0 at the floored distance →
   ~8 px point, `bestLum = 252`, 16 px above threshold, screen-centered). The floor
   affects only size/brightness, **not** `gl_Position`, so the jitter measurement
   (centroid position) is unchanged.

2. **Post-guard on SwiftShader/ANGLE: `maxDeviationPx = 0.000`, `lostFrames = 0`,
   300/300 frames.** Expected — this backend does not reassociate (it is the same
   D3D11-class path that already looked clean). The gate confirms the shader
   **compiles** with `invariant gl_Position;` + `uGuardOne` and that the point is
   stable here; the fast-math failure mode still awaits the on-device A/B (Mac M1 /
   phone), where reassociation can appear. The four pre/post × M1/phone numbers go
   here once the bench is run.
