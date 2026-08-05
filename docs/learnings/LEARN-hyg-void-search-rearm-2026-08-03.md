# LEARN — lifecycle guards re-arm; gap vs longtask before blaming GPU

**Date:** 2026-08-03  
**Source:** `docs/research/gaia-far-fly-quality-collapse.md` (rewritten; interactive
mechanism = HYG void search) + `docs/research/TASK-040-breadcrumb-freeze.md`  
**Fix verified:** Gaia park ~2835 pc stays ~164 fps / `longTasks=none` after
`NavDriver` skip past `HYG_SEARCH_MAX_FROM_SOL_PC`.

---

## Pattern 1 — A guard scoped to “in transit” does not protect “parked at the same place”

**Pattern:** If an expensive path is skipped only while a transient flag is true
(animation / loading / flight), the cost returns the instant that flag clears —
including when the camera *stops* in the region that made the path expensive.

**Seen in:** cosmos, TASK-040 breadcrumb freeze (`goToActive` skip) → TASK-070 Gaia
search park (same `nearestStarIndex` void walk, `goToActive` already false).

**When it applies:** Short-circuits tied to lifecycle (`isAnimating`, `goToActive`)
rather than to the geometric/data condition that makes the work safe.

**When it doesn’t:** Guards that encode the real precondition (bounds, density, “this
index has coverage here”).

**Cost of ignoring it:** Bug “fixed” for the flight, resurfaces when a feature *parks*
in the same void. Easy to misdiagnose as GPU / idle rAF / quality tier.

---

## Pattern 2 — New reachability re-arms old cliffs

**Pattern:** A feature that first makes a vantage reachable and parkable is a
regression probe for every “we never stay here” assumption.

**Seen in:** cosmos TASK-070 (Gaia DR3 search → ~2.8 kpc). Pre-070 search parked
near-Sol only.

**Cost of ignoring it:** “This task didn’t touch NavDriver” is true and irrelevant.

---

## Pattern 3 — Split frame interval before blaming render or “browser throttle”

**Pattern:** When FPS collapses but GPU time and known scene-phase stay small, measure
**gap (between rAF)** vs **callback work** vs **Long Task durations**. ~90 ms longtasks
with ~0 ms probe callback ⇒ another main-thread loop. A CPU-spin that finishes quickly
inside the probe does **not** prove the frame is idle — work can sit in the gap.

**Seen in:** cosmos 2026-08-03 — interactive Gaia park (`gap~93ms`, `longTasks~92ms`,
GPU/phase cheap).

**When it applies:** “Scene looks cheap / one point on screen but FPS dies.”

**Cost of ignoring it:** Premature GPU conclusions; wrong fix layer.

---

## Pattern 4 — Adaptive quality that reads rAF FPS will compound a false stall

**Pattern:** FPS-driven quality step-down treats a main-thread stall as “scene too
expensive” and can empty the view (budget collapse) on top of the stall.

**Seen in:** cosmos — HYG void ~11 fps → `PerformanceMonitor` → procgen-in-cap →
black (policy fix separate; ratchet follow-up open).

---

## Doctrine proposals (not applied — ratify)

| # | Proposal | Evidence |
|---|---|---|
| D1 | **Standing (2× in-repo):** lifecycle-scoped perf guards must also state the post-lifecycle condition, or encode the data/geometry precondition. | TASK-040 + TASK-070 park |
| D2 | Queue: gap/callback/longtask split as first probe when FPS≠GPU. | One explicit method here |
| D3 | Queue: auto-quality must not step down without scene-cost evidence. | One chain; follow-up open |

---

## Recap

HYG = local catalog + spatial grid for near-Sol nearest-star (speed law). Gaia park sits
outside that index. Expanding-shell nearest in empty sky ~90 ms/frame. Old fix skipped
it only during `goTo`; parking re-armed it. Prefer streaming nearest (or fail-fast grid)
over a magic Sol-radius long-term.
