# @cosmos/core-types

The zero-dependency vocabulary of the whole monorepo: the shared types, schemas,
constants, and small pure helpers every other package imports. It sits at the root of
the dependency graph (architecture §4) — it imports **nothing**, and everything else
imports it.

**Frozen by discipline.** This package is the frozen interface that makes parallel agent
work safe (architecture §8.2). It may change **only** inside an explicitly sanctioned
*thaw* task — never as a side effect of feature work. The thaws so far: TASK-007 (Phase 1
packs + `StarBatch`), TASK-018 (Phase 2 systems, bookmarks, frames), TASK-031 (Phase 3
octree, procgen, streaming, quality, worker-rpc), TASK-042 (Phase 4a atmosphere, nebula,
overlay, tour, cinematic), TASK-054 (the `errors` module + `ChunkLifecycleEvent.error`
phase). Outside those windows, if a signature looks wrong, set your task `blocked` and
report — do not "fix" it.

## Public API

Everything is re-exported from `src/index.ts`, grouped by domain:

**Bodies & systems**
- `bodies` — `BodyId` + the record schemas (`StarRecord`, `PlanetRecord`, `GalaxyRecord`).
- `systems` — `StarSystemRecord`: a host star plus a flat list of orbiting planets/moons.

**Coordinates & frames**
- `coords` — `ContextId`, `UniversePosition`, `CONTEXT_UNIT_METERS`: the scale-context
  vocabulary (ADR-001, §5.2).
- `frames` — J2000 ICRS/ecliptic → galactic rotation matrices and obliquity constants.

**Orbits & time**
- `orbits` — `KeplerElements`: orbital elements, angles in radians (§5.5).

**Catalog packs & renderer batches**
- `packs` — `StarPackManifest` + `BufferSlice`: the on-disk `.bin` layout contract (§11).
- `batches` — `StarBatch`: the tile-local f32 renderer input contract (§5.9).

**Octree, procgen & streaming**
- `octree` — `OctreeTileManifest`, `MortonKey`, split-threshold constants (ADR-003).
- `procgen` — `GalaxyGenParams` + `PROCGEN_GALAXY_DEFAULTS` (ADR-004).
- `streaming` — `ChunkLifecycleEvent` + its `request | ready | evict | error` phases (§5.8).
- `quality` — `QualityTier` + the `QUALITY_TIERS` degradation table (§9).

**Workers & events**
- `worker-rpc` — `WorkerRequest`/`WorkerResponse` envelopes + `WorkerErrorPayload` (§5.13).
- `events` — `CosmosEventMap`: the typed `domain/action` cross-package event bus (§15).

**Errors**
- `errors` — `AppError`/`AppErrorKind` + `toAppError`: JSON-serializable error records that
  survive `postMessage` and beacons (hardening track, TASK-054).

**Persistence**
- `bookmarks` — `BookmarkRecord`: versioned camera/position bookmark schema (§5.12).

**Render-fx data contracts (Phase 4a)**
- `atmosphere` — `AtmosphereParams`: O'Neil scattering params (ADR-005; shader in render-planets).
- `nebula` — `NebulaLayer`/`NebulaField`: camera-facing billboard params (§5.11).
- `overlay` — `ConstellationLineSet` + screen-space label records (§5.12).
- `tour` — `TourStep`: one stop in a guided tour (§5.12).
- `cinematic` — `CameraKeyframe`: a camera-spline keyframe carrying `UniversePosition` (§5.3).

**Determinism helper**
- `prng` — `createPrng`/`hash32`/`hashCombine`: the one seedable PRNG all generation uses.

## Invariants

1. **Imports nothing.** Zero runtime dependencies; it is the graph root (architecture §4).
2. **No Three.js, no React, no DOM.** Types only (plus tiny pure helpers like `prng` and
   `frames` matrix math) — nothing that touches a rendering or browser API.
3. **`Math.random()` is lint-banned** here and everywhere downstream — generation uses
   `createPrng` (determinism doctrine, architecture §5.6 / §8.6).
4. **Units live in names.** `distancePc`, `semiMajorAxisAu`, `radiusKm`, `epochJD` — the
   units-in-names convention (architecture §15).
5. **Records are `readonly`.** Schemas describe immutable data crossing package/worker
   boundaries; Zod validation happens at data boundaries, not here.

## Testing

`pnpm --filter @cosmos/core-types test` — property-style seeded-PRNG loops and schema/round-trip
checks. Statement coverage is gated in CI since TASK-062.
