# Task: `streaming` v1.1 — catalog-coverage-for-cut signal (procgen-fade primitive)

**ID:** TASK-044
**Target package:** `packages/streaming`
**Size:** S
**Phase:** 4 — lane (streaming); **§7-sensitive** (additive only, see Constraints)
**Depends on:** TASK-042

## Goal

Add the one primitive the M4a render-tier unification needs: a **"the loaded octree
covers the current visible cut"** signal, per
[`docs/research/phase4-render-tier-handoff.md`](../research/phase4-render-tier-handoff.md)
§3 and [ADR-006](../decisions/ADR-006-gaia-subset-tier-unification.md) §5. M3 fades the
procedural galaxy cloud with a hard-coded `GAL_PROCGEN_FLOOR`; M4a replaces that hack
with a real coverage query so the app can drive procgen opacity → 0 exactly when real
catalog tiles (HYG + Gaia) fill the view. This is an **additive, behavior-preserving**
extension of the frozen `streaming` v1 API — no change to LOD, budgets, eviction, or any
existing output.

## Frozen Interface

Additive surface on the existing `StreamingPolicy` (do not change existing members):

```ts
export interface StreamingPolicy {
  // ... all existing v1 members unchanged (update, visible, nearestBodyDistanceM,
  //     onChunk, setQualityTier, stats, dispose) ...

  /**
   * Catalog coverage of the current visible cut, in [0,1]: the fraction of the
   * chosen cut whose octree tiles are READY (decoded + mounted), with no pending or
   * in-flight gaps. 1 ⇒ real catalog fully covers the view (procgen can fade to 0);
   * 0 ⇒ no catalog coverage (procgen fully visible). Computed on the main thread in
   * the same `update()` pass — zero extra allocation on a settled cut.
   *
   * Defined only for octree chunks; procgen chunks do not count toward coverage.
   * Returns the value as of the last `update()`.
   */
  catalogCoverage(): number;
}
```

`catalogCoverage` reads the same per-frame cut/visible state `update()` already computes;
it does not traverse or fetch. The number is the **ready-tile fraction of the cut**
(count nodes on the chosen cut; the covered fraction = ready nodes ÷ cut nodes, weighted
by projected screen area so a large near tile counts more than a tiny far one — document
the weighting in the README and test it).

## Inputs / Outputs

- **Inputs:** none new — derived from the existing visible cut + chunk readiness state.
- **Outputs:** a scalar in `[0,1]`. Example: with the full cut ready, `1`; mid-load with
  half the (area-weighted) cut still requesting, `≈0.5`; empty/just-started, `0`.

## Constraints & Forbidden Actions

- **Additive only.** Do not change `update`, `visible`, `onChunk`, `setQualityTier`,
  `stats`, eviction, SSE/hysteresis, or budgets. Existing `streaming` tests pass
  byte-for-byte unmodified. This is the §7 "streaming is the sensitive integration
  package" rule — the change is a pure read-only accessor over existing state.
- Do not modify `core-types` (no coverage *type* — it is a `number`, see TASK-042 Goal).
- No allocations on the settled-cut `update()` path or in `catalogCoverage()` (it reads
  precomputed counters; the §5.8 allocation doctrine in the README still holds).
- No Three.js, no React (boundary lint). No new dependencies.

## Common Mistakes (architecture §5.8; handoff doc §2–§3)

- Computing coverage by fetching/traversing on demand — it must be derived from the cut
  already computed in `update()` (a 1-frame-stale coverage from a worker is wrong, §5.8).
- Counting procgen chunks as coverage — only real octree tiles count (handoff doc §3:
  procgen is the *filler*; coverage is about the *catalog* superseding it).
- Unweighted node fraction — a single huge near tile not yet ready should pull coverage
  well below 1 even if many tiny far tiles are ready; weight by projected area.
- Allocating a victims/temp array every frame — reuse module-scoped scratch (README
  "Allocation doctrine").

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/streaming test` — new `test/coverage.test.ts` (the existing
   suite drives the policy with a fake octree source + pool, the v1 pattern):
   - Empty/just-started (nothing ready) ⇒ `catalogCoverage() === 0`.
   - All cut tiles ready ⇒ `catalogCoverage() === 1`.
   - Partial: with a known cut where the (area-weighted) ready fraction is ~0.5, assert
     `catalogCoverage()` within tolerance of 0.5; assert a large unready near tile drags
     it below an equal-count-but-far-tiles-ready case (weighting check).
   - Procgen-only (no octree source / only procgen chunks) ⇒ coverage `0` regardless of
     procgen readiness.
   - Zero-allocation: `catalogCoverage()` called 1000× on a settled cut allocates nothing
     (the existing zero-alloc test harness / identity checks).
2. **All existing `streaming` tests pass unmodified.**
3. `pnpm verify` exits 0 (boundary lint unchanged; coverage gate ≥ the package's existing
   statement-coverage threshold).

## Deliverables

- `packages/streaming/src/policy.ts` (add `catalogCoverage` + the area-weighted ready
  accumulation into the existing `update()` cut pass), `src/index.ts` (no new export if
  `catalogCoverage` is a method on the returned object; otherwise re-export a helper)
- `packages/streaming/test/coverage.test.ts`
- `packages/streaming/README.md` (document `catalogCoverage` + the weighting)

## Context Files

- `docs/research/phase4-render-tier-handoff.md` (§2 mitigations being replaced, §3 target
  model + the coverage-fade rule), `docs/decisions/ADR-006-gaia-subset-tier-unification.md`
  (§5 the unification policy this enables)
- `docs/architecture.md` §5.8 (the policy brain, visibility on main thread)
- `packages/streaming/README.md` + `src/policy.ts` (the existing cut/visible/readiness
  state to read; the allocation doctrine), `src/sse.ts` (projected-pixel-extent helper
  for the area weighting)
