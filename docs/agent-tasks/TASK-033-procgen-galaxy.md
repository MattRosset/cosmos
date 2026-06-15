# Task: `procgen` v1 — deterministic galaxy star generator

**ID:** TASK-033
**Target package:** `packages/procgen` (new)
**Size:** L
**Phase:** 3 — lane (pure generator; one of the two chunk producers `streaming` needs)
**Depends on:** TASK-031

## Goal

The deterministic, seedable galaxy generator of architecture §5.6 + ADR-004:
density-wave spiral-arm star distributions via rejection sampling, star properties
(mass → temperature → B–V color, absolute magnitude) from simplified main-sequence
relations, output as a `StarBatch` whose typed arrays back onto transferable
`ArrayBuffer`s plus a JSON-able layout manifest. **Every output is a pure function
of `(seed, params)`** — runs byte-identically on the main thread (tests) and in a
worker (production, via the §5.13 entry this task also ships). No Three.js, no DOM,
no React; `core-types` only.

## Frozen Interface

```ts
// public API of @cosmos/procgen
import type {
  GalaxyGenParams, StarBatch, ProcgenGalaxyRequest,
} from '@cosmos/core-types';

/** Layout of the buffers a generated batch is packed into (the JSON manifest of
 *  §5.6 "describes layout"). Mirrors StarPackManifest.buffers slicing. */
export interface GalaxyBufferLayout {
  readonly count: number;
  /** Single backing buffer; the StarBatch typed arrays are views into it. */
  readonly byteLength: number;
  readonly positionsPc: { readonly byteOffset: number; readonly byteLength: number };
  readonly absMag: { readonly byteOffset: number; readonly byteLength: number };
  readonly colorIndexBV: { readonly byteOffset: number; readonly byteLength: number };
  readonly catalogIds: { readonly byteOffset: number; readonly byteLength: number };
  readonly hipIds: { readonly byteOffset: number; readonly byteLength: number };
}

export interface GalaxyResult {
  readonly batch: StarBatch;
  readonly layout: GalaxyBufferLayout;
  /** The single ArrayBuffer all batch arrays view (the thing to transfer, §5.13). */
  readonly buffer: ArrayBuffer;
}

/**
 * Generate a galaxy as a packed StarBatch. Pure: identical (params) ⇒ byte-identical
 * `buffer`. `originPc` of the batch = [0,0,0] (galaxy-context, galaxy centered at
 * origin per ADR-004 §1); `idPrefix` = `gal<seed>`; catalogIds[i] = i; hipIds = 0.
 * Allocates exactly one backing ArrayBuffer. Defaults from PROCGEN_GALAXY_DEFAULTS.
 */
export function generateGalaxy(params: GalaxyGenParams): GalaxyResult;

/** The §5.13 worker handler (injected into workers' serveWorker). isCancelled is
 *  polled inside the star loop; on cancel it returns early with count = drawn-so-far
 *  (the pool discards a cancelled result). */
export function galaxyWorkerHandler(
  req: ProcgenGalaxyRequest,
  isCancelled: () => boolean,
): { readonly batch: StarBatch; readonly transfer: readonly ArrayBuffer[] };
```

## Fixed semantics (transcribe, don't redesign — ADR-004)

All math, parameters, and the seed hierarchy are pinned by **ADR-004**. Transcribe,
do not invent:

- **Coordinate model** (ADR-004 §1): galaxy-context parsecs, disc in x–y, +z north,
  centered at origin. Defaults come from `PROCGEN_GALAXY_DEFAULTS`.
- **Radial/vertical profile** (ADR-004 §2): exponential disc by inverse-CDF for `r`,
  sech²-disc inverse-CDF for `z`; the `bulgeFraction` of stars use the Plummer-like
  spherical bulge instead.
- **Spiral arms** (ADR-004 §3): log-spiral phase `θ_arm(r)`, angular density
  modulation `m(φ,r)` with `armCount` arms, **rejection sampling** of `φ` with
  envelope ceiling `armContrast`, 64-attempt cap then accept-last.
- **IMF + color** (ADR-004 §4): Kroupa (2001) broken power law on `[0.1,50] M☉` by
  inverse-CDF; `T_eff = 5772·(M)^0.54`; T→B–V via the **inverse Ballesteros (2012)**
  relation (the same relation `render-stars` uses forward — cite Ballesteros 2012 in
  a code comment, §15); `L = M^3.5`, `M_V = 4.83 − 2.5·log10(L)`.
- **Seed hierarchy** (ADR-004 §5): `sectorSeed = hashCombine(galaxySeed, sectorId)`
  then `createPrng(sectorSeed).fork(streamId)` for streams
  `PROCGEN_STREAM_PLACEMENT|MASS|JITTER`. Phase 3 generates the galaxy as a single
  sector (`sectorId = 0`) per call; the per-sector structure exists so `streaming`
  can later request sub-regions. **No `seed + index`** anywhere (§5.6).
- **Packing:** one `ArrayBuffer`; attribute order positionsPc (3×count f32),
  absMag (count f32), colorIndexBV (count f32), catalogIds (count u32),
  hipIds (count u32); every slice 4-byte aligned (counts are already aligned).
  The `StarBatch` arrays are `subarray`/views into this buffer — no per-attribute
  allocation, no per-star object (§5.6 "generate straight into typed arrays").

## Inputs / Outputs

