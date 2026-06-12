# Task: `core-types` Phase-2 thaw — system packs, planet visuals, bookmarks, frames

**ID:** TASK-018
**Target package:** `packages/core-types`
**Size:** S
**Phase:** 2
**Depends on:** TASK-017

## Goal

The one sanctioned Phase-1→2 API thaw (architecture §16) for `core-types`: add every
data contract Phase 2 lanes build against — the star-system pack format (`systems.ts`)
consumed by `tools/pack-solar`, `tools/pack-exoplanets`, and `data` v2; optional
visual/rotation fields on `PlanetRecord` consumed by `render-planets`; the bookmark
schema (`bookmarks.ts`) consumed by `app-state` v2; and the ecliptic→galactic frame
constants (`frames.ts`) that let orbit positions (computed in ecliptic J2000 axes)
live in our galactic-axis contexts. Per §7, **no renderer or loader may be built
before its data contract exists in `core-types`** — this task unblocks every Phase 2
lane. After it merges, `core-types` is frozen again until the Phase 2→3 thaw.

## Frozen Interface

```ts
// ── src/bodies.ts — ADDITIONS ONLY (every new field optional) ────────────────
/** Saturn-style ring annulus. Radii from the planet center, km. */
export interface RingSpec {
  readonly innerRadiusKm: number;
  readonly outerRadiusKm: number;
}

export interface PlanetRecord {
  // …all existing fields stay byte-identical…
  /** Sidereal rotation period, HOURS. Negative = retrograde. */
  readonly rotationPeriodH?: number;
  /** Axial tilt (obliquity to its orbit), radians. */
  readonly axialTiltRad?: number;
  /** URLs relative to the pack manifest's location. KTX2 (§9, §11). */
  readonly textures?: {
    readonly albedoUrl?: string;
    readonly ringUrl?: string;
  };
  readonly ring?: RingSpec;
  /** Flat fallback color, LINEAR RGB in [0,1] — used when no albedo texture. */
  readonly surfaceColorLinear?: readonly [number, number, number];
  /** Render as self-luminous (no terminator). Used for the Sol disc. */
  readonly unlit?: boolean;
}

// ── src/systems.ts (new) ─────────────────────────────────────────────────────
import type { BodyId, PlanetRecord, StarRecord } from './bodies';

export const SYSTEMS_PACK_FORMAT_VERSION = 1;

/**
 * One star system: a host star plus a FLAT list of orbiting bodies (planets and
 * moons; moons reference their planet via parentId). Element frame convention:
 * `KeplerElements` on these bodies are in ECLIPTIC-J2000-style axes; runtime
 * positions must be rotated by ECLIPTIC_TO_GALACTIC (src/frames.ts) before
 * entering a scale context (contexts use galactic axes, ADR-001 / TASK-008).
 */
export interface StarSystemRecord {
  /** "sol" or "exo:<host-slug>". */
  readonly id: BodyId;
  readonly name: string;
  /** Host star. For Sol this is the existing HYG record id "hyg:0". */
  readonly star: StarRecord;
  /** Planets and moons, flat. Body ids: "<systemId>:<body-slug>". */
  readonly bodies: readonly PlanetRecord[];
}

/** A systems pack is a single JSON file (no .bin — body counts are small). */
export interface SystemsPackManifest {
  readonly packFormatVersion: typeof SYSTEMS_PACK_FORMAT_VERSION;
  /** e.g. "jpl-approx-pos-1800-2050" or "nasa-exoplanet-archive-pscomppars". */
  readonly source: string;
  /** ISO date the pack was generated (build provenance, §11). */
  readonly generatedAtIso: string;
  readonly systems: readonly StarSystemRecord[];
}

// ── src/bookmarks.ts (new) ───────────────────────────────────────────────────
import type { UniversePosition } from './coords';
import type { BodyId } from './bodies';

export const BOOKMARKS_SCHEMA_VERSION = 1;

/** §5.12: versioned schema with migration function from day one. */
export interface BookmarkRecord {
  readonly id: string;
  readonly name: string;
  readonly createdAtIso: string;
  readonly position: UniversePosition;
  /** Camera orientation quaternion [x, y, z, w]. */
  readonly orientation: readonly [number, number, number, number];
  readonly epochJD: number;
  /**
   * Set when position.context === 'system': the system that must be anchored
   * (frame-tree anchor + nav anchor) BEFORE the position can be restored.
   */
  readonly anchorSystemId?: BodyId;
}

// ── src/frames.ts (new) ──────────────────────────────────────────────────────
/** IAU 2006 obliquity of the ecliptic at J2000.0, degrees. */
export const OBLIQUITY_J2000_DEG = 23.4392911;

/** J2000 ICRS-equatorial → galactic rotation, row-major (same as TASK-008). */
export const ICRS_TO_GALACTIC: readonly number[]; // 9 entries, values fixed below

/**
 * Ecliptic-J2000 → galactic rotation, row-major 3×3. Computed at module load as
 * ICRS_TO_GALACTIC × Rx(OBLIQUITY_J2000_DEG) — never hand-typed.
 */
export const ECLIPTIC_TO_GALACTIC: readonly number[];

/** out = M·[x,y,z]. Writes into `out`, returns it — zero allocation (§9). */
export function applyMat3(
  m: readonly number[],
  x: number,
  y: number,
  z: number,
  out: [number, number, number],
): [number, number, number];
```

