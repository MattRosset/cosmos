# Task: `nav` v4 — universe⇄galaxy context switch + local group of procedural galaxies

**ID:** TASK-037
**Status:** done
**Target package:** `packages/nav` (+ a small pure local-group helper)
**Size:** M
**Phase:** 3 — lane (nav / coords integration)
**Depends on:** TASK-031

## Goal

Extend the seamless-zoom mechanism (TASK-027, architecture §5.2, ADR-001) one scale
UP: the `universe` context (unit = 1 Mpc) holding a **local group of procedural
galaxies**, plus the automatic `universe ⇄ galaxy` context switch that mirrors the
existing `galaxy ⇄ system` switch. This completes the M3 zoom chain
(universe → galaxy → system → planet). The `universe` context, its unit
(`CONTEXT_UNIT_METERS.universe = 3.0857e22`), and the four-level frame chain
**already exist** in `coords` (frozen at Phase 0) — this task does NOT add a scale
context; it adds the galaxy ANCHOR plumbing and switch law to `nav`, and a pure
deterministic local-group generator. This is the sanctioned Phase-3 thaw of the
`nav` public API (additions below only); all TASK-005/013/027 behavior is frozen.

## Frozen Interface (additions to @cosmos/nav — existing API unchanged)

```ts
import type { BodyId, ContextId } from '@cosmos/core-types';
// existing from TASK-027: SystemAnchor, ContextSwitchPolicy, ContextSwitchEvent,
// FlightController.{ setSystemAnchor, systemAnchor, contextId, onContextSwitch }

export interface GalaxyAnchor {
  /** Galaxy id, e.g. "proc:milkyway". */
  readonly id: BodyId;
  /** Galaxy center's absolute UNIVERSE-frame position, MEGAPARSECS (f64). */
  readonly positionMpc: readonly [number, number, number];
}

/** Hysteresis for the universe⇄galaxy boundary, METERS (camera↔galaxy center). */
export interface GalaxySwitchPolicy {
  readonly enterGalaxyAtM: number; // default 1.543e21  (≈ 50 kpc)
  readonly exitGalaxyAtM: number;  // default 3.086e21  (≥ 1.5× enter, ctor-checked)
}

export interface FlightController {
  // …all existing TASK-005/013/027 members stay byte-identical…
  /**
   * Set/replace the candidate galaxy anchor. PRECONDITION (documented,
   * dev-asserted): the caller has ALREADY set the frame tree's 'galaxy' anchor to
   * positionMpc-in-universe-units (tree.setAnchor('galaxy', …)) before the camera
   * enters. While context is 'galaxy' or deeper, a call with a DIFFERENT galaxy id
   * is IGNORED until the camera exits back to 'universe'. null clears.
   */
  setGalaxyAnchor(anchor: GalaxyAnchor | null): void;
  readonly galaxyAnchor: GalaxyAnchor | null;
  // onContextSwitch (TASK-027) now also fires for universe↔galaxy switches.
}

export interface FlightControllerOptions {
  // …existing fields stay byte-identical…
  readonly galaxySwitchPolicy?: Partial<GalaxySwitchPolicy>;
}

// ── Pure local-group generator (new module, no Three.js) ─────────────────────
import type { GalaxyRecord } from '@cosmos/core-types';
export interface LocalGroupParams {
  readonly seed: number;
  /** Number of procedural galaxies to place. Default 12. */
  readonly count?: number;
  /** Radius of the local-group volume, MEGAPARSECS. Default 1.5. */
  readonly radiusMpc?: number;
}
/** Deterministic local group: GalaxyRecords placed in universe-frame Mpc by the
 *  seeded PRNG (no Math.random, §5.6). Pure: same params ⇒ identical records,
 *  including each galaxy's `seed` (= hashCombine(seed, index)) for procgen. */
export function generateLocalGroup(params: LocalGroupParams): readonly GalaxyRecord[];
```

## Switch law (fixed — do not redesign; mirrors TASK-027 §"Switch law")

