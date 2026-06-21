# Task: `core-types` Phase-4 thaw — atmosphere, nebula, overlay, tour, cinematic types

**ID:** TASK-042
**Target package:** `packages/core-types`
**Size:** S
**Phase:** 4 (Phase 4a)
**Depends on:** TASK-041

## Goal

The one sanctioned Phase-3→4 API thaw (architecture §16) for `core-types`: add every
data contract the Phase-4a lanes build against, and nothing else. Per architecture §7
("never build a renderer before its data contract exists in `core-types`") this task
unblocks all Phase-4a lanes and must land first. It adds five new type modules:
`atmosphere.ts` (atmospheric-scattering params, ADR-005), `nebula.ts` (nebula billboard
params, §5.11), `overlay.ts` (constellation line sets + label records, §5.12), `tour.ts`
(guided-tour steps, §5.12), and `cinematic.ts` (camera spline / cinematic path, §5.3/§5.12).
After it merges, `core-types` is frozen again until the Phase-4b (terrain) thaw.

**This task may not begin until TASK-041 is `done`** (it is — the Phase 3 gate froze the
Phase 3 surfaces; this is the next sanctioned change window).

**There is NO Gaia type.** The Gaia DR3 subset reuses the frozen ADR-003 octree format
verbatim (ADR-006 §4: "adds no new tile format"); the only Gaia-specific data lives in
`tools/pack-octree` (TASK-043) and the pack itself. Do **not** add a Gaia tile type,
`source_id` type, or coverage type here. (The streaming coverage signal in TASK-044 is a
`streaming` API addition, not a core-type.) This mirrors TASK-031's "no `universe.ts`".

## Frozen Interface

```ts
// ── src/atmosphere.ts (new) — ADR-005 ────────────────────────────────────────
/** ADR-005 §4: O'Neil analytic single-scattering params. Every field optional ⇒
 *  default applied from ATMOSPHERE_DEFAULTS. */
export interface AtmosphereParams {
  /** Shell outer radius as a multiple of the planet radius (> 1). */
  readonly atmosphereRadiusScale?: number;
  /** Rayleigh scattering coefficient, per-channel LINEAR RGB. */
  readonly betaRayleigh?: readonly [number, number, number];
  readonly betaMie?: number;
  /** Fraction of shell thickness (O'Neil fScaleDepth). */
  readonly rayleighScaleHeight?: number;
  /** Mie phase asymmetry g (forward-scattering ⇒ negative). */
  readonly mieG?: number;
  readonly sunIntensity?: number;
}
/** ADR-005 §3 fixed Earth-like default table (single source of truth). */
export const ATMOSPHERE_DEFAULTS: Required<AtmosphereParams>;

// ── src/nebula.ts (new) — §5.11 ──────────────────────────────────────────────
/** One camera-facing layered-noise billboard (§5.11 "billboard volumetric-look").
 *  Positions/radii are CONTEXT UNITS relative to the field origin. */
export interface NebulaLayer {
  /** Billboard center, context units relative to NebulaField.originPc. */
  readonly centerUnits: readonly [number, number, number];
  /** Billboard radius, context units. */
  readonly radiusUnits: number;
  /** Tint, LINEAR RGB in [0,1]. */
  readonly colorLinear: readonly [number, number, number];
  /** Per-layer opacity scalar in [0,1] (overdraw control, §5.11). */
  readonly opacity: number;
  /** Noise seed for the layer's fragment pattern (deterministic, §8.6). */
  readonly seed: number;
}
export interface NebulaField {
  readonly id: string;
  /** Field origin, galaxy-context parsecs, f64. */
  readonly originPc: readonly [number, number, number];
  readonly layers: readonly NebulaLayer[];
}
/** §5.11 overdraw cap — renderers must not exceed this layer count per field. */
export const MAX_NEBULA_LAYERS = 32;

// ── src/overlay.ts (new) — §5.12 ─────────────────────────────────────────────
/** A constellation as line segments between catalog stars, keyed by HIP number.
 *  Endpoints are resolved to positions by `data` (TASK-046), not stored here. */
export interface ConstellationLineSet {
  /** IAU 3-letter code, e.g. "Ori". */
  readonly code: string;
  readonly name: string;
  /** Flat list of HIP-number pairs; segment k connects hipPairs[2k]→hipPairs[2k+1]. */
  readonly hipPairs: readonly number[];
}
/** A screen-space label anchored to a body (the app projects worldPc→screen). */
export interface LabelRecord {
  readonly id: BodyId;
  readonly text: string;
  /** Absolute position, galaxy-context parsecs, f64 (the app projects it). */
  readonly positionPc: readonly [number, number, number];
  /** Lower = more important; the UI shows the most important that fit (§5.12). */
  readonly priority: number;
}

// ── src/tour.ts (new) — §5.12 ────────────────────────────────────────────────
/** One stop in a guided tour. The target is a body the camera flies to; narration
 *  is shown in the tour chrome (TASK-050) while dwelling. */
export interface TourStep {
  readonly targetId: BodyId;
  /** Heading shown in the tour card. */
  readonly title: string;
  /** Educational body text (plain string; no HTML). */
  readonly narration: string;
  /** Dwell time at the target after arrival, ms. */
  readonly dwellMs: number;
  /** Optional: auto-orbit the target during the dwell (TASK-051). */
  readonly orbit?: boolean;
}
export interface Tour {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly TourStep[];
}

// ── src/cinematic.ts (new) — §5.3 / §5.12 ────────────────────────────────────
/** A keyframe on a camera spline. Position is a UniversePosition so the path
 *  survives context switches (animate in the target frame, §5.3). */
export interface CameraKeyframe {
  readonly at: UniversePosition;
  /** Look-at target, same context as `at`. */
  readonly lookAt: UniversePosition;
  /** Arrival time along the path, ms from path start (monotonic increasing). */
  readonly timeMs: number;
}
/** A Catmull-Rom camera spline played back by `nav` v5 (TASK-051). */
export interface CameraSpline {
  readonly id: string;
  readonly keyframes: readonly CameraKeyframe[];
  /** Letterbox the viewport during playback (cinematic chrome, §5.12). */
  readonly letterbox?: boolean;
}
```

