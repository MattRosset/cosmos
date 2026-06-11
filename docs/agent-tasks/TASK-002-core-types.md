# Task: `core-types` v1 — body records, Kepler elements, typed event map

**ID:** TASK-002
**Target package:** `packages/core-types`
**Size:** M
**Phase:** 0
**Depends on:** TASK-001

## Goal

`@cosmos/core-types` exports every shared type the Phase 0–2 packages consume: body
records (`bodies.ts`), Keplerian orbital elements (`orbits.ts`), and the typed event map +
event bus (`events.ts`). After this task the package's API is **frozen** until the next
phase-boundary API thaw window (architecture §16). `prng.ts` and `coords.ts` already
exist — do not modify them.

## Frozen Interface

These signatures are the deliverable. Implement them exactly — field names, units in
names, and radians are mandated by architecture §5.5/§5.7 and §15.

```ts
// ── src/orbits.ts ───────────────────────────────────────────────────────────
/**
 * Keplerian orbital elements. All angles in RADIANS — degrees exist only at the
 * data-pack boundary (architecture §5.5). Never abbreviate anomaly names.
 */
export interface KeplerElements {
  /** Semi-major axis, AU. */
  readonly semiMajorAxisAu: number;
  /** Eccentricity, dimensionless; [0, 1) elliptical. */
  readonly eccentricity: number;
  /** Inclination to the reference plane, radians. */
  readonly inclinationRad: number;
  /** Longitude of the ascending node (Ω), radians. */
  readonly ascendingNodeLongitudeRad: number;
  /** Argument of periapsis (ω), radians. */
  readonly argumentOfPeriapsisRad: number;
  /** Mean anomaly at `epochJD` (M₀), radians. */
  readonly meanAnomalyAtEpochRad: number;
  /** Reference epoch for the mean anomaly, Julian Date. */
  readonly epochJD: number;
  /** Standard gravitational parameter μ = GM of the PARENT body, km³/s². */
  readonly muKm3S2: number;
}

// ── src/bodies.ts ───────────────────────────────────────────────────────────
/** Namespaced id, e.g. "hyg:32349" (catalog) or "proc:gal0:sec12:42" (procedural). */
export type BodyId = string;

export interface StarRecord {
  readonly id: BodyId;
  readonly kind: 'star';
  readonly name?: string;
  /** Galactic Cartesian position, PARSECS — canonical universe frame (ADR-001, §2.2). */
  readonly positionPc: readonly [number, number, number];
  /** Absolute visual magnitude. */
  readonly absMag: number;
  /** B–V color index (temperature proxy for the blackbody LUT, §5.9). */
  readonly colorIndexBV: number;
  /** Hierarchical procgen seed — present ONLY on procedural stars. */
  readonly seed?: number;
}

export interface PlanetRecord {
  readonly id: BodyId;
  readonly kind: 'planet';
  readonly name?: string;
  /** Star or planet (for moons) this body orbits. */
  readonly parentId: BodyId;
  readonly radiusKm: number;
  readonly massKg?: number;
  /** Absent ⇒ procedural fallback per §5.7 missing-data rules (documented there). */
  readonly elements?: KeplerElements;
  readonly seed?: number;
}

export interface GalaxyRecord {
  readonly id: BodyId;
  readonly kind: 'galaxy';
  readonly name?: string;
  /** Position in the universe context, MEGAPARSECS. */
  readonly positionMpc: readonly [number, number, number];
  readonly radiusKpc: number;
  /** Procedural galaxies are fully seed-defined. */
  readonly seed: number;
}

export type BodyRecord = StarRecord | PlanetRecord | GalaxyRecord;

// ── src/events.ts ───────────────────────────────────────────────────────────
import type { ContextId } from './coords';
import type { BodyId } from './bodies';

/** All cross-package events. Names follow `domain/action` (architecture §15). */
export interface CosmosEventMap {
  'coords/rebased': {
    readonly context: ContextId;
    /** Offset subtracted from all root render groups, in context units (f64). */
    readonly offsetUnits: readonly [number, number, number];
  };
  'coords/contextChanged': { readonly from: ContextId; readonly to: ContextId };
  'nav/contextSwitchRequested': {
    readonly target: ContextId;
    readonly anchorId: BodyId | null;
  };
  'selection/changed': { readonly id: BodyId | null };
  'time/changed': {
    readonly epochJD: number;
    readonly accel: number;
    readonly paused: boolean;
  };
}

export type CosmosEventName = keyof CosmosEventMap;
export type CosmosEventHandler<E extends CosmosEventName> = (
  payload: CosmosEventMap[E],
) => void;

export interface EventBus {
  /** Subscribe; returns an unsubscribe function. */
  on<E extends CosmosEventName>(event: E, handler: CosmosEventHandler<E>): () => void;
  emit<E extends CosmosEventName>(event: E, payload: CosmosEventMap[E]): void;
}

/** Synchronous fan-out. A throwing handler must not prevent later handlers. */
export function createEventBus(): EventBus;
```

`src/index.ts` re-exports all of the above (extend the existing re-export list).

## Inputs / Outputs

- **Inputs:** none — this package has ZERO runtime/dep inputs by definition (§4).
- **Outputs:** types + `createEventBus`. Example fixture to use in tests:
  Earth ≈ `{ semiMajorAxisAu: 1.00000261, eccentricity: 0.01671123, inclinationRad: -2.672e-7, ascendingNodeLongitudeRad: 0, argumentOfPeriapsisRad: 1.79677, meanAnomalyAtEpochRad: 6.2400, epochJD: 2451545.0, muKm3S2: 1.32712440018e11 }`
  (JPL approximate elements at J2000; μ is the Sun's).

## Constraints & Forbidden Actions

- Do not modify `src/prng.ts` or `src/coords.ts`.
- **Zero dependencies** — no Zod here. Zod validation happens at pack-build time in
  `tools/` (§5.7), never in `core-types`.
- No classes for records — plain readonly interfaces (data-driven doctrine, §1.4).
- Do not add events speculatively beyond the map above; new events = new reviewed task.
- No `Math.random()` (lint-enforced in this package).

## Common Mistakes (architecture §5.4, §5.5, §5.7, §15)

- Degrees vs. radians — standardize on radians internally, convert at the data-pack
  boundary; wrong anomaly (mean vs. eccentric vs. true) — name variables explicitly
  `meanAnomaly...`, never `M`.
- Mixing units — encode units in names: `distancePc`, `semiMajorAxisAu`, `radiusKm`.
- Accumulating epoch in seconds-as-f32 — epochs are Julian Date f64.
- Ignoring missing-data flags in real catalogs — `elements?` is optional on purpose;
  fallbacks are defined in `data` (§5.7), not here.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/core-types test` — new `test/events.test.ts` asserts:
   on/emit round-trip; unsubscribe stops delivery; a throwing handler does not block
   later handlers; payload types are enforced (compile-time via `// @ts-expect-error`
   cases in the test file).
2. `pnpm verify` exits 0 at repo root (lint boundaries still hold: package imports nothing).
3. Existing `test/prng.test.ts` still passes unmodified.

## Deliverables

- `packages/core-types/src/bodies.ts`
- `packages/core-types/src/orbits.ts`
- `packages/core-types/src/events.ts`
- `packages/core-types/src/index.ts` (re-exports only)
- `packages/core-types/test/events.test.ts`

## Context Files

- `docs/architecture.md` §4, §5.5, §5.7, §5.12 (event-bus boundary), §15
- `docs/decisions/ADR-001-coordinates.md`
- `packages/core-types/src/coords.ts`, `src/prng.ts` (existing style to match)
