# TASK-094 NOTES — judgment calls

Logged as they arise (not reconstructed after).

## Step 0 re-verify (2026-08-05)

All nine Step 0 facts hold against live code:

1. **Cull site** — `GalaxyScene.tsx` PRIORITY_RENDER: tanY/tanX (~592–593),
   orientation (~594), counters (~595–597), octree branch (~628–648) with
   frustum-KEPT `else { cullKept += 1; }`, then `m.seen = tick` (~649).
   `SQRT3` / `frustumCullStats` present. Brightness cull inserts inside the
   frustum-KEPT else, before `m.seen`.
2. **Shader math** — vert ~50–61 / frag ~15 match the spec formula.
   `createStarPoints` defaults 8/3/64; `makeOctreeMount` passes no overrides;
   effective exposure = `exposure.current * GALAXY_FIELD_EXPOSURE_BOOST` (6).
3. **Monotonicity** — bri(m) non-increasing for m ≤ 0 (flat at E) and strictly
   decreasing after; upper bound at minAbsMag + nearest approach holds.
4. **`absMag` on batch** — `StarBatch.absMag` present; Mount holds `batch`;
   no pack/core-types change.
5. **`halfExtentPc` on VisibleChunk** — present; streaming package untouched.
6. **Gate / probe** — baseline 40 / 109971, `_recorded: true`; probe reads
   `gl.info` after PRIORITY_RENDER; TASK-093 frustum diagnostics in the three
   places named by the spec.
7. **Starting point** — TASK-093-NOTES: toSol 121 / 494,037 / kept 90 / culled 142.
8. **MONOLITH_COVERAGE_GATE = 0.9** — frozen; floor stays 0.004.
9. **Unit-test scope** — `src/glue/**/*.test.{ts,tsx}` in node env.

## Judgment calls during implementation

1. **`cullKept` increments for ALL frustum-kept tiles, including those later
   brightness-culled.** Spec Deliverables §3 shows `cullKept` only in the final
   (dual-survivor) else, but §4's triage formula
   `peakFrustumKept − peakBrightnessCulled` and TASK-093 before/after
   comparability both require `kept` to mean frustum-kept (unchanged meaning).
   Structure used: frustum-KEPT else → `cullKept++` → optional brightness hide/
   continue. Drawn-tile peak = kept − brightnessCulled. Logged as a **spec bug**
   (internal inconsistency between §3 and §4); executor chose the §4/continuity
   reading.

2. **`scanMinAbsMag` empty/all-NaN → `Number.NEGATIVE_INFINITY`.** Spec says
   empty ⇒ −∞; NaN skipped by `<`. Implemented as scan from `+∞`, then map
   unchanged `+∞` to −∞ (covers empty and all-NaN in one path).

## STOP case (Acceptance / Deliverables §6) — MEASURED 2026-08-05

Implemented Deliverables §1–§5. Unit tests green (8/8). `pnpm verify` green.

`flythrough4` (chromium, post-cull build) **does not meet the near-Sol gate.**
Per Frozen Interface + Failure modes: do **not** raise floor 0.004, do **not**
weaken 40 / 109,971, do **not** edit the baseline, do **not** add per-star or
margin hacks.

### Measured `toSol` peaks (two local runs — run variance noted)

| metric | TASK-093 (before) | run 1 | run 2 | gate |
|---|---|---|---|---|
| `peakSceneDrawCalls` | 121 | **64** | **88** | ≤ 40 |
| `peakScenePoints` | 494,037 | **419,298** | **585,808** | ≤ 109,971 |
| `peakFrustumKept` | 90 | 88 | 135 | — |
| `peakFrustumCulled` | 142 | 142 | 150 | — |
| `peakBrightnessCulled` | — | **80** | **104** | — |
| derived drawn tiles (`kept − briCulled`) | — | **8** | **31** | — |
| coverage | — | 1.00..1.00 | 1.00..1.00 | — |
| procgen | — | 0.00..1.00 | 0.00..1.00 | — |

Cull **is firing** (brightnessCulled 80–104 at peak). It is **not enough** for
the transient `toSol` peak: draws stay in the 64–88 band and points stay
~419k–586k. Peaks are independent frame-maxima (drawn-tile derivation is not
co-timed with the scene-points peak), and run-to-run variance is large (async
fetch/decode timing) — neither run is within ~10% of either threshold.

This matches the Failure-modes Lever-3 STOP sub-case (draws 41–80+ with points
still over): brightness cull removes invisible tiles but **LOD duplicates**
(bright leaf + ready coarse ancestors that also contain a bright star) still
both survive, and the approach-leg transient still spikes the scene totals.

### Also

- `toGalaxy`: `frustumKept=58`, `brightnessCulled=58` (entire frustum-kept set
  brightness-culled at the far approach — expected; far tiles under floor).
- `toEarth`: cull stats 0 (system context; GalaxyScene streaming draw idle).

### Diff status

Code for draw-time brightness/distance cull is implemented and unit-tested;
gate restoration is **blocked on Lever 3 (LOD-containment / cut-settling)** —
a separate task whose Step 0 these numbers seed. Not a bug in the predicate
(unit cases pass; live brightnessCulled counts are non-zero and large).
