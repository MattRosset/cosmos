# Research: star shimmer/twinkle during camera motion

**Date:** 2026-07-14
**Status:** questions + kill conditions written BEFORE investigation (this commit); findings follow in a later commit.

## Context (user report)

When the camera moves, stars' brightness is unstable — they flicker/twinkle, which makes
the whole universe look like it's "crawling" and the image less clean than a real space
timelapse video, where stars stay rock-steady. Question: is this expected with our
rendering approach, and what mechanism causes it?

## Falsifiable questions

**Q1 — Sub-pixel point aliasing.** Are stars rendered as small (≈1–3 px, or
distance-attenuated below 1 px) GPU point primitives whose per-frame coverage of the
pixel grid changes as the camera moves — i.e., is the flicker classic sub-pixel
aliasing of point sprites with no soft-edge/footprint treatment that would stabilize
brightness across pixel-boundary crossings?

**Q2 — Does our AA setup even apply?** Is the renderer created with `antialias: true`
(MSAA), and does the star material use a hard-edged fragment (discard/step) vs. a smooth
falloff? (MSAA does not supersample point interiors — a hard-edged or sub-pixel point
shimmers regardless of MSAA.)

**Q3 — Intentional twinkle.** Is there any time-based twinkle/scintillation effect in
any star shader (procgen cloud, Gaia/HYG catalog points, nebula overlays)? If yes, the
report may be a feature judged too strong, not a rendering artifact.

**Q4 — Population churn.** During camera motion, do stars appear/disappear or change
opacity discretely (octree LOD swaps, procgen fade, draw-cap re-selection), so the
"twinkle" is actually set-membership churn rather than per-star brightness instability?

## Kill / redirect conditions (written before opening any source file)

- **K1:** If star points are already rendered with a smooth radial falloff AND sized
  ≥ ~2 px minimum on screen, the sub-pixel-aliasing premise (Q1) dies — the cause must
  be sought in Q3/Q4 instead, and any "add soft sprites" work is killed.
- **K2:** If a deliberate twinkle term exists in a shader (Q3 yes), this is a tuning
  question, not a rendering-defect investigation — reframe to "should twinkle exist /
  at what amplitude", and no aliasing work should be specced.
- **K3:** If the flicker is fully explained by LOD/draw-cap churn (Q4 yes, and Q1/Q3
  no), then per-star AA work is killed; the fix direction is churn hysteresis, a
  different problem.
- **K4:** If measurement shows typical on-screen star size is comfortably above the
  pixel grid (≥3 px) with smooth falloff, "it's expected with what we have" is the
  verdict and the right output may be a docs note, not a task.

## Findings