Implemented in `update(dtMs)` AFTER the existing free-flight/goTo integration,
`origin.setCameraPosition`, AND the existing system-switch check (TASK-027), so at
most ONE context switch fires per `update` across BOTH boundaries (assert in dev):

1. No galaxy anchor → universe⇄galaxy switching is inert (existing behavior intact).
2. Measure `dM` = camera↔galaxy-center distance in meters via
   `|origin.toRenderSpace(galaxyUniversePos)| × CONTEXT_UNIT_METERS[origin.context]`
   where `galaxyUniversePos = { context: 'universe', local: anchor.positionMpc }`
   (module-scoped scratch — the only sanctioned cross-context measurement, ADR-001).
3. `context === 'universe'` and `dM < enterGalaxyAtM` → switch to `'galaxy'`:
   `origin.switchContext('galaxy')`; overwrite the controller's internal f64 state
   from `origin.cameraUniverse`; scale velocity by
   `CONTEXT_UNIT_METERS.universe / CONTEXT_UNIT_METERS.galaxy` (Mpc/s → pc/s keeps
   physical speed; speed CAPS stay as configured, same documented asymmetry as
   TASK-027); fire `onContextSwitch({ from:'universe', to:'galaxy', anchorId:anchor.id })`.
4. `context === 'galaxy'` and (`galaxyAnchor === null` or `dM > exitGalaxyAtM`) AND
   the system-switch did not fire this frame → switch back to `'universe'` (mirror;
   velocity × galaxy/universe inverse), `anchorId` = the galaxy anchor at exit.
5. The galaxy switch is only evaluated when `context` is `universe` or `galaxy`
   (never while in `system`/`planet`) — a `setGalaxyAnchor` with a different id while
   deeper than universe is ignored (clause in `setGalaxyAnchor`).
6. Continuity, orientation-untouched, goTo-survives, and zero-positional-discontinuity
   guarantees are identical to TASK-027 — the absolute position
   (`tree.distanceMeters(before, after)`) is < 1 m across the switch frame.

## Inputs / Outputs

- **Inputs:** real `createScaleFrameTree` + `createOriginManager`; galaxy anchor
  `{ id:'proc:milkyway', positionMpc:[0,0,0] }` with
  `tree.setAnchor('galaxy', [0,0,0])`; camera approaching from 0.04 Mpc
  (≈ 1.23e21 m — inside enter ⇒ switches). `generateLocalGroup({ seed: 7 })`.
- **Outputs:** `contextId === 'galaxy'` after entry; `state.position.context ===
  'galaxy'`; physical continuity < 1 m. `generateLocalGroup` → 12 `GalaxyRecord`s
  with finite `positionMpc` inside `radiusMpc` and deterministic per-galaxy `seed`.

## Constraints & Forbidden Actions

- Do not modify `core-types`, `coords`, or `scene-host`. Only the API additions
  above may change `nav`'s public surface (this file is the thaw approval).
- All TASK-005, TASK-013, AND TASK-027 tests pass UNMODIFIED — break one ⇒ `blocked`.
- The controller NEVER calls `tree.setAnchor` (the glue owns the tree; precondition
  documented + dev-asserted, skipped in production builds — same as TASK-027).
