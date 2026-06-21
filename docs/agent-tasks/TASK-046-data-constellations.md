# Task: `data` v4 — constellation pack loader + segment/label resolution

**ID:** TASK-046
**Target package:** `packages/data`
**Size:** M
**Phase:** 4 — lane (data runtime); additive thaw of the `data` API
**Depends on:** TASK-042, TASK-045

## Goal

Load the constellation pack (TASK-045) and expose the runtime queries the educational
overlay needs (architecture §5.12): **constellation line segments resolved to star
positions** (HIP pairs → absolute galactic-frame parsecs, via the loaded star source) and
a **label-candidate query** (the brightest/nearest named bodies in view, for the screen
label layer). This is an **additive** extension of `data` — existing loaders
(`loadStarPack`, `loadSystemsPack`, `loadOctreePack`, `createCombinedSource`) are
unchanged.

## Frozen Interface

```ts
import type { ConstellationLineSet, LabelRecord, StarBatch } from '@cosmos/core-types';

export interface ConstellationSource {
  /** All constellations in the pack. */
  readonly constellations: readonly ConstellationLineSet[];
  /**
   * Resolved line endpoints as packed segments, absolute galaxy-frame PARSECS (f64
   * pairs): for N total segments, a Float64Array of length 6N — [ax,ay,az, bx,by,bz, …].
   * HIP numbers with no matching star in `stars` are dropped (the segment is omitted).
   * Computed once at load against the provided star source; pure.
   */
  segmentsPc(): Float64Array;
  /** Per-segment constellation code, length N (parallel to segmentsPc/6). */
  segmentCodes(): readonly string[];
}

/** Build a ConstellationSource by resolving HIP pairs against a star source. */
export function createConstellationSource(
  pack: ConstellationPack,
  stars: { hipIndex(hip: number): number | undefined; positionPcByIndex(i: number): readonly [number, number, number] },
): ConstellationSource;

/** Fetch + validate the constellation pack JSON (mirrors loadStarPack error style). */
export function loadConstellationPack(
  manifestUrl: string,
  opts?: { fetchImpl?: typeof fetch },
): Promise<ConstellationPack>;

/** Label candidates for the overlay: named bodies, ranked by `priority` (LabelRecord). */
export function labelCandidates(
  source: { /* StarDataSource | CombinedSource */ },
  opts?: { max?: number },
): readonly LabelRecord[];
```

`ConstellationPack` is the JSON shape from TASK-045. The `stars` adapter passed to
`createConstellationSource` is satisfied by the existing `StarDataSource` (it already
exposes HIP lookup via `search("hip N")` and per-index positions — expose the two thin
accessors above if not already public, additively).

## Inputs / Outputs

- **Inputs:** `apps/web/public/packs/constellations.json` (TASK-045); a loaded
  `StarDataSource`/`CombinedSource` for HIP→position resolution.
- **Outputs:** a `ConstellationSource` (packed f64 segment endpoints + parallel codes),
  and a `LabelRecord[]` of named bodies. Endpoints are **absolute parsecs**; the app
  converts to camera-relative f32 at render time (the renderer/line-set never sees
  absolute coords, ADR-001).

## Constraints & Forbidden Actions

- **Additive only.** Do not change `loadStarPack`, `loadSystemsPack`, `loadOctreePack`,
  `createCombinedSource`, or their types. Existing `data` tests pass unmodified.
- No Three.js, no React, no DOM beyond the injectable `fetch` (the package boundary).
- `segmentsPc()` returns a cached buffer built once at construction — do not rebuild per
  call; do not allocate per call.
- Drop unresolved HIPs silently (catalogs differ) — never throw on a missing star.
- Label text/priority: derive `priority` from absolute magnitude (brighter ⇒ lower
  number ⇒ more important), per ADR-/§5.12; `text` from the body name (skip unnamed).
- No new dependencies.

## Common Mistakes (architecture §5.7, §5.12; ADR-001)

- Returning absolute positions to the renderer — `segmentsPc()` is absolute f64 **for the
  app to rebase**; the line-set renderer (TASK-047) gets camera-relative f32 + an offset.
- Rebuilding the segment buffer every frame — build once at load (it is static data).
- Throwing when a HIP is missing — Gaia/HYG coverage differs; drop the segment.
- Parsing the pack in a hot path — load once, like the other packs.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/data test` — new `test/constellations.test.ts`:
   - `loadConstellationPack` (Node `fetchImpl`) loads a fixture pack; rejects a
     wrong `packFormatVersion` (mirrors `loadStarPack`'s `PackFormatError` style).
   - `createConstellationSource` resolves a 2-segment fixture to a `Float64Array` of
     length 12 with the correct endpoint positions from the fixture star source; a pair
     with a missing HIP yields one fewer segment (dropped, no throw); `segmentCodes()`
     length equals `segmentsPc().length / 6`.
   - `segmentsPc()` returns the **same array identity** on repeated calls (cached).
   - `labelCandidates` returns named bodies ranked by `priority` (brightest first),
     capped at `max`, each a valid `LabelRecord` with absolute `positionPc`.
2. **All existing `data` tests pass unmodified.**
3. `pnpm verify` exits 0 (boundary lint unchanged; package coverage ≥ its existing
   threshold).

## Deliverables

- `packages/data/src/constellations.ts` (`loadConstellationPack`,
  `createConstellationSource`, `labelCandidates`), `src/index.ts` (additive re-exports),
  and any thin additive accessor on `StarDataSource` (`hipIndex`/`positionPcByIndex`) if
  not already public
- `packages/data/test/constellations.test.ts`, `test/fixtures/constellations-mini.json`
- `packages/data/README.md` (a "Constellations (Phase 4)" section)

## Context Files

- `packages/core-types/src/overlay.ts` (`ConstellationLineSet`, `LabelRecord` — TASK-042)
- `docs/agent-tasks/TASK-045-pack-constellations.md` (the pack shape this loads)
- `packages/data/README.md` + `src/` (the existing loaders + `StarDataSource` HIP/index
  accessors to reuse; the `PackFormatError` validation style to mirror)
- `docs/architecture.md` §5.12 (constellation lines + labels), §5.7 (load once, no
  runtime parsing), ADR-001 §5 (absolute vs camera-relative split)
