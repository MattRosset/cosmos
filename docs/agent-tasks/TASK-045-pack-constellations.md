# Task: `tools/pack-constellations` — IAU constellation line list → committed JSON pack

**ID:** TASK-045
**Target package:** `tools/pack-constellations` (new)
**Size:** S
**Phase:** 4 — lane (data tool)
**Depends on:** TASK-042

## Goal

Build the **constellation line pack**: a small, committed JSON file enumerating the IAU
constellation stick-figure line segments as **HIP-number pairs**, conforming to the
`ConstellationLineSet` type from `core-types` (TASK-042). This is build-time data prep
(architecture §5.7: all conversion happens in `tools/`, the browser sees only the packed
output). The pack is small enough to commit (unlike Gaia). `data` v4 (TASK-046) loads it
and resolves the HIP pairs to star positions at runtime.

## Frozen Interface

Consumes the frozen `ConstellationLineSet` type; produces a JSON pack.

```ts
import type { ConstellationLineSet } from '@cosmos/core-types';

/** The committed pack shape (JSON). */
export interface ConstellationPack {
  readonly packFormatVersion: 1;
  /** Source attribution string for ATTRIBUTIONS.md / About panel. */
  readonly source: string;
  readonly constellations: readonly ConstellationLineSet[];
}
```

Each `ConstellationLineSet`: `{ code, name, hipPairs }` where `hipPairs` is a flat list of
HIP numbers — segment `k` connects star `hipPairs[2k]` → `hipPairs[2k+1]` (TASK-042).

## Inputs / Outputs

- **Inputs:** a committed source line list keyed by HIP (a standard public IAU/Stellarium
  "constellationship" style list — committed as `src/constellation-lines.dat` or `.json`;
  cite the source + license in the file header and `ATTRIBUTIONS.md`).
- **Outputs:** `apps/web/public/packs/constellations.json` (a `ConstellationPack`), small
  (≈ tens of KB). Example entry:
  `{ code:'Ori', name:'Orion', hipPairs:[27989,26727, 26727,25336, 25336,24436] }`.

## Constraints & Forbidden Actions

- Do not modify `packages/core-types` or any package. This is a tool + a committed JSON.
- Use a **public-domain / free-with-attribution** constellation line source only; record
  the license in `ATTRIBUTIONS.md` and the pack `source` field.
- Reproducible: same input → byte-identical `constellations.json` (sort constellations by
  `code`, preserve segment order from the source; no timestamps).
- No `Math.random()`. No network at build/test time (read the committed source file).
- New dependencies: none beyond what sibling pack tools use (reuse their JSON/CSV I/O).

## Common Mistakes (architecture §5.7, §11)

- Shipping the raw source list to the browser — convert to the `ConstellationLineSet`
  shape at build time; the app loads only the packed JSON.
- Storing positions instead of HIP refs — positions are resolved at runtime by `data`
  (TASK-046) against the loaded star source, so the pack stays tiny and frame-agnostic.
- Odd-length `hipPairs` — every segment is exactly two HIPs; assert even length.
- Missing attribution — the build fails if the credit is absent (the §11 doctrine).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/pack-constellations test` (Vitest):
   - The emitted pack validates as a `ConstellationPack` (`packFormatVersion === 1`),
     every `ConstellationLineSet.hipPairs` has **even length**, all entries are positive
     integers, and `code` is a unique 3-letter string.
   - A spot check: Orion (`Ori`) is present and includes the Betelgeuse↔Bellatrix
     segment (assert a known HIP pair exists).
   - Reproducibility: building twice yields a byte-identical `constellations.json`
     (golden-hash fixture).
   - Attribution present (build asserts the credit line).
2. `pnpm verify` exits 0; the committed pack is present and under a size budget (e.g.
   ≤ 128 KB).

## Deliverables

- `tools/pack-constellations/package.json`, `tsconfig.json`, `vitest.config.ts`
- `tools/pack-constellations/src/cli.ts`, `src/convert.ts`,
  `src/constellation-lines.dat` (committed source + license header)
- `tools/pack-constellations/test/pack-constellations.test.ts`,
  `test/fixtures/golden-hash.json`
- `apps/web/public/packs/constellations.json` (committed output)
- `ATTRIBUTIONS.md` (constellation-line source credit),
  `tools/pack-constellations/README.md` (< 150 lines)

## Context Files

- `packages/core-types/src/overlay.ts` (the `ConstellationLineSet` type — TASK-042)
- `docs/architecture.md` §5.7 (build-time data pipeline), §5.12 (constellation lines),
  §11 (reproducible packs + attribution)
- `tools/pack-exoplanets/` or `tools/pack-octree/` (a sibling pack tool to mirror for
  package layout, CLI, golden-hash test, and I/O helpers)
