# Research: speed surge with Shift+W inside the galaxy

**Date:** 2026-07-13
**Reported symptom:** when moving forward with Shift+W inside the galaxy, the speed
accelerates and then **drops on its own**, producing a weird oscillating
acceleration/braking effect. User hypothesis: speed or streaming.

## Step 1 — Falsifiable questions

- **Q1:** Is the forward speed adaptively scaled by some quantity that changes as
  you move (distance to the nearest object, scale, local density)? That is, is the
  "braking" an *intentional* reduction of the speed scale and not a bug?
- **Q2:** Is the Shift boost an acceleration ramp with decay/clamp (accel +
  damping) rather than a constant multiplier, such that the speed can overshoot and
  fall back by integration design?
- **Q3:** Does streaming (octree / procgen loading) produce frame-time spikes that,
  combined with `dt`-dependent integration, alter the perceived effective speed
  (surges when recovering from long frames)?

## Step 2 — Kill / redirect conditions (written BEFORE investigating)

- **K1 (kills "it's a speed bug"):** if Q1 = yes — speed is scaled by
  distance/scale and the user crosses regions that change that quantity — then the
  effect is *badly calibrated designed behavior*, not an integration bug. The work
  is reframed as tuning/smoothing the speed scale, not a streaming fix.
- **K2 (kills "it's streaming"):** if the speed computation does not use raw `dt`
  in any hitch-sensitive branch, or if I can reproduce the surge with streaming
  already complete (everything loaded, no requests), streaming is ruled out as the
  cause.
- **K3 (kills "it's the Shift ramp"):** if Shift is a constant multiplier applied
  to an already stable speed, the ramp cannot explain sustained oscillation.

## Step 3–4 — Claims

```
CLAIM:    In galaxy context, the free-flight target speed is recomputed EVERY
          frame as clamp(1.0 × distance-to-nearest-HYG-star, 1e-7, 10 pc/s), and
          Shift multiplies it ×10 (constant, no ramp). No other input enters the
          law.
EVIDENCE: packages/nav/src/controller.ts:1085-1088 (targetSpeed = clamp(speedScale
          × distanceToNearestSurface, ...); speedBoost → ×10);
          apps/web/src/scene/NavDriver.tsx:51 (cap 10), :98, :200-210 (the galaxy
          feed is HYG's nearestStarIndex).
VERIFIED: 2026-07-13
RECHECK:  read controller.ts:1085-1088 and NavDriver.tsx:186-212
```

```
CLAIM:    The real speed chases that target with an exponential smoothing of
          90 ms half-life — fast enough that each jump of the target feels like an
          acceleration or a braking within <0.3 s.
EVIDENCE: packages/nav/src/controller.ts:162 (DEFAULT_DAMPING_HALF_LIFE_MS=90),
          :1135-1139 (exponential decay toward targetVel).
VERIFIED: 2026-07-13
RECHECK:  read controller.ts:162 and :1135-1139
```

```
CLAIM:    Measured at runtime: with Shift+forward held INSIDE the star field, the
          speed oscillated 9.3 ↔ 90.8 pc/s over ~10 s (e.g.
          12.8→18.6→10.2→27.0→9.3→46.4→33.0→90.8→33.0 pc/s); on leaving the HYG
          field (z ≳ 300 pc from Sol) it PINNED at 100 pc/s (cap 10 × boost 10)
          without a single further oscillation. The oscillation exists only where
          nearby stars keep changing the distance-to-nearest.
EVIDENCE: sampling 2026-07-13 via eval in the dev app (synthetic keydown
          ShiftLeft+KeyS on the canvas, reading .hud-speed-value every 250 ms +
          __cosmos.cameraPosition), 79 samples.
VERIFIED: 2026-07-13
RECHECK:  pnpm --filter @cosmos/web dev; in console: hold Shift+W/S inside the
          field (|pos| < 300 pc) and sample
          document.querySelector('.hud-speed-value').textContent every 250 ms;
          repeat with |pos| > 400 pc — inside it oscillates, outside it stays fixed
          at 100.
```

```
CLAIM:    Streaming does NOT feed the speed law in galaxy context: the streaming
          scalar (nearestBodyDistanceM) is consumed only in the 'universe' branch,
          with an explicit comment that it must not drive the galaxy law.
EVIDENCE: apps/web/src/scene/NavDriver.tsx:173-184 ("it must NOT drive the galaxy
          speed law — §5.8 nearest is for universe").
VERIFIED: 2026-07-13
RECHECK:  read NavDriver.tsx:173-184
```

```
CLAIM:    There are no frame hitches distorting the integration: at cap speed the
          measured displacement was constant (~24.85 pc per 250 ms sample ≈
          99.4 pc/s) for 9 s straight.
EVIDENCE: same 79 samples (z column), stretch t=11.0s→19.9s.
VERIFIED: 2026-07-13
RECHECK:  same sampling as the previous claim, watching position deltas
```

## Step 5 — What I looked for and did NOT find

- **No acceleration ramp in Shift:** grep `speedBoost` in `packages/nav/src` — it
  is a boolean that multiplies the frame target ×10 (controller.ts:1086-1088);
  there is no accumulative state. → K3 applied: the ramp does not exist, it cannot
  be the cause.
- **No streaming/procgen input in the galaxy branch of the surface feed:** read all
  of NavDriver.tsx — the galaxy branch uses only HYG (`nearestStarIndex`) or
  distance-to-field; `streaming` appears only in the universe branch. → K2 applied:
  streaming ruled out.
- **No smoothing over `distanceToNearestSurface`:** grep
  `setDistanceToNearestSurface` — it is written raw every frame from the feed; the
  system's only filter is the 90 ms half-life over the speed.

## Step 6 — Verdict: REFRAME

**It is neither a speed bug nor a streaming bug — it is the designed speed law,
unfiltered, over a noisy signal.** The premise "something is wrong with the speed or
the streaming" dies with claims 1, 3 and 4: the speed is *proportional to the
distance to the nearest star* by design (you fly fast far from everything, you slow
down near something). Crossing the star field with Shift (up to 100 pc/s) you pass
near a star every fraction of a second, the distance-to-nearest rises and falls
constantly, and the speed chases it with a 90 ms half-life → the perceived
acceleration/braking effect. Outside the field the signal is smooth and the effect
disappears entirely (measured).

**The real question** is not "fix the speed" but "should the law sample the raw
nearest star, or a smoothed version?". Tuning directions (for a future spec, not
decided here): smooth/rate-limit the change of `distanceToNearestSurface` in the
galaxy branch; asymmetry (fast braking on approach, slow release on departure — the
"braking" half of the effect is the annoying one); or a less pointwise effective
distance than the exact nearest neighbor (e.g. soft-min over k neighbors).
