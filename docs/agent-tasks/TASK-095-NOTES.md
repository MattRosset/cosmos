# TASK-095 NOTES — judgment calls

Logged as they arise (not reconstructed after).

## Step 0 re-verify (2026-08-05)

All nine Step 0 facts hold against live code (post-`3a473f8` / TASK-094 STOP tip):

1. **Selection vs coverage** — `selectOctree` (~491–532) fills `targetList` by SSE
   only; `buildCoverage` (~563–605) chooses ready reps. Untouched by this task's
   observe-only pass.
2. **Overlap** — `addCoverage` dedups equal keys via `coverageEpoch` but does not
   reject ancestor/descendant pairs. Mixed ready-child + ready-parent still yields
   both in `coverageList`.
3. **Budget collapse** — `enforceBudgets` (~615–687) replaces deeper covered nodes
   with a ready parent; preserves child when parent unavailable. Antichain follows
   after this.
4. **Opacity / visible** — step 6 (~763–774) targets opacity from
   `coverageEpoch === frame`; step 7 (~776–796) emits ready `opacity > 0`. Policy
   ownership is the correct insertion point.
5. **Morton primitives** — `decodeMortonKey` / `encodeMortonKey` / `parentCell` in
   `@cosmos/core-types`; local `parentKey()` at ~273–277 still used on loading/
   budget paths. New helper is pure + cache-driven; creation-time `parentId` added.
6. **catalogCoverage** — area-weighted, target-or-ready-ancestor (~124–138, ~604).
   Observe-only does not touch `_catalogCoverage`.
7. **Starting point** — TASK-094-NOTES two-run STOP: draws 64/88, points
   419k/586k, coverage 1.00..1.00. Independent peaks; not co-timed.
8. **Gate / probe** — baseline `_recorded: true`, 40 / 109971; Flythrough4Probe +
   flythrough4.spec.ts live with TASK-093/094 diagnostics.
9. **Nav / allocation** — `nearestBodyDistanceM` from `coverageEpoch === frame`
   (~791–794); steady-state reuses scratch. Antichain must not allocate per frame.

## §2 go/STOP evidence (2026-08-05, observe-only)

Two local chromium `flythrough4` runs after observe-only instrumentation.
Optimistic projection assumes instantaneous suppression (ignores frozen 300 ms
fade) and overestimates savings vs TASK-093/094. Kill thresholds: projected
draws ≤ 36, projected points ≤ 98,973.

### Run 1 `toSol`

| metric | value | note |
|---|---:|---|
| peakSceneDrawCalls | 98 | independent peak |
| peakScenePoints | 666,045 | independent peak |
| peakContainmentCandidates | 38 | independent peak |
| peakContainmentCandidatePoints | 201,255 | independent peak |
| peakFrustumKept / Culled | 144 / 147 | |
| peakBrightnessCulled | 113 | |
| peakInFlight | 6 | |
| coverage | 1.00..1.00 | |
| **peakProjectedDraws** | **78** | co-timed; at that frame scene=92 cand=14 |
| **peakProjectedPoints** | **571,673** | co-timed; at that frame scene=595,722 candPts=24,049 |

### Run 2 `toSol`

| metric | value | note |
|---|---:|---|
| peakSceneDrawCalls | 79 | independent peak |
| peakScenePoints | 572,172 | independent peak |
| peakContainmentCandidates | 48 | independent peak |
| peakContainmentCandidatePoints | 200,571 | independent peak |
| peakFrustumKept / Culled | 99 / 142 | |
| peakBrightnessCulled | 76 | |
| peakInFlight | 6 | |
| coverage | 1.00..1.00 | |
| **peakProjectedDraws** | **73** | co-timed; at that frame scene=77 cand=4 |
| **peakProjectedPoints** | **528,391** | co-timed; at that frame scene=544,775 candPts=16,384 |

### Decision

**STOP before enabling antichain (§3).** Both runs' optimistic projected peaks
exceed both headroom clauses (78/73 ≫ 36 draws; 572k/528k ≫ 98,973 points). No
straddle. Outcome A — killed premise.

Retained: `hasMarkedAncestor` helper, creation-time `parentId`, observe-only
containment counters on `StreamingStats`, additive Flythrough4 /
flythrough4.spec logging of candidate peaks.

Removed after measurement: temporary co-timed projected-value fields from the
probe surface (not part of the declared diagnostics).

Finding: `docs/research/lever3-lod-containment-cannot-close-tosol.md`.

§5.4 `toSol` remains known-red (pre-existing TASK-094 STOP); not a new
regression from this task.

## Judgment calls during implementation

1. **`peakProjected*` uses `>=` when updating the co-timed snapshot.** Spec says
   "for the maximum projected-draw frame, log that frame's scene draws and
   candidate count." On ties, last frame wins — acceptable for a kill test whose
   margins are tens of draws / hundreds of thousands of points. Logged as
   **executor judgment** (spec silent on ties); temporary fields removed after
   measurement so no lasting surface.