`src/atmosphere.ts` and `src/nebula.ts` import nothing. `src/overlay.ts` and
`src/tour.ts` import `BodyId` from `./bodies`. `src/cinematic.ts` imports
`UniversePosition` from `./coords`. `src/index.ts` re-exports all five new modules
(extend the existing re-export list — add five lines).

## Inputs / Outputs

- **Inputs:** none (zero-dependency package by definition, §4).
- **Outputs:** types + constants. Example atmosphere params (Earth, all defaults):
  `{}` ⇒ resolves to `ATMOSPHERE_DEFAULTS`. Example nebula layer:
  `{ centerUnits:[120,40,-10], radiusUnits:300, colorLinear:[0.4,0.2,0.5], opacity:0.3, seed:7 }`.
  Example constellation: `{ code:'Ori', name:'Orion', hipPairs:[27989,26727, 26727,25336] }`.
  Example tour step: `{ targetId:'sol', title:'Our Star', narration:'…', dwellMs:6000 }`.

## Constraints & Forbidden Actions

- Do not modify any existing `src/*.ts` except `src/index.ts` (re-exports only).
  In particular `bodies.ts`, `coords.ts`, `batches.ts`, `packs.ts`, `orbits.ts`,
  `systems.ts`, `bookmarks.ts`, `frames.ts`, `prng.ts`, `events.ts`, `octree.ts`,
  `procgen.ts`, `streaming.ts`, `quality.ts`, and `worker-rpc.ts` stay byte-identical;
  all existing tests pass unmodified.
- **No new events** in `events.ts`. Overlay/tour/cinematic state lives in `app-state`
  stores (TASK-049), not as a `CosmosEventMap` entry. Adding a `CosmosEventMap` key is a
  separate reviewed task.
- **No Gaia / octree / coverage types** (see Goal). Do not touch `octree.ts`.
- Zero dependencies; no Zod here (validation is pack-build-time in `tools/`, §5.7).
- Plain `readonly` interfaces; no classes; `atmosphere.ts` and `nebula.ts` carry only
  the const default table / cap (like `quality.ts` carries `QUALITY_TIERS`) — no code.
- Do not add speculative fields (terrain heightfields, WebGPU types, multi-scattering
  LUTs — out of Phase-4a scope; terrain is Phase-4b).

## Common Mistakes (architecture §5.2, §5.11, §5.12, §16)

- Storing absolute positions in f32 anywhere — nebula/label positions are f64 (`*Pc`)
  and per ADR-001 are converted to camera-relative f32 only at render time by the app.
- Mixing units — keep units in names (`radiusUnits`, `*Pc`, `*Scale`, `*Ms`).
- Re-thawing frozen modules — this is an *additive* thaw: only new files + `index.ts`.
- Putting overlay/tour state in the event map — it is store state (TASK-049), not events.
- Adding a Gaia type "for symmetry" — Gaia is format-identical to the existing octree
  (ADR-006 §4); a new type would fork the frozen loader.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/core-types test` — new `test/atmosphere.test.ts`,
   `test/nebula.test.ts`, `test/overlay.test.ts`, `test/tour.test.ts`,
   `test/cinematic.test.ts`:
   - `ATMOSPHERE_DEFAULTS` exact values match ADR-005 §3 (assert each field, incl. the
     three `betaRayleigh` channels and `mieG === -0.758`).
   - `MAX_NEBULA_LAYERS === 32`.
   - Compile-time shape checks (`// @ts-expect-error`): mutating any `readonly` field
     fails; a `NebulaField` missing `layers` fails; a `CameraKeyframe` whose `at` is a
     bare tuple (not a `UniversePosition`) fails; `ConstellationLineSet.hipPairs`
     accepts `number[]` but not `string[]`.
   - Type round-trips: a `Tour` literal with two `TourStep`s type-checks; an
     `AtmosphereParams` with only `betaRayleigh` set type-checks (others optional).
2. All existing `core-types` test suites pass unmodified.
3. `pnpm verify` exits 0 (boundary lint: package still imports nothing).

## Deliverables

- `packages/core-types/src/atmosphere.ts`, `src/nebula.ts`, `src/overlay.ts`,
  `src/tour.ts`, `src/cinematic.ts`
- `packages/core-types/src/index.ts` (re-exports only — five new lines)
- `packages/core-types/test/atmosphere.test.ts`, `test/nebula.test.ts`,
  `test/overlay.test.ts`, `test/tour.test.ts`, `test/cinematic.test.ts`

## Context Files

- `docs/decisions/ADR-005-atmospheric-scattering.md` (§3/§4 — the params + defaults to
  transcribe), `docs/decisions/ADR-006-gaia-subset-tier-unification.md` (§4 — why no
  Gaia type)
- `docs/architecture.md` §5.11 (nebulae), §5.12 (overlays/tours/labels), §5.3
  (cinematic camera), §16 (thaw window)
- `packages/core-types/src/index.ts` (the re-export list to extend),
  `src/quality.ts` (const-table module style to match), `src/bodies.ts`
  (`BodyId`), `src/coords.ts` (`UniversePosition`)
- `docs/agent-tasks/TASK-031-core-types-phase3-thaw.md` (the additive-thaw pattern to
  mirror, incl. the "no new module X" precedent)
