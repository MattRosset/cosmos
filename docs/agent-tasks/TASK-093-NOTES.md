# TASK-093 NOTES — judgment calls

Logged as they arise (not reconstructed after).

## Step 0 re-verify (2026-08-05)

All six Step 0 facts hold, with one structural note:

1. **seen vs offScratch order differs from the spec's implied layout.** Live
   `GalaxyScene.tsx` sets `m.seen = tick` at line ~589 *before* computing
   `offScratch` (~591–600). Spec Step 0 / Deliverables §3 say the cull inserts
   *between* offScratch scaling and `m.seen = tick`, and Common Mistakes forbid
   setting `seen` before the cull. **Decision:** move `m.seen = tick` to after
   the octree frustum test (and after offScratch), so a culled tile never gets
   `seen === tick`. Procgen still sets `seen` then may `hide()` explicitly (existing
   contract comment preserved).

2. Baseline still `peakSceneDrawCalls: 40`, `peakScenePoints: 109971`, `_recorded: true`.

3. `originPc` = tile center; `halfExtentPc` absent from `VisibleChunk`; StarScene
   conjugate/`tanY`/`tanX`/`-Z` convention confirmed; priorities NAV−1 / COORDS /
   RENDER ordering confirmed.

## Judgment calls during implementation

1. **`m.seen` reorder (see Step 0 §1).** Required by Deliverables §3 / Common
   Mistakes — not optional. No other behaviour change for the non-culled path:
   offScratch → (cull?) → seen → applyFrame.

2. **`peakScenePoints > 0` assertion added to `flythrough4.spec.ts`.** Acceptance
   #2 requires it. Frozen Interface forbids editing the spec/baseline *to pass*
   (weaken thresholds); this *strengthens* the gate and does not touch 40 /
   109,971. Logged here because Frozen wording is easy to over-read as "never
   touch the file".

3. **Orientation null-guard via `ctrl?.state.orientation ?? null` once per frame**
   rather than re-reading `controllerRef.current` inside the tile loop. Spec says
   "if `controllerRef.current` is null, skip the cull" — equivalent: when `ctrl`
   (already read at the top of the frame) is null, `orientation` is null and the
   octree path draws as today. Avoids a second ref dereference per tile.

4. **Diagnostic `frustumCullStats` + probe fields.** Added so the STOP-case
   measurement is triagable from flythrough4 logs alone (kept/culled tile peaks
   per segment). Not a behaviour change.

## STOP case (Acceptance / Failure modes) — MEASURED 2026-08-05

Implemented Deliverables §1–§5. Unit tests green. `pnpm verify` green.

`flythrough4` (chromium, post-cull build) **does not meet the near-Sol gate.**
Per Frozen Interface + Failure modes: do **not** weaken 40 / 109,971, do **not**
edit the baseline, do **not** add margin that culls visible tiles.

### Measured `toSol` peaks (the §5.4 clause)

| metric | measured | gate |
|---|---|---|
| `peakSceneDrawCalls` | **121** | ≤ 40 |
| `peakScenePoints` | **494,037** | ≤ 109,971 |
| `peakFrustumKept` (tiles) | **90** | — |
| `peakFrustumCulled` (tiles) | **142** | — |
| `peakRenderedPoints` (policy, unculléd) | 1,638,166 | ≤ 2M (still green) |

Cull **is firing** (142 tiles culled at peak). It is **not enough** for the
transient `toSol` peak: peak in-frustum tile count is 90 (> 40), and in-frustum
points peak at ~494k. Research's parked-at-Sol cut (~46 in-frustum / ~32k pts)
is a different camera regime than the approach leg (camera looks toward Sol →
most Sol-local tiles stay ahead/in-frustum for much of the flight).

### Also

- `toGalaxy`: `frustumCulled=0`, `frustumKept=58` (approach geometry — Sol-local
  cluster ahead).
- `toEarth`: frustum stats 0 (system context; GalaxyScene streaming path idle for
  octree draw).
- Points clause also fails (not the draws-only STOP sub-case). Remaining levers
  called out by the research/spec: **brightness/distance cull (Lever 2)** and/or
  **LOD-containment / cut-settling (Lever 3)** — both explicitly out of scope for
  TASK-093.

### Diff status

Code for draw-time frustum cull is implemented and unit-tested; gate restoration
is **blocked on a follow-up lever**, not on a bug in the predicate (unit geometry
cases pass; live culled-tile counts are non-zero and large).