`ICRS_TO_GALACTIC` values (row-major — copy verbatim, identical to TASK-008):

```
-0.0548755604  -0.8734370902  -0.4838350155
 0.4941094279  -0.4448296300   0.7469822445
-0.8676661490  -0.1980763734   0.4559837762
```

`Rx(ε)` (rotates ecliptic coords into equatorial: `v_eq = Rx(ε) · v_ecl`):

```
1      0        0
0   cos ε   −sin ε
0   sin ε    cos ε
```

`src/index.ts` re-exports all of the above (extend the existing re-export list).

## Inputs / Outputs

- **Inputs:** none (zero-dependency package by definition, §4).
- **Outputs:** types + constants. Example system record for downstream fixtures:
  `{ id: 'sol', name: 'Solar System', star: { id: 'hyg:0', kind: 'star', name: 'Sol', positionPc: [0,0,0], absMag: 4.83, colorIndexBV: 0.65 }, bodies: [{ id: 'sol:earth', kind: 'planet', name: 'Earth', parentId: 'hyg:0', radiusKm: 6371, rotationPeriodH: 23.934, axialTiltRad: 0.4091, elements: { …8 KeplerElements fields… } }] }`

## Constraints & Forbidden Actions

- Do not modify `src/coords.ts`, `src/prng.ts`, `src/orbits.ts`, `src/packs.ts`,
  `src/batches.ts`, or `src/events.ts`. **No new events** — Phase 2 uses the existing
  `time/changed`, `nav/contextSwitchRequested`, `coords/contextChanged`,
  `selection/changed` exactly as declared in Phase 0. New events = a new reviewed task.
- `src/bodies.ts` changes are ADDITIVE ONLY: new optional fields and the new `RingSpec`
  interface. Every existing field, doc comment, and `StarRecord`/`GalaxyRecord` stay
  byte-identical; all existing tests pass unmodified.
- Zero dependencies; no Zod here (validation is pack-build-time in `tools/`, §5.7).
- Plain readonly interfaces; no classes. `frames.ts` may contain code (like `prng.ts`)
  but only the two constants + `applyMat3` — no general matrix library.
- Do not add speculative fields (terrain, atmosphere, octree tiling — Phase 4).

## Common Mistakes (architecture §5.2, §5.7, §5.10)

- Storing absolute positions in f32 anywhere — systems carry *elements*, not
  positions; positions are computed per-epoch and stay f64 until camera-relative.
- Mixing units — units stay in names (`innerRadiusKm`, `rotationPeriodH`,
  `axialTiltRad`, `epochJD`).
- Hand-typing the product matrix `ECLIPTIC_TO_GALACTIC` — it MUST be computed from
  the two source matrices at module load (one source of truth; a typo here corrupts
  every planet position silently).
- Degrees vs. radians: `OBLIQUITY_J2000_DEG` is the ONLY degree-valued export and is
  named accordingly; convert to radians inside `frames.ts` only.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/core-types test` — new `test/systems.test.ts` +
   `test/frames.test.ts`:
   - Compile-time shape checks: valid `SystemsPackManifest` literal typechecks;
     wrong `packFormatVersion`, missing `star`, and mutating readonly fields each
     fail via `// @ts-expect-error`. `SYSTEMS_PACK_FORMAT_VERSION === 1`,
     `BOOKMARKS_SCHEMA_VERSION === 1`.
   - `ECLIPTIC_TO_GALACTIC` is orthonormal: M·Mᵀ = I within 1e-12; det(M) = +1
     within 1e-12.
   - Frame anchor: the north ecliptic pole `[0,0,1]` maps to galactic longitude
     96.4° ± 0.3°, latitude +29.8° ± 0.3° (published value — catches a transposed
     or mis-ordered multiply).
   - `applyMat3` with the identity matrix returns its input; writes into `out` and
     returns the same reference (zero-allocation contract).
2. All existing `core-types` test suites pass unmodified.
3. `pnpm verify` exits 0 (boundary lint: package still imports nothing).

## Deliverables

- `packages/core-types/src/bodies.ts` (additive edits only)
- `packages/core-types/src/systems.ts`, `src/bookmarks.ts`, `src/frames.ts`
- `packages/core-types/src/index.ts` (re-exports only)
- `packages/core-types/test/systems.test.ts`, `test/frames.test.ts`

## Context Files

- `docs/architecture.md` §5.7 (data layer), §5.10 (planet inputs), §5.12 (bookmarks), §11
- `docs/decisions/ADR-001-coordinates.md` (context axes; context-local rule)
- `docs/agent-tasks/TASK-008-pack-stars.md` (the galactic-axis convention + matrix)
- `packages/core-types/src/bodies.ts`, `src/packs.ts`, `src/prng.ts` (style to match)
