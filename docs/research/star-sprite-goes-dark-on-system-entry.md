# Root-cause — the star you fly into goes BLACK when the camera enters system context

**Date:** 2026-07-25
**Symptom as reported:** *"nos acercamos al sol en modo starfield, un punto grande y luminoso,
y lo chocamos y de repente estamos en vista sistema solar donde el sistema solar es algo muy
lejano casi minúsculo… la transición de un punto enorme brillante al sistema solar me hace
ruido."*

**Verdict up front:** the reported "jump" is **not** a positional or angular discontinuity —
the context switch is geometrically continuous to within measurement noise, exactly as
`controller.ts`'s continuity guard promises. What actually happens is that **the star field
stops emitting light** the moment the camera crosses into `system` context: the star's
rendered sprite goes from saturated (luma 255, 8 px wide) to background (luma 3, 0 px) in
**one frame**, while the same ~1.0–1.1 M points keep being submitted. The scale-mismatch
framing that opened this investigation (*"a 32 px sprite is replaced by a 5.7 px system"*)
was **wrong and is retracted** — the sprite is not replaced by a smaller thing, it is
extinguished.

---

## How this was measured

Live app (`pnpm --filter @cosmos/web dev`, ANGLE→D3D11 on an RX 9070 XT, ~167 fps), driven
through the **production path** — the real `dblclick`→`onActivate`→`goTo` route, plus
role-located HUD buttons — never a debug probe. All geometry read through
`window.__cosmos.projectToScreen`, which delegates to StarScene's **live camera closure**,
so no parallel camera model was reimplemented (CLAUDE.md testing rule 1). Rendered
brightness read with `gl.readPixels` on the live WebGL2 context inside a `requestAnimationFrame`
callback.

Two derived quantities, both from queried state:
- `nepPx` — the projected screen diameter of Neptune's orbit (30 units in `system`, the same
  30 AU expressed in pc in `galaxy`). A context-independent **geometric** scale reference.
- `blob` / `luma` — width in px of the contiguous bright region through the star's projected
  center, and its peak luminance, from a 300 px horizontal `readPixels` strip.

---

## CLAIM 1 — Geometry is continuous across the switch; brightness is not

```
CLAIM:    At the galaxy→system switch, with the camera in the same place, the projected
          geometry advances smoothly while the star's rendered sprite is extinguished in
          a single frame. Point count and catalog coverage are UNCHANGED across the flip,
          so the renderer did not stop drawing — the pixels stopped being lit.
EVIDENCE: MEASURED, one frame either side of the flip (sample 169 of 195):
            before  ctx=galaxy  nepPx=1.999  luma=255  blob=8px  pts=1109399  cov=1
            after   ctx=system  nepPx=2.020  luma=3    blob=0px  pts=1109399  cov=1
          Geometry: +1.05 % on nepPx (continuous). Brightness: 255 → 3 (background).
          A second run reproduced the flip with pts=1004231, cov=1 unchanged.
VERIFIED: 2026-07-25
RECHECK:  Drive the production dblclick onto Sol; sample per frame
          {contextId, projectToScreen([0,0,0]), projectToScreen([30,0,0]), readPixels strip}.
          The flip frame must show luma collapsing while nepPx moves < 2 %.
```

## CLAIM 2 — In system context the whole field is dark, not just Sol

```
CLAIM:    Immediately after the crossing, a canvas of 287,508 px contains exactly TWO
          pixels above luma 30 (peak 172, zero saturated) while 1,004,231 points are
          being rendered. On the galaxy side the same field is ~160× brighter per pixel.
EVIDENCE: MEASURED full-canvas scans:
            system, just past the flip (nepPx 1.686): n(luma>=30)=2, n>=100=2, n>=250=0,
              max=172, pts=1004231, canvas=287508 px  →  0.0070 bright px per 1000
            galaxy, boot vantage (0.0616 pc):          n>=30=28, n>=100=12, n>=250=5,
              max=255, pts=1004231, canvas=24765 px   →  1.13 bright px per 1000
          Ratio ≈ 160×.
          DECLARED CONFOUND: the Browser pane was resized between the two scans
          (287,508 px vs 24,765 px), so the two are compared as DENSITIES, not counts.
          The direction of the effect is far larger than any plausible framing artifact
          (zero saturated pixels vs five; peak 172 vs 255), but a same-viewport A/B has
          NOT been run and should be, before anyone cites the 160× as a precise figure.
VERIFIED: 2026-07-25
RECHECK:  Full-canvas readPixels in each context WITHOUT resizing the pane between them.
```

## CLAIM 3 — The star's disc is sub-pixel on BOTH sides: the bright blob was never geometry

