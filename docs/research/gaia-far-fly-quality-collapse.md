# Root-cause — flying to a far Gaia star from search (TASK-070)

**Status:** mechanisms confirmed (2026-08-03 interactive + earlier harness).  
**Fixes:** `NavDriver.tsx` (FPS / HYG void search); `policy.ts` (black / procgen point-cap).  
**Open:** `PerformanceMonitor` false decline (follow-up).

---

## TL;DR

Parking at Gaia DR3 `3946392046023296` (~2 830 pc from Sol) surfaced **two product defects**
and two expected HUD behaviours:

| # | Symptom | Mechanism | Fix |
|---|---|---|---|
| **A** | ~11 fps / “trabado”, often 1 star visible | `NavDriver` calls HYG `nearestStarIndex` every frame; at mid-disk there are no HYG cells → expanding-shell walks empty rings (~90 ms main-thread longtask). Same as TASK-040 breadcrumb freeze, but **after** `goTo` ends so the old `goToActive` guard does not apply. | Skip HYG grid when `distFromSolPc > 500`; use `streaming.nearestBodyDistanceM`. Verified: ~164 fps, `longTasks=none` at park. |
| **B** | Star vanishes / black screen | Fake low fps (A) or arrival hitch → drei `PerformanceMonitor` steps tier down → `enforceBudgets` charged procgen’s nominal 1e6 into the point cap → octree collapsed to level-0 root. | Charge **octree-only** in `enforceBudgets`. Verified in harness; auto-tier ratchet still open. |
| C | Letterbox | TASK-067 D4, jumps ≥ 100 pc | Expected |
| D | “GALACTIC SURVEY” badge | Scale ladder at that distance | Expected |

TASK-070 did not invent A/B; it first made this vantage **reachable and parkable**.

Repro: dense `octree-gaia` behind `.env.local`; Ctrl-K → that id → park at
`[-2047, 192, -1952]` pc.

---

## Background — why HYG *and* Gaia / streaming?

Not “two ways to travel.” One flight controller; **two catalogs** for different jobs:

| | **HYG** | **Gaia (octree stream)** |
|---|---|---|
| What | Hipparcos/Tycho-era local catalog (~1e5 stars), named/nearby | Gaia DR3 bright subset (millions), tiled octree |
| Role in app | Near-Sol field, names, legacy monolith + speed-law nearest (historical) | Dense field away from Sol; streamed tiles |
| Speed law input (galaxy) | `stars.nearestStarIndex` on a 25 pc grid | `streaming.nearestBodyDistanceM` (chunk bounds) |

Travel is always `goTo` / free-flight. The bug was asking the **HYG index** for “nearest
surface” where only **Gaia tiles** exist.

Design debt (not fixed in this writeup): a hard `500 pc` Sol radius is a proxy for “HYG
has coverage.” Prefer eventually: always prefer streaming for galaxy speed law when the
policy is live, and/or fail-fast empty shells inside `grid.ts` so a void never costs ~90 ms.

---

## Step 1 — symptoms (harness + interactive)

### Harness (Playwright, headless d3d11 / headed)

| symptom | at rest (Sol) | far arrival | after tier drop |
|---|---|---|---|
| letterbox | off | on (first large jump) | off |
| scale badge | STAR FIELD | GALACTIC SURVEY | GALACTIC SURVEY |
| draw / pts | ~140 / ~1.26M | 300 / 1.77M | **→ 2 / ~1.0M** (pre-policy fix) |
| quality tier | high | high | high→med→low |
| screen | faint field | 1 bloomed star | **black** |
| fps reading | — | 60 | →10 |

### Interactive (high-end GPU, mouse moving, 2026-08-03)

| | before cliff | after cliff (locked high) |
|---|---|---|
| fps / frameP50 | ~150–160 / 6–7 ms | **~10 / 98 ms** |
| GPU / streaming phase | ~1–3 / ~3 ms | same |
| draw / pts / tier | 300 / 1.77M / high | **same** |
| longTasks | none | **~92 ms × ~11 / s** |

---

## Step 2 — separate the findings

1. **Letterbox / galactic-survey badge** — expected HUD (thresholds + distance label).
2. **Black screen** — tier + point-cap (Step 5). Independent of whether FPS is “real.”
3. **~11 fps interactive** — **not** GPU fill-rate and **not** (for interactive) idle rAF
   alone. Main-thread HYG void search (Step 4).

---

## Step 3 — black screen experiments (still valid)

