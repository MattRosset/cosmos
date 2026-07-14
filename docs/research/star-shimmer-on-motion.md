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

*(to be filled after investigation — claims only, with RECHECK)*

## What I looked for and didn't find

*(mandatory section — to be filled)*

## Verdict

*(enable / kill / reframe — to be filled)*