```
CLAIM:    The Sun's geometric angular size is ~0.0009 px at the switch distance and
          ~0.058 px even at the 75 AU arrival vantage — i.e. always far below one pixel.
          Everything the user perceives as "un punto grande y luminoso" is therefore the
          point-sprite size CONVENTION (magnitude → px, clamped), not the object.
EVIDENCE: MEASURED via projectToScreen:
            at the crossing (~5,000 AU): sun disc 0.00088 px (both contexts), Neptune
              orbit 5.67 px → 5.69 px
            at arrival (75.175 AU):      sun disc 0.058 px, Neptune orbit 378 px
VERIFIED: 2026-07-25
RECHECK:  __cosmos.projectToScreen([R,0,0]) vs ([0,0,0]) with R = 6.957e8 m in context
          units (0.004650 AU in system; 2.2546e-8 pc in galaxy).
```

## CLAIM 4 — The star field IS still "visible" in system context; visible ≠ luminous

```
CLAIM:    Nothing hides the field on entry. The monolith coverage gate that can hide the
          HYG field applies ONLY in galaxy/universe context; in 'system' the field is
          left visible by design. So the darkness is not a visibility flag.
EVIDENCE: apps/web/src/scene/StarScene.tsx:165-171 —
          `gated = (ctx === 'galaxy' || ctx === 'universe') && coverage >= GATE;
           hygPoints.object.visible = !gated;`
          plus CLAIM 1's unchanged `renderedPoints` across the flip.
VERIFIED: 2026-07-25
RECHECK:  sed -n '158,175p' apps/web/src/scene/StarScene.tsx
```

## CLAIM 5 — The mechanism: the star shader's distance modulus is unit-naive

```
CLAIM:    stars.vert.glsl computes `dPc = length(viewPos)` and applies the PARSEC distance
          modulus `m = aAbsMag + 5*(log10(dPc) - 1)`. `viewPos` is in CURRENT CONTEXT
          units. In 'galaxy' that is parsecs and the law is right; in 'system' it is AU,
          so d is overstated by AU→pc = 206,265×, i.e. m is inflated by
          5*log10(206265) ≈ +26.6 magnitudes. sNat = uBasePointPx * 10^(-0.2m) then
          collapses, the uMinPointPx floor engages, and the flux-conserving dim
          vSizeDim = min(1, (sNat/sRen)^2) drives the fragment to ~0 — points still
          drawn, all essentially black. This predicts CLAIM 1 and CLAIM 2 exactly.
EVIDENCE: packages/render-stars/src/shaders/stars.vert.glsl.ts:47-60;
          packages/render-stars/src/star-points.ts:34 (minPointPx 3, maxPointPx 64,
          basePointPx 8 — StarScene passes NO overrides: StarScene.tsx:108,118
          `createStarPoints({ batch })`).
VERIFIED: 2026-07-25 — shader source + arithmetic. **This is the one inferential step in
          this document**: the +26.6 mag consequence is derived from the shader as written,
          NOT read back from a live uniform.
RECHECK:  sed -n '46,60p' packages/render-stars/src/shaders/stars.vert.glsl.ts
          To CONFIRM rather than infer: in system context, read back the rendered point
          size / vSizeDim for a known star (or feed aAbsMag - 26.6 and check the field
          lights up). Until then CLAIM 5 is the best-supported mechanism, not a measurement.
```

## CLAIM 6 — CLAIM 5 is INCOMPLETE: the position attribute's unit is also wrong, and that is the larger error

> **Added 2026-07-25 after a failed confirmation test.** The prediction derived from
> CLAIM 5 alone was falsified (see below), which sent me back to the source. CLAIM 5's
> magnitude error is real but it is the *smaller* of two unit mismatches.

```
CLAIM:    The star field's POSITION attribute is in PARSECS while its per-frame render
          offset is in ACTIVE-CONTEXT units. The shader adds them (`position + offHi +
          offLo`). In galaxy context both are parsecs and the sum is correct; in system
          context the offset becomes AU while the attribute stays parsecs, so the two
          terms differ by 206,265x. The field is therefore not merely dim in system
          context — it is geometrically WRONG: every star is displaced, lands at an
          absurd distance, and goes sub-pixel and unlit. This explains CLAIM 2's
          "2 bright pixels out of 287,508 while 1,004,231 points render" better than the
          magnitude error alone.
EVIDENCE: packages/render-stars/src/star-points.ts:38 —
            geometry.setAttribute('position', new THREE.BufferAttribute(batch.positionsPc, 3))
          apps/web/src/scene/StarScene.tsx:172 —
            hygPoints.setRenderOffset(origin.toRenderSpace(HYG_ORIGIN, renderOffsetScratch))
          packages/render-stars/src/shaders/stars.vert.glsl.ts:47 —
            vec3 rel = (position + uRenderOffsetHi) * uGuardOne + uRenderOffsetLo;
          `toRenderSpace` returns CURRENT-CONTEXT units by contract
          (packages/coords/src/origin.ts header).
VERIFIED: 2026-07-25 (source, three files)
RECHECK:  grep -n "positionsPc" packages/render-stars/src/star-points.ts
          grep -n "setRenderOffset" apps/web/src/scene/StarScene.tsx
```