- **Inputs:** `generateGalaxy({ seed: 1, starCount: 1_000_000 })`.
- **Outputs:** a `GalaxyResult` whose `batch.count === 1_000_000`,
  `batch.originPc === [0,0,0]`, `batch.idPrefix === 'gal1'`,
  `batch.positionsPc.length === 3_000_000`; the same call again ⇒ byte-identical
  `buffer` (same SHA-256).

## Constraints & Forbidden Actions

- Do not modify `core-types`. Allowed dependencies: `@cosmos/core-types` ONLY
  (§4: `procgen` imports only core-types). No Three.js, no DOM, no `@cosmos/workers`
  (the worker entry calls `serveWorker` but `serveWorker` is imported by the *entry
  file* which lives in `apps/web` or a thin worker package; see Deliverables —
  this package exports `galaxyWorkerHandler`, it does not import `workers`).
- **No `Math.random()`** anywhere (lint-banned in this package, §5.6) — use
  `createPrng`/`hashCombine`/`fork` from `core-types`.
- No per-star objects (GC death, §5.6) — generate straight into the typed arrays.
- Generation takes region + params, **never a camera** (§5.6).
- No allocations beyond the single backing buffer + small scratch in
  `generateGalaxy`; the inner star loop allocates nothing.

## Common Mistakes (architecture §5.6 — copy kept verbatim)

- `Math.random()` anywhere (lint-ban it in this package) — breaks determinism and
  tests.
- Generating per-star objects (GC death) — generate straight into typed arrays.
- Coupling generation to camera (generation takes region + LOD, never camera).
- Seed collisions from naive `seed + index` — use proper hash mixing.
- Plus: drawing the same PRNG stream for placement and mass (they MUST be separate
  forks per ADR-004 §5, or arm structure correlates with the mass function);
  forgetting the 64-attempt rejection cap (a degenerate `armContrast` could loop).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/procgen test` — `test/galaxy.test.ts`:
   - **Determinism (§5.6 snapshot):** `generateGalaxy({seed:1,starCount:50000})`
     twice ⇒ identical SHA-256 of `buffer`; a different `seed` ⇒ different hash;
     a committed golden hash for `{seed:1,starCount:1000}` is asserted (catches any
     accidental math change).
   - **Shape:** `batch.count`, array lengths, `originPc === [0,0,0]`,
     `idPrefix === 'gal1'`, `catalogIds[i] === i`, all `hipIds === 0`.
   - **Spatial sanity:** all `|position|` within `discRadiusPc` (+ a small bulge/z
     margin); radial histogram falls off ~exponentially (fit slope within
     tolerance of `−1/discScaleLengthPc`); azimuthal histogram at a fixed radius
     shows `armCount` peaks whose contrast ≈ `armContrast` ± tolerance (the arms
     are real, not uniform).
   - **Statistical color test (§5.6):** the emitted B–V distribution matches the
     Kroupa+relations expectation — bin B–V and assert the fraction of blue
     (`bv < 0.0`), solar (`0.5 ≤ bv < 0.8`), and red (`bv ≥ 1.4`) stars are within
     ±15% of values computed from the analytic IMF→color chain (compute the
     expectation in the test from ADR-004 §4, do not hardcode opaque numbers).
   - **No `Math.random`:** a source-scan assertion (regex over `src/`) finds zero
     `Math.random` occurrences.
   - **Zero per-star allocation:** generating into a pre-warmed run shows the
     backing buffer is the only large allocation (same-identity / single-buffer
     check pattern from `render-stars`).
   - **Cancellation:** `galaxyWorkerHandler(req, () => true)` returns promptly with
     a partial/empty batch (does not run the full loop).
2. **Perf (§5.6 gate):** `generateGalaxy({seed:1,starCount:1_000_000})` completes
   < 500 ms (asserted with a CI-relaxed multiple; the 500 ms is the worker-target,
   documented — the test measures the pure call, which is the dominant cost).
3. **Coverage gate:** statement coverage ≥ 90% on `src` (§13 pure-package gate).
4. `pnpm verify` exits 0 (boundary lint: only `@cosmos/core-types` imported).

## Deliverables

- `packages/procgen/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/procgen/src/galaxy.ts` (`generateGalaxy` + `galaxyWorkerHandler`),
  `src/sampling.ts` (inverse-CDF + rejection helpers, pure, exported for tests),
  `src/stellar.ts` (IMF + mass→T→B–V→M_V, pure, exported for tests),
  `src/index.ts`
- `packages/procgen/test/galaxy.test.ts`, `test/sampling.test.ts`,
  `test/stellar.test.ts`, `test/fixtures/golden-hash.json`
- `packages/procgen/README.md` (< 150 lines; cite ADR-004, Ballesteros 2012,
  Kroupa 2001, Curtis where relevant per §15)

## Context Files

- `docs/architecture.md` §5.6 (whole section), §9 (no per-frame alloc / budgets), §15
- `docs/decisions/ADR-004-galaxy-density-wave.md` (the entire model — normative)
- `packages/core-types/src/procgen.ts` (`GalaxyGenParams`, defaults, stream ids),
  `src/batches.ts` (`StarBatch` contract), `src/prng.ts` (`createPrng`/`fork`/
  `hashCombine`)
- `packages/render-stars/README.md` (the forward Ballesteros B–V→color LUT this
  generator's colors feed; keep the relation consistent)