```
CLAIM:    C1 — All catalog star mounts (galaxy octree, HYG, exoplanet hosts) render as
          GL_POINTS whose screen size clamps to a floor of 1 px × (viewportHeightPx/1080);
          most faint stars sit exactly at that floor because size ∝ 10^(-0.2·apparentMag)
          shrinks below it fast.
EVIDENCE: apps/web/src/scene/GalaxyScene.tsx:168, StarScene.tsx:108, StarScene.tsx:118
          (all call createStarPoints({ batch }) with no size options);
          packages/render-stars/src/star-points.ts:34 (minPointPx = 1 default);
          packages/render-stars/src/shaders/stars.vert.glsl.ts:34-38 (clamp × uPixelScale);
          star-points.ts:95 (uPixelScale = viewportHeightPx/1080).
VERIFIED: 2026-07-14
RECHECK:  grep createStarPoints apps/web/src — confirm no minPointPx passed;
          grep "minPointPx = 1" packages/render-stars/src/star-points.ts

CLAIM:    C2 — A star at the 1 px floor has its on-screen flux swing from 0 (invisible)
          to 1 (full) purely as a function of the sub-pixel position of its center
          (flux CV ≈ 111%); at 2 px the swing is ×1.37 (CV 6%), at 3 px ×1.14 (CV 3%),
          at ≥5 px it is imperceptible (CV ≤ 0.4%). Camera motion sweeps every star
          through these phases continuously → per-star brightness flicker = the
          reported twinkle. This follows from GL point rasterization (one fragment
          whose gl_PointCoord jumps per frame) + our fragment falloff
          smoothstep(0.5, 0.1, dist) sampled at that single point.
EVIDENCE: packages/render-stars/src/shaders/stars.frag.glsl.ts:13 (the falloff);
          simulation of GL point-rasterization + that exact falloff over a 64×64
          sub-pixel phase sweep — output:
            size=1px  flux min=0.000 max=1.000  CV=110.7%
            size=2px  flux min=1.000 max=1.367  CV=6.0%
            size=3px  flux min=2.563 max=2.931  CV=3.0%
            size=5px  flux min=7.638 max=7.770  CV=0.4%
VERIFIED: 2026-07-14
RECHECK:  node tools/research/point-flux-variation.mjs

CLAIM:    C3 — Nothing in the render pipeline mitigates this: MSAA is deliberately off
          (and would not help — MSAA multisamples geometric edges, not point-interior
          shading), and no post-processing AA pass (FXAA/SMAA/TAA/EffectComposer)
          exists in app or package source; the post chain is planned in docs only.
EVIDENCE: packages/scene-host/src/SceneHost.tsx:199 (antialias: false);
          grep -i "Composer|Fxaa|Smaa|MSAA|multisampl" apps/web/src → no files;
          grep -i "Composer|Fxaa|Smaa|RenderPass" packages → no files.
VERIFIED: 2026-07-14
RECHECK:  the two greps above; SceneHost.tsx gl={{ ... antialias: false }}

CLAIM:    C4 — There is no intentional twinkle/scintillation term in any shader; the
          flicker is not a feature (Q3 = no, K2 does not fire).
EVIDENCE: grep "twinkle|scintill|uTime" packages → no matches (shaders have no time
          uniform at all).
VERIFIED: 2026-07-14
RECHECK:  grep -riE "twinkle|scintill|uTime" packages

CLAIM:    C5 — The procgen galaxy cloud uses minPointPx: 2 (mild shimmer regime,
          flux swing ×1.37); only catalog stars use the severe 1 px floor. So the
          worst per-star twinkle comes from the real-catalog points, at every scale
          (galaxy octree stars and system-context HYG/exo points alike).
EVIDENCE: apps/web/src/scene/GalaxyScene.tsx:210 (minPointPx: 2 for the cloud) vs.
          GalaxyScene.tsx:168 / StarScene.tsx:108,118 (defaults → 1 px).
VERIFIED: 2026-07-14
RECHECK:  grep minPointPx apps/web/src packages/render-*/src

## Beliefs (no mechanical RECHECK — not Step-0 material)

- B1 — The user's observed flicker is fully accounted for by C2's mechanism. A live
  A/B confirmation (screenshot diff across a sub-pixel camera pan) was attempted and
  blocked: the preview tab's rAF was suspended (hidden-tab throttling; the pane later
  hung on capture), so the app would not advance frames under measurement. The C2
  simulation is exact for our shader + GL rasterization rules, but the end-to-end
  visual confirmation on a live pan remains unrun.
- B2 — Why a real space timelapse looks steady: telescope optics spread every star
  over a multi-pixel PSF and the sensor integrates over the exposure — physically the
  same regime as "point ≥3–5 px + temporal accumulation", i.e. the regime C2 shows is
  stable. (Physics rationale, not a repo fact.)

## What I looked for and didn't find

- **No post-processing chain of any kind** — grepped `Composer|Fxaa|Smaa|MSAA|multisampl`
  (case-insensitive) in `apps/web/src` and `Composer|Fxaa|Smaa|RenderPass` in `packages`;
  only docs mention it (architecture.md:176-180 plans FXAA/SMAA "in the post chain",
  TASK-039). The mitigation the architecture assumed exists is not built.
- **No time-based twinkle term** — grepped `twinkle|scintill|uTime` across `packages`;
  star/galaxy shaders take no time uniform at all.
- **No flux-conserving size clamp** — the vertex shader clamps size UP to the floor
  (stars.vert.glsl.ts:34-38) without compensating brightness down by the clamped area,
  so sub-floor stars are both over-bright for their magnitude AND parked in the most
  aliasing-prone size. (Checked stars.frag: brightness uses vApparentMag only.)
- **No draw-set churn during pure camera rotation** — draw-fraction/LOD changes exist
  (GalaxyScene.tsx applyFrame) but are driven by distance/LOD, not per-frame rotation,
  so Q4 is not the primary mechanism for "flicker whenever the screen moves". (Churn
  could still add pops during large translations — out of scope here.)

## Verdict

**Reframe (and enable).** The premise "maybe it's expected with what we have" is
half-true in the least useful way: the twinkle is a real, quantified rendering artifact
— sub-pixel point-sprite aliasing (C1 + C2) with zero mitigation in the pipeline (C3)
— not an intentional effect (C4) and not streaming churn. It is "expected" only in the
sense that the current numbers guarantee it: most catalog stars render at a 1 px floor
where flux legitimately swings 0→100% with sub-pixel camera motion.

For a spec writer, Step-0 facts are C1, C2, C3, C5. The measurement points at a cheap,
targeted fix direction (C2's table is the design tool): **raise the star footprint floor
to ~2–3 px and conserve flux by dimming clamped stars by (renderedSize/naturalSize)²**
— that alone moves the worst offenders from CV 111% to CV 3–6% without any post chain —
with an optional later FXAA/TAA pass (architecture.md already mandates FXAA/SMAA-in-post
over MSAA) for the residual. Any spec should gate on a deterministic proxy (e.g. the
tools/research/point-flux-variation.mjs table for the chosen floor, or a shader-source
assertion), not on screenshots (CLAUDE.md testing rules).

