# Research: breadcrumb freeze (◂ Milky Way / ◂ Galaxy)

**Status:** **resolved** — root cause identified via main-thread profiler; fix in
`NavDriver.tsx` (skip `nearestStarIndex` during `goToActive`).
**Related:** TASK-040, TASK-041, `docs/research/TASK-040-galaxy-cloud-visibility.md`

---

## 1. Symptom

Clicking **◂ Milky Way** or **◂ Galaxy** starts a 5 s animated flight. The camera
*does* move (HUD speed readout advances), but the app **freezes** for multi-second
stretches — especially on exit start and mid-entry descent. Visually the journey can
look complete once frames resume, but motion is stuttery / teleports in chunks.

This was initially misdiagnosed as:

| Theory | Test | Result |
|--------|------|--------|
| Black screen = no stars rendered | Lower procgen opacity / raise floor | Visual gap improved, freeze remained |
| GPU overload from 1M procgen points | `MILKY_WAY_STAR_COUNT = 100_000` | **Same freeze @ 100k** → not point count |
| Procgen draw during flight | Cap draw to 20% during `goToActive` | Helped GPU marginally; freeze remained |

---

## 2. Root cause (confirmed)

**`stars.nearestStarIndex()` in `NavDriver` — up to ~1.7 s per frame on the main thread.**

Each frame at `PRIORITY_NAV - 1`, galaxy context calls `@cosmos/data` expanding-shell
grid search (`packages/data/src/grid.ts`) to feed the free-flight speed law
(`distanceToNearestSurface`). During breadcrumb flights the camera crosses **3–20 kpc**
from the galactic centre: inside the HYG catalogue bounding sphere but in a **void**
with no populated grid cells. The search walks up to **200 rings** of empty cells before
giving up.

The existing far-field short-circuit only fires when `distToField > HYG_GRID_REACH_PC`
(5000 pc **outside** the field boundary). Breadcrumb trajectories sit **inside** that
threshold — so the expensive path runs every frame.

### Profiler evidence (`?debug=breadcrumb-profile`)

Instrumentation: `apps/web/src/glue/frame-profiler.ts` + Playwright
`e2e/tests/breadcrumb-profile.spec.ts`. Pre-fix output:
`e2e/e2e/transition-capture/main-thread-profile-100k.json`.

| Span | max (ms) | Notes |
|------|----------|-------|
| **`nav.hyg.nearestStarIndex`** | **1744** | 100% of long frames |
| streaming.update | 1.1 | irrelevant |
| galaxy.render | 0.2 | irrelevant |
| stars.render | 0.1 | irrelevant |
| nav.update (goTo tick) | 0.3 | irrelevant |

Example long frame:

```json
{
  "totalMs": 1743,
  "goToActive": true,
  "distPc": 6159,
  "spans": { "nav.hyg.nearestStarIndex": 1743 }
}
```

rAF frame probe (`breadcrumb-perf.spec.ts`) showed the same: **1761 ms** spikes during
entry, **~28 frames in 5 s** on exit (main thread blocked, not slow GPU).

---

## 3. Fix

**File:** `apps/web/src/scene/NavDriver.tsx`

Skip the grid search during animated flights — reuse the bounding-sphere distance
(same estimate as the far-field short-circuit):

```typescript
if (flight.goToActive || distToField > HYG_GRID_REACH_PC) {
  flight.setDistanceToNearestSurface(Math.max(distToField, MIN_SURFACE_DISTANCE_PC));
  return;
}
// … nearestStarIndex only for manual WASD flight near the HYG field
```

`goToActive` flights are driven by `@cosmos/nav` motion law, not free-flight speed, so
the approximate distance is sufficient for the duration of the animation.

Manual exploration near Sol is **unchanged** — grid search still runs when not in `goTo`.

---

## 4. Reproduce / verify

### Enable profiler (dev)

```
http://localhost:5173/?debug=breadcrumb-profile
```

After flying both breadcrumbs, in console:

```js
window.__breadcrumbProfileBuild()
```

### Automated

```bash
cd e2e
pnpm exec playwright test breadcrumb-profile --config playwright.dev.config.ts
pnpm exec playwright test breadcrumb-perf --config playwright.dev.config.ts
```

**Pass criteria after fix:** no `nav.hyg.nearestStarIndex` entries during `goToActive`;
`longFrames` with max ≪ 50 ms; rAF p95 ≤ 40 ms on CI.

### Video / screenshots (pre-fix capture)

- `e2e/e2e/transition-capture/breadcrumb-transition-100k.webm`
- `e2e/e2e/transition-capture/main-thread-profile-100k.json` (pre-fix baseline)

---

## 5. Separate issue: visual content gap (not perf)

Black / empty bands during breadcrumbs when procgen `layerFade` hits 0 below 18 kpc
are a **rendering hand-off** issue (HYG sparse at kpc scale), documented in the
TASK-040 session notes. Addressed separately via `GAL_PROCGEN_FLOOR` (50% procgen near
Sol) + flight draw cap — see `GalaxyScene.tsx`. That tuning does **not** fix the
main-thread freeze; this doc covers only the HYG grid stall.

---

## 6. Files touched by fix + diagnostics

| File | Role |
|------|------|
| `apps/web/src/scene/NavDriver.tsx` | **Fix** — `goToActive` short-circuit |
| `apps/web/src/glue/frame-profiler.ts` | Debug span profiler |
| `apps/web/src/scene/BreadcrumbFrameProfiler.tsx` | Frame bookends for profiler |
| `e2e/tests/breadcrumb-profile.spec.ts` | CI/dev span report |
| `e2e/tests/breadcrumb-perf.spec.ts` | rAF timing during breadcrumbs |
