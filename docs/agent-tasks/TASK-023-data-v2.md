# Task: `data` v2 — systems-pack loader + combined body source

**ID:** TASK-023
**Target package:** `packages/data`
**Size:** M
**Phase:** 2 — lane I (data runtime)
**Depends on:** TASK-018

## Goal

The sanctioned Phase-2 thaw of the `data` public API (additions below only;
everything from TASK-009 keeps its exact behavior): load `SystemsPackManifest`
JSON packs (sol + exoplanets), and provide the **combined source** that merges the
HYG star catalog with system hosts and planets behind one uniform body API (§5.7:
"renderers can't tell real from procedural") — unified `getBody`/`search`, a
deduplication rule for hosts that already exist in HYG, a `StarBatch` of the
remaining exo hosts so they become visible/pickable stars, and the
nearest-host-system query the M2 glue uses to choose the context-switch anchor.
Buildable and testable entirely against fixture packs — does not need TASK-021/022
output.

## Frozen Interface (additions to @cosmos/data — existing API unchanged)

```ts
import type {
  BodyId, BodyRecord, StarBatch, StarSystemRecord, SystemsPackManifest,
} from '@cosmos/core-types';
import type { StarDataSource, LoadOptions } from './load'; // existing types

/** Thrown on packFormatVersion mismatch or schema violations (mirrors PackFormatError). */
export class SystemsPackFormatError extends Error {}

export interface SystemsSource {
  readonly systems: readonly StarSystemRecord[];
  getSystem(systemId: BodyId): StarSystemRecord | undefined;
  /** Host stars (by star id) AND planets/moons (by body id). */
  getBody(id: BodyId): BodyRecord | undefined;
  /** The system a body (host star or planet) belongs to. */
  systemOfBody(id: BodyId): StarSystemRecord | undefined;
}

/** Fetch + validate. Rejects wrong packFormatVersion (§11). */
export function loadSystemsPack(
  manifestUrl: string,
  opts?: LoadOptions,
): Promise<SystemsSource>;

export interface NearestHostHit {
  readonly systemId: BodyId;
  readonly distancePc: number;
}

export interface CombinedSource {
  /** Star, host, or planet — one namespace. */
  getBody(id: BodyId): BodyRecord | undefined;
  /**
   * Unified search over HYG stars, hosts, and planets. Ranking: exact name match
   * first, then prefix, then substring; ties by ascending absMag (stars) /
   * alphabetical (planets). Hosts deduplicated per the rule below.
   */
  search(query: string, max?: number): BodyRecord[];
  /**
   * Exo hosts NOT resolved to an HYG star, as a renderable batch.
   * idPrefix "exoidx"; catalogIds[i] = i. null when every host resolved.
   */
  readonly extraHostBatch: StarBatch | null;
  /** Maps extraHostBatch index → the host star's real BodyId. */
  readonly hostIdByIndex: readonly BodyId[];
  /** Resolve a batch-pick id ("exoidx:i") or any id to its canonical record id. */
  canonicalId(id: BodyId): BodyId;
  /**
   * Anchor of the system whose HOST STAR is nearest to the given absolute
   * galaxy-frame position (pc). Includes 'sol'. Low-frequency call (≤ 10 Hz) —
   * may allocate the hit object.
   */
  nearestHostSystem(xPc: number, yPc: number, zPc: number): NearestHostHit | null;
  /** Host star's absolute galaxy-frame position for a system (HYG position when
   *  the host was deduplicated to an HYG star). */
  hostPositionPc(systemId: BodyId): readonly [number, number, number] | undefined;
}

export function createCombinedSource(
  stars: StarDataSource,
  systems: readonly SystemsSource[],
): CombinedSource;
```

**Host deduplication rule (fixed):** a system's host resolves to an HYG star when
`stars.search(host.name)` contains a star whose `name` equals the host's name
case-insensitively (e.g. Sol → `hyg:0`; "Tau Ceti" if named in HYG). When resolved:
the HYG record is the canonical host record, the HYG **position is authoritative**
(`hostPositionPc` returns it — the rendered star and the anchor must coincide), and
the host is excluded from `extraHostBatch`. Unresolved hosts keep their pack
record/position and appear in the batch.