### The failed confirmation test (recorded because the negative result is the finding)

```
CLAIM:    The prediction "Sol's sprite reappears below ~2.9 AU, at full brightness"
          — derived from CLAIM 5's magnitude error alone — is FALSE as measured.
EVIDENCE: MEASURED. Free-flight (real keydown KeyW) from 75.15 AU to 1.293 AU in system
          context, 505 frames, sampling a 160 px readPixels strip through Sol's projected
          center. Distance derived per-frame from the projection (focal = 168 px, from
          offsetPx(1 AU) x d at a known state) rather than the <=4 Hz mirror.
            d=69.98 AU luma=172 | 29.99 luma=152 | 11.98 luma=105 | 5.065 luma=105
            3.999 luma=167 | 2.901 luma=122 | 2.013 luma=105 | 1.337 luma=140
          Peak luma NEVER exceeded 172 anywhere in the approach. At 2.013 AU the
          magnitude-only hypothesis puts the sprite above the min-size floor with
          vSizeDim = 1 (m ~ 1.34, sNat ~ 4.3 px), i.e. a saturated ~4 px core that would
          have read 255. It is absent.
          INSTRUMENT CAVEAT, stated plainly: the reported `blob` widths (63-135 px in a
          160 px strip) are ORBIT RINGS crossing the sample line, not a stellar core, so
          the width channel of this instrument is unusable at these distances. The peak-
          luma channel is still informative (nothing outshone the rings).
VERIFIED: 2026-07-25
RECHECK:  Re-fly and sample a 7x7 box at the projected center against a background
          annulus ~30 px out, instead of a single wide strip, so rings cannot mask a
          compact core. That measurement has NOT been run.
```

---

## What I looked for and did NOT find

- **No visibility flag, coverage gate, or LOD switch that turns the field off on system
  entry** — the only gate is galaxy/universe-scoped (CLAIM 4), and `renderedPoints` is
  identical across the flip.
- **No positional or angular discontinuity of any kind** — `nepPx` moves < 2 % across the
  flip; the dev continuity guard did not fire.
- **No per-context correction of the distance modulus anywhere in render-stars** — the
  shader has no context/unit uniform; `uPixelScale` (viewport) is the only scale input.
- **No same-viewport A/B of field brightness across contexts** (CLAIM 2's confound).
- **No compact-core measurement that is immune to the orbit rings** (CLAIM 6's failed
  test). Both of these are the measurements this document leaves open.
- **No bloom / glare / post-processing pass anywhere.** `packages/render-fx` exports only
  `createLineSet` (orbit rings) and `createNebula` — there is no bloom stage to hand a
  saturating star to. The halo seen in the star field is drawn by the point sprite's own
  fragment shader, so a "growing glare" can be done there without a post-pass.
  `RECHECK: grep -n "^export" packages/render-fx/src/*.ts`
- **No glow, sprite, or emissive treatment for the host star inside the system.** It is an
  ordinary unlit disc mesh: SystemScene.tsx:198-204 documents the host-star disc as a
  `kind:"planet"` body "for rendering only — it IS the star". So the boundary swaps a
  magnitude-driven sprite WITH a halo for a bare sub-pixel disc with none.
  `RECHECK: sed -n '196,206p' apps/web/src/scene/SystemScene.tsx`

## Consequences

1. **This is a real user-facing defect on the shipping path**, not a cosmetic nit: the star
   you deliberately flew to is the one thing that disappears on arrival.
2. **The sprite convention is the deeper issue.** CLAIM 3 shows the "big bright point" is a
   pure rendering convention for an object that is ~0.001 px across. Any fix must decide
   what the star looks like from 5,000 AU — geometry says "invisible", the convention says
   "8–32 px blob", and today the app switches abruptly from the second answer to the first.
3. **It predicts the same failure one rung up.** `docs/research/universe-point-field-viability.md`
   (2026-07-24) found that a universe-scale galaxy field can reuse `createStarPoints`
   *because* the parsec assumption is "a constant absorbable into aAbsMag". That is true —
   and this document is what happens when nobody absorbs it. Building the universe point
   field before fixing this would ship the same bug at a second boundary.
4. **Ordering recommendation:** fix (or explicitly decide) the unit/convention question here,
   at galaxy→system where the user can see it and where an e2e path already exists, before
   speccing the universe field. TASK-080 (the ascent) is unaffected and can proceed
   independently.

## Not the fix

- Widening the `uMinPointPx` floor or raising `maxPointPx` — that changes the convention's
  numbers without addressing that the magnitude law is fed the wrong unit.
- Hiding the field in system context — that makes the disappearance intentional instead of
  accidental, and removes the star background from the system view.