| # | condition | draw | screen |
|---|---|---|---|
| A | far, auto tier | 300→**2** | star→**black** |
| B | far, locked high | 300 stable | star visible |
| C | Sol, forced medium | **2** | ok (procgen off) |
| D | far, forced medium | 300→**2** | star→black |

`draw=2` = `{ octree: root LOD0, procgen }` with pts ≈ 1e6 procgen + ~8k root.
Collapse tracks **tier downgrade**, not distance alone.

---

## Step 4 — ~11 fps interactive: HYG `nearestStarIndex` void search

### Mechanism

Each frame in galaxy context, `NavDriver` feeds the free-flight speed law
(`speed ∝ distanceToNearestSurface`) via HYG `nearestStarIndex` (expanding shell, up to
200 rings × 25 pc). Empty sky ⇒ walk empty rings ⇒ **~90 ms/frame** JS.

| Guard (pre-fix) | When it helps | Gaia park ~2835 pc |
|---|---|---|
| `goToActive` | During animated flight (TASK-040) | **false** once parked → search runs |
| `distToField > 5000 pc` past HYG sphere | Far outside field | Still inside that slack → search runs |

During the fly-in, `goToActive` hides the cost (smooth ~160 fps). On arrival it returns.

### Evidence (interactive)

Gap/callback probe at park:

```
fps~164  gap~6ms   phase~3  longTasks=none
fps~11   gap~93ms  phase~3  longTasks=[92×11]   # same draw/pts/GPU
```

After `HYG_SEARCH_MAX_FROM_SOL_PC` + streaming nearest: park stays **~164 fps**,
`longTasks=none`.

**Method note:** a CPU-spin that finishes in a few ms inside an rAF probe only proves
*that loop* is cheap — other main-thread work can sit in the gap and appear as Long
Tasks. Idle/occlusion harness throttling can also print ~10 fps *without* longtasks;
that is an e2e measurement hazard, not this bug’s mechanism.

---

## Step 5 — black screen chain (tier + procgen in point cap)

1. Park at ~2835 pc (and/or arrival hitch / false low fps from Step 4).
2. `PerformanceMonitor` `onDecline` → medium/low → point cap 2M → 1M / 500k.
3. `enforceBudgets` summed **procgen nominal 1e6** into the cap → ate the budget.
4. Deepest-first collapse shed all octree tiles to **level-0 root** → Gaia gone → black.
5. Throttled or stalled frames kept declining the tier (one-way ratchet).

BUG-10-shaped over-collapse re-armed by a **lowered tier cap**, not by the default 2M budget.

---

## Step 6 — fixes

### A — FPS (`NavDriver.tsx`)

Also short-circuit when `distFromSolPc > HYG_SEARCH_MAX_FROM_SOL_PC` (500). Then set
nearest surface from `streaming.nearestBodyDistanceM` (octree under camera). Near-Sol
WASD still uses the HYG grid.

**Follow-up (design):** prefer streaming whenever the policy is live (drop magic 500),
and/or fail-fast empty shells in `grid.ts`. **OPEN research:** see also
`docs/research/gaia-park-navigation-open.md` (WASD stuck at park may be streaming-nearest
≈ 0 feeding the speed law; Gaia dblclick-to-fly not wired).

### B — Black (`policy.ts` `enforceBudgets`)

```ts
for (let i = 0; i < coverageList.length; i++) {
  if (coverageList[i]!.kind === 'octree') pts += coverageList[i]!.pointCount;
}
```

| state | before | after |
|---|---|---|
| far + medium | draw 2, black | draw 300, star visible |
| far + low | draw 2 root | draw 214, spatially distributed LOD |

### Still open

`PerformanceMonitor` stepping down on non-scene stalls / arrival hitches and never
climbing back.

---

## Step 7 — what would have caught this earlier

- **Lifecycle-only perf guards** (`goToActive`) do not protect **parked** in the same
  region — encode geometric/data preconditions (or always use the catalog that has
  coverage). Seen twice: TASK-040 + this park.
- **New reachability** (Gaia search park) re-arms latent cliffs.
- **Gap vs callback vs Long Task** before blaming GPU (and don’t treat a cheap CPU-spin
  inside the probe as proof the frame is idle).
- **Tier monotonicity:** lower tier must not empty the real catalog (procgen must not
  consume the octree point budget).
- Idle-harness FPS still needs a throttle guard for e2e — separate from this bug.

---

## Related

- `docs/research/TASK-040-breadcrumb-freeze.md` — first HYG void-search incident  
- `docs/learnings/LEARN-hyg-void-search-rearm-2026-08-03.md` — portable patterns  
- ADR-006 — Gaia subset + tier unification context
