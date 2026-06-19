# Research / handoff: unify galaxy render tiers in Phase 4 (procgen vs catalog)

**Status:** open — design note for Phase 4 / M4 integration  
**Raised:** 2026-06-19 (M3 post-mortem discussion)  
**Blocks:** Gaia tiled pack + M4 `apps/web` integration task(s)  
**Related:** architecture §2 (real vs procedural), §5.8 (`streaming`), §5.9
(`render-stars` / `render-galaxy`), TASK-040 (`GalaxyScene` tier hand-off),
`docs/research/TASK-040-breadcrumb-freeze.md` (`GAL_PROCGEN_FLOOR` tuning)

---

## 1. Problem statement

M3 ships **three overlapping star layers** in `galaxy` context:

| Layer | Source | Typical size | Role today |
|---|---|---|---|
| `StarScene` (M2) | Monolithic HYG `stars.bin` | ~120k | M2 baselines; always mounted |
| `GalaxyScene` octree | Streaming HYG tiles | variable | Real catalog on demand |
| `GalaxyScene` procgen | Worker-generated Milky Way | up to 1M | Spiral fill + far-LOD impostor |

Near Sol this is **conceptually redundant**: real catalog data and procedural filler
draw at the same time. M3 accepted the overlap to preserve M2 visual regression
baselines and to avoid empty bands during breadcrumb flights (HYG is sparse at kpc
scale — see TASK-040 breadcrumb notes).

Phase 4 adds **Gaia DR3 tiled subset (2–5M stars)** via the existing octree +
streaming pipeline. That is the moment to **collapse to one authoritative layer per
scale**, per architecture §2: *real catalogs for credibility; procedural only beyond
catalog reach; indistinguishable to the renderer.*

---

## 2. M3 mitigations (do not remove until replacement exists)

Current glue in `apps/web/src/scene/GalaxyScene.tsx`:

- `streamingActive` only in `universe` / `galaxy` — **off entirely in `system`** ✅
- `GAL_PROCGEN_FLOOR = 0.5` — minimum 50% procgen draw near Sol (visual fill)
- `GAL_FLIGHT_DRAW_MAX = 0.2` — cap procgen during `goToActive` breadcrumb flights
- `setDrawFraction` — GPU `drawRange` cap, not just opacity fade
- Streaming budgets — `renderedPoints ≤ 2M` at tier `high` (TASK-040 e2e)

These are **milestone tradeoffs**, not the long-term model.

---

## 3. Target model (Phase 4+)

```
Scale / context          Authoritative source        Procgen role
─────────────────────────────────────────────────────────────────
universe (far)           impostor + coarse procgen   far-LOD billboard
galaxy (mid, arms)       octree tiles (HYG → Gaia)   cross-fade out as tiles cover SSE cut
galaxy (near Sol)        octree tiles only           OFF (opacity 0, mount hidden)
system / planet          system pack + local tile    OFF
```

**Rules for M4 integration:**

1. **Gate procgen cloud off** when octree coverage satisfies the visible cut (no
   pending/in-flight gaps). Start by lowering `GAL_PROCGEN_FLOOR` to `0` once Gaia
   tiles densify the Sol neighbourhood; keep impostor-only at universe scale.
2. **Retire or gate M2 monolithic `StarScene`** once octree tiles provide the same
   HYG coverage without overlap. Do not draw the same catalog twice (monolith + tile).
3. **Single `StarBatch` contract** — renderer stays unchanged; only the producer
   (streaming octree vs procgen vs legacy monolith) switches by policy.
4. **Acceptance:** no visual regression on M2/M3 flythrough scripts; **draw call and
   point-count budgets improve** near Sol vs M3 (fewer redundant points, not more).

---

## 4. Suggested implementation checklist (Phase 4 task author)

- [ ] Extend `streaming` or `GalaxyScene` with an explicit **procgen visibility
      policy** (distance / coverage / context), replacing hard-coded floors.
- [ ] Add **coverage-based procgen fade**: procgen opacity → 0 when
      `buildCoverage()` reports ready octree tiles for the full visible cut.
- [ ] Gaia pack via existing `tools/pack-octree` + `loadOctreePack` — no parallel
      loader path.
- [ ] Gate `StarScene` HYG monolith: mount only when octree root tile not yet ready,
      or remove once Gaia supersedes HYG for all M3 demo paths.
- [ ] E2E: assert `renderedPoints` **drops** inside galaxy context vs M3 baseline
      (same flight path, fewer redundant layers).
- [ ] Document impostor-only procgen path for `universe` context (keep; cheap).

---

## 5. Files likely touched

| File | Change |
|---|---|
| `apps/web/src/scene/GalaxyScene.tsx` | Replace `GAL_PROCGEN_FLOOR` hack with coverage policy |
| `apps/web/src/scene/StarScene.tsx` | Gate or remove monolithic HYG when octree covers |
| `apps/web/src/App.tsx` | Composition / pack loading order |
| `packages/streaming/src/policy.ts` | Optional: expose "catalog covers cut" signal |
| `tools/pack-octree/` + `apps/web/public/packs/octree/` | Gaia tile build |

---

## 6. Non-goals

- Do not fix this in Phase 3 gate (TASK-041) — M3 behaviour is frozen for gate sign-off.
- Do not remove procgen entirely — it remains the universe-scale filler per §2.
- Do not merge `StarScene` and `GalaxyScene` into one React tree without a design task;
  policy unification is enough if only one layer draws per scale.
