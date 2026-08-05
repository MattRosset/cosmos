# Lever 3 (LOD coverage antichain) cannot close the `toSol` near-Sol gate

**Date:** 2026-08-05  
**Task:** TASK-095  
**Status:** killed premise (Acceptance branch A)  
**Depends on measured STOP runs from:** TASK-093, TASK-094

## Claim

Research Lever 3 from `near-sol-overdraw-frustum-culling.md` — normalize overlapping
ready coarse ancestor + ready fine descendant coverage into an ownership antichain —
cannot restore the frozen `flythrough4` §5.4 `toSol` gate
(`peakSceneDrawCalls ≤ 40`, `peakScenePoints ≤ 109971`) on the actual approach
regime, even under an optimistic co-timed upper bound that assumes instantaneous
suppression and ignores the frozen 300 ms crossfade.

## Method

TASK-095 Deliverables §2 (observe-only):

1. Cache creation-time `parentId` on each octree chunk.
2. After `enforceBudgets`, scan `coverageList` for covered octree descendants whose
   strict Morton ancestor is also covered this frame (`containmentCandidates` /
   `containmentCandidatePoints` on `StreamingStats`).
3. Same-frame after `gl.render`, compute
   `projectedDraws = max(0, sceneDrawCalls − containmentCandidates)` and
   `projectedPoints = max(0, scenePoints − containmentCandidatePoints)`.
4. Peak the projected values independently; for each projected peak, log the
   co-timed scene quantity and candidate count from **that** frame. Never pair a
   projected peak with an independently accumulated candidate peak.
5. Decision: if either run's optimistic projected peak exceeds 36 draws or 98,973
   points (~10% headroom under the frozen thresholds), STOP before enabling the
   antichain.

This deliberately overestimates savings: TASK-093 frustum and TASK-094 brightness
may already hide some policy candidates from `gl.info.render`.

## Measured `toSol` (two local chromium runs, 2026-08-05)

| metric | run 1 | run 2 | kill threshold | frozen gate |
|---|---:|---:|---:|---:|
| actual `peakSceneDrawCalls` | 98 | 79 | — | ≤ 40 |
| actual `peakScenePoints` | 666,045 | 572,172 | — | ≤ 109,971 |
| `peakContainmentCandidates` (indep.) | 38 | 48 | — | — |
| `peakContainmentCandidatePoints` (indep.) | 201,255 | 200,571 | — | — |
| **co-timed** `peakProjectedDraws` | **78** | **73** | ≤ 36 | — |
| at max-proj-draws frame: scene / cand | 92 / 14 | 77 / 4 | — | — |
| **co-timed** `peakProjectedPoints` | **571,673** | **528,391** | ≤ 98,973 | — |
| at max-proj-points frame: scene / candPts | 595,722 / 24,049 | 544,775 / 16,384 | — | — |
| coverage | 1.00..1.00 | 1.00..1.00 | — | — |
| `peakInFlight` | 6 | 6 | — | — |
| `peakFrustumKept` / `Culled` | 144 / 147 | 99 / 142 | — | — |
| `peakBrightnessCulled` | 113 | 76 | — | — |

Both runs fail both headroom clauses. No straddle — do not cherry-pick.

## Why the parked-Sol 14.1% figure misled

The Lever 3 research quote (30/213 tiles = 14.1% containment) was a **parked-at-Sol
snapshot** with a settled visual field. The failing gate is a **transient approach**:
actual draws 79–98 and points 572k–666k, while co-timed candidate savings on the
worst projected frames are only ~4–14 draws and ~16k–24k points. Policy-side
candidate peaks (38–48 / ~200k pts) look large in isolation, but they do not
co-time with the scene peaks that set the gate — many candidates are already
frustum- or brightness-hidden when scene work spikes.

## Decision

**STOP before enabling antichain behavior.** Keep additive observe-only
`containmentCandidates` / `containmentCandidatePoints` diagnostics (and the pure
`hasMarkedAncestor` helper + creation-time `parentId` cache they require). Do not
ship `renderEpoch` ownership, do not raise `TILE_VISIBILITY_FLOOR`, do not alter
baseline/thresholds, selection, shaders, or re-enable monolith/procgen.

The known-red §5.4 `toSol` gate remains a pre-existing TASK-094 STOP condition,
not a new regression from TASK-095.

## Next work (not decided here)

A separate research task must measure the `toSol` transient cut and total-scene
composition: what non-octree / non-containment layers still dominate the approach
peak after frustum + brightness, and whether a selection-time or composition-level
lever (research direction 3, deferred) is even viable. Seed with the co-timed
diagnostics above — do not reopen Lever 3 as a gate closer without new evidence.