- No allocations in `update()` on any path including switch frames (the
  `onContextSwitch` payload is the one sanctioned allocation, switches are rare —
  document it like TASK-027 / coords' RebaseEvent).
- Constructor throws `RangeError` if `exitGalaxyAtM < 1.5 × enterGalaxyAtM`
  (hysteresis floor, §5.8).
- `generateLocalGroup`: NO `Math.random()` — `createPrng`/`hashCombine` only;
  pure, no Three.js, no DOM. It lives in `nav` only because nav owns the
  galaxy-anchor concept; if review prefers it in `procgen`, set `blocked` and report
  (do not move it unilaterally).
- No new dependencies.

## Common Mistakes (architecture §5.2, §5.3 + ADR-001 — copy kept verbatim)

- Storing absolute positions in f32 anywhere (including GPU buffers — star buffers
  must be context-local) — galaxy anchors stay f64 `UniversePosition`s.
- Rebasing mid-frame (do it at frame start, atomically) — the switch happens at the
  END of update, exactly once, atomically.
- Trying "one global double-precision world" — the context hierarchy avoids it; this
  task just adds the top boundary of that hierarchy.
- Forgetting velocity/orientation also need rebasing — velocity scales by the unit
  ratio (Mpc↔pc here); orientation is untouched (axes identical across contexts).
- Plus: allowing two switches in one update (universe→galaxy AND galaxy→system) —
  guard so at most one fires per `update`, evaluating system first (TASK-027) then
  galaxy only if no switch yet.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/nav test` — new `test/galaxy-switch.test.ts` against real
   `coords` (simulated 16.67 ms frames):
   - **Enter:** approach from 0.04 Mpc toward an anchored galaxy at universe origin;
     the switch fires exactly once at a frame where `dM < 1.543e21`;
     `contextId === 'galaxy'`; event payload `{from:'universe',to:'galaxy',
     anchorId:'proc:milkyway'}`.
   - **Continuity:** `tree.distanceMeters(before, after)` < 1 m; orientation
     quaternion bit-identical; reported speed (m/s) continuous within 1e-6 relative.
   - **Hysteresis:** oscillate across the enter threshold → exactly ONE switch until
     `exitGalaxyAtM` crossed; fly out past 3.086e21 → exactly one exit.
   - **Velocity scaling:** known velocity in Mpc/s before entry → after entry the
     pc/s velocity equals it × (Mpc/pc) within 1e-9 relative.
   - **At most one switch/update:** a frame where the camera crosses BOTH the galaxy
     enter and (impossibly) the system enter cannot fire two switches — assert the
     guard with a constructed scenario.
   - **Anchor swap guard:** while in 'galaxy', `setGalaxyAnchor` with a different id
     is ignored; after exit to 'universe' the same call applies.
   - Constructor `RangeError` on bad hysteresis; defaults exact (1.543e21/3.086e21).
   - `update()` allocation-free on non-switch AND switch frames (event payload
     exempt).
   - All TASK-005 + TASK-013 + TASK-027 suites green, unmodified.
2. `test/local-group.test.ts`: `generateLocalGroup({seed:7})` deterministic
   (deep-equal across two calls; different seed differs); `count` records inside
   `radiusMpc`; each `GalaxyRecord` has finite `positionMpc`/`radiusKpc` and a
   `seed === hashCombine(7, index)`; no `Math.random` (source scan).
3. **Coverage gate:** unchanged (do not lower thresholds).
4. `pnpm verify` exits 0.

## Deliverables

- `packages/nav/src/controller.ts` (galaxy-switch law in update),
  `src/galaxy-switch.ts` (policy + pure threshold helpers, mirrors
  `context-switch.ts`), `src/local-group.ts` (`generateLocalGroup`),
  `src/index.ts` (export additions)
- `packages/nav/test/galaxy-switch.test.ts`, `test/local-group.test.ts`
- `packages/nav/README.md` (universe⇄galaxy anchor precondition + glue contract;
  keep < 150 lines)

## Context Files

- `docs/architecture.md` §5.2 (scale contexts), §5.3 (whole), §5.8 (hysteresis), §9
- `docs/decisions/ADR-001-coordinates.md` §1–§4 (the four contexts + switching +
  velocity rebase)
- `packages/coords/src/origin.ts` + `src/frame-tree.ts` (`switchContext`,
  `setAnchor`, `distanceMeters`, `convert` — read the source; the full 4-level
  chain already exists)
- `packages/nav/src/controller.ts`, `src/context-switch.ts`,
  `test/context-switch.test.ts` (TASK-027 — mirror exactly one level up)
- `packages/core-types/src/coords.ts` (`CONTEXT_UNIT_METERS`), `src/bodies.ts`
  (`GalaxyRecord`), `src/prng.ts`