## Inputs / Outputs

- **Inputs:** fixture packs in `test/fixtures/`: a 3-system exo manifest (one host
  named to collide with a fixture HYG star, two unresolved) + a mini sol manifest;
  the existing HYG fixture loader.
- **Outputs:** e.g. `search('trappist')` → TRAPPIST-1 host first, then its planets;
  `getBody('exo:trappist-1:e')` → `PlanetRecord`; `nearestHostSystem(0, 0, 0)` →
  `{ systemId: 'sol', distancePc: 0 }`.

## Constraints & Forbidden Actions

- Do not modify `core-types`. Only the API additions above may change `data`'s
  public surface (this file is the thaw approval). All TASK-009 tests pass
  UNMODIFIED — if one breaks, the task is `blocked`, not the test edited.
- No Three.js, no React, no DOM beyond injectable `fetch` (existing pattern).
- `extraHostBatch` positions are f32 RELATIVE to `originPc` (reuse `[0,0,0]` origin
  convention — hosts are < 50 pc out, well within f32 at that origin) — never
  absolute f32 beyond that documented range (§5.2).
- `nearestHostSystem` is ≤ 10 Hz glue API — allocation allowed but document it;
  do NOT wire it into any per-frame path.
- No new dependencies.

## Common Mistakes (architecture §5.7 — copy kept verbatim)

- Parsing CSV in the browser — n/a; systems packs are JSON, fetched and validated
  only.
- Mixing units — host positions parsecs, planet elements AU; never convert here
  (propagation is `orbits` + glue).
- Loading entire Gaia subset eagerly — n/a, but DO load both systems packs lazily
  via explicit calls; no module-level fetches.
- Ignoring missing-data flags — planets may lack `elements` (Sol disc) — `getBody`
  must still return them; renderable completeness is the packer's job, not enforced
  here.
- Plus: letting `search` return both the HYG record AND the pack record for a
  deduplicated host (the dedupe rule exists exactly to prevent this).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/data test` — new `test/systems.test.ts` +
   `test/combined.test.ts` (fixture-driven, injected fetch):
   - `loadSystemsPack`: valid fixture loads; wrong `packFormatVersion` and a
     planet with `eccentricity ≥ 1` throw `SystemsPackFormatError`.
   - `SystemsSource`: `getSystem`, `getBody` (host + planet), `systemOfBody` all
     resolve; unknown ids → undefined.
   - Dedup: colliding host resolves to the HYG id; `canonicalId` maps both the
     pack host id and `exoidx:*` pick ids to canonical ids; `hostPositionPc`
     returns the HYG position for the resolved host and the pack position for
     unresolved ones.
   - `extraHostBatch`: count = unresolved hosts; ids round-trip via
     `hostIdByIndex`; positions match records within f32 epsilon; batch is `null`
     when all hosts resolve.
   - Search ranking: exact > prefix > substring proven with crafted names; planets
     findable by name ("TRAPPIST-1 e"); `max` respected; deduplicated host appears
     exactly once.
   - `nearestHostSystem`: returns Sol at the origin; returns the nearer of two
     fixture systems from a midpoint biased toward one; null for empty sources.
2. **Coverage gate:** unchanged from TASK-009 (do not lower thresholds).
3. `pnpm verify` exits 0.

## Deliverables

- `packages/data/src/systems.ts` (loader + SystemsSource),
  `src/combined.ts` (CombinedSource), `src/index.ts` (export additions)
- `packages/data/test/systems.test.ts`, `test/combined.test.ts`,
  `test/fixtures/systems-*.json`
- `packages/data/README.md` (API additions documented; keep < 150 lines)

## Context Files

- `docs/architecture.md` §5.7 (uniform body API), §11 (version rejection)
- `packages/data/src/load.ts`, `src/source.ts` (patterns + `LoadOptions` to reuse)
- `packages/core-types/src/systems.ts`, `src/batches.ts` (StarBatch contract —
  the `idPrefix:catalogIds[i]` rule that forces the `exoidx` scheme)
- `docs/agent-tasks/TASK-022-pack-exoplanets.md` (id scheme the fixtures mirror)
