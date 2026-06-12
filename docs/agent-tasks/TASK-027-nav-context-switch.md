# Task: `nav` v3 — automatic galaxy⇄system context switching

**ID:** TASK-027
**Target package:** `packages/nav`
**Size:** M — context switching is integration-heavy: assign to the strongest
agent/human pair (§8.3)
**Phase:** 2 — lane L (nav)
**Depends on:** TASK-018

## Goal

The seamless-zoom mechanism that defines M2 (architecture §5.3, §6 Phase 2,
ADR-001 §4): when the camera approaches the anchored star system, the controller
switches the active scale context `galaxy → system` (and back on leaving), with
hysteresis, with velocity re-scaled to the new unit, with any in-flight `goTo`
surviving the switch, and with **zero positional discontinuity** — the camera's
absolute position in space is identical before and after (that is what
`origin.switchContext` guarantees; nav's job is to keep its own f64 state and
velocity consistent and to tell the world). This is the sanctioned Phase-2 thaw of
the `nav` public API (additions below only); TASK-005/TASK-013 behavior is frozen.

## Frozen Interface (additions to @cosmos/nav — existing API unchanged)

```ts
import type { BodyId, ContextId } from '@cosmos/core-types';

export interface SystemAnchor {
  /** System id, e.g. "sol" or "exo:trappist-1". */
  readonly id: BodyId;
  /** Host star's absolute galaxy-frame position, parsecs (f64). */
  readonly positionPc: readonly [number, number, number];
}

/** Hysteresis thresholds, METERS (camera ↔ host star distance). */
export interface ContextSwitchPolicy {
  readonly enterSystemAtM: number; // default 7.5e14  (≈ 5,000 AU)
  readonly exitSystemAtM: number;  // default 1.5e15  (≥ 1.5× enter, lint by ctor)
}

export interface ContextSwitchEvent {
  readonly from: ContextId;
  readonly to: ContextId;
  readonly anchorId: BodyId | null;
}

export interface FlightController {
  // …existing members from TASK-005/TASK-013 stay byte-identical…
  /**
   * Set/replace the candidate system anchor. PRECONDITION (documented, asserted
   * in dev): the caller has ALREADY set the frame tree's 'system' anchor to
   * positionPc (tree.setAnchor) — the controller never touches the tree.
   * While context === 'system', a call with a DIFFERENT anchor id is IGNORED
   * (recorded as pending nothing — the glue must wait for exit). null clears.
   */
  setSystemAnchor(anchor: SystemAnchor | null): void;
  readonly systemAnchor: SystemAnchor | null;
  /** Mirrors origin.context. */
  readonly contextId: ContextId;
  /** Fires AFTER a completed switch, same frame. Returns unsubscribe. */
  onContextSwitch(cb: (e: ContextSwitchEvent) => void): () => void;
}

export interface FlightControllerOptions {
  // …existing fields stay byte-identical…
  readonly contextSwitchPolicy?: Partial<ContextSwitchPolicy>;
}
```

## Switch law (fixed — do not redesign)

Inside `update(dtMs)`, AFTER the existing free-flight/goTo integration and AFTER
`origin.setCameraPosition` (i.e., the camera's new position is final for this
frame):

1. No anchor set → nothing happens (Phase 1 behavior, bit-identical).
2. Measure `dM` = camera↔anchor distance in meters via
   `|origin.toRenderSpace(anchorUniversePos)| × CONTEXT_UNIT_METERS[origin.context]`
   where `anchorUniversePos = { context: 'galaxy', local: anchor.positionPc }`
   (module-scoped scratch — the only sanctioned cross-context measurement,
   ADR-001; never subtract raw locals).
3. `context === 'galaxy'` and `dM < enterSystemAtM` → switch to `'system'`:
   - `origin.switchContext('system')` (converts camera + origin via the tree
     anchor the glue set).
   - Overwrite the controller's internal f64 position state from
     `origin.cameraUniverse` (now system-context units).
   - Scale velocity: `v *= CONTEXT_UNIT_METERS.galaxy / CONTEXT_UNIT_METERS.system`
     (pc/s → AU/s keeps the same physical speed). Same for any internal
     speed caps expressed in units/s? NO — caps stay as configured (they are
     context-agnostic limits in units/s by design; document this asymmetry).
   - Fire `onContextSwitch({ from: 'galaxy', to: 'system', anchorId: anchor.id })`.
4. `context === 'system'` and (`anchor === null` or `dM > exitSystemAtM`) →
   switch back to `'galaxy'`, mirror image of step 3 (velocity × AU/pc ratio
   inverse), `anchorId` = the anchor at time of exit (or null).
5. At most ONE switch per `update` call (enter and exit cannot both fire — the
   hysteresis gap guarantees it; assert in dev).
6. In-flight `goTo` is NOT cancelled by a switch: TASK-013's motion law already
   measures distance via `toRenderSpace`, which is context-correct; the goTo
   target keeps its own `UniversePosition`. Add no special-casing — but TEST it.
7. `FlightState.position` reported after a switch frame is in the NEW context
   (consumers read `position.context`).

## Inputs / Outputs

- **Inputs:** real `createScaleFrameTree` + `createOriginManager` (no mocks);
  anchor Sol `{ id: 'sol', positionPc: [0, 0, 0] }` with
  `tree.setAnchor('system', [0, 0, 0])`; camera approaching from 0.01 pc
  (≈ 3.1e14 m — inside enter threshold ⇒ switches on first update).
- **Outputs:** `contextId === 'system'`; `state.position.context === 'system'`;
  physical position continuous: `tree.distanceMeters(posBefore, posAfter)` < 1 m.

## Constraints & Forbidden Actions

- Do not modify `core-types`, `coords`, or `scene-host`. Only the API additions
  above may change `nav`'s public surface (this file is the thaw approval).
- All TASK-005 AND TASK-013 tests pass UNMODIFIED — break one ⇒ `blocked`.
- The controller NEVER calls `tree.setAnchor` (the glue owns the tree; the
  precondition is documented + dev-asserted via a cheap distance check between
  `toRenderSpace(anchorUniversePos)` in galaxy vs converted system position —
  skip the assert in production builds).
- No allocations in `update()` on any path, including switch frames (event
  payload objects for `onContextSwitch` are the one sanctioned allocation —
  switches are rare by construction; document it like coords' RebaseEvent).
- Constructor throws `RangeError` if `exitSystemAtM < 1.5 × enterSystemAtM`
  (hysteresis floor — LOD-popping doctrine §5.8 applied to contexts).
- No `Math.random()`; no new dependencies.

## Common Mistakes (architecture §5.3 + ADR-001 — copy kept verbatim)

- Go-to animations in absolute coordinates breaking across context switches —
  animate in *target's* frame (already true via TASK-013; the new test pins it
  across a REAL switch now).
- Gimbal lock from Euler accumulation — orientation is untouched by a switch
  (axes are identical across contexts — only the unit changes; do NOT rotate
  the quaternion).
- Forgetting velocity/orientation also need rebasing (ADR-001 §3) — velocity
  scales by the unit ratio; forgetting it makes the camera leap at ~206,265×
  speed after entering a system.
- Rebasing mid-frame — the switch happens at the END of update, after
  setCameraPosition, exactly once, atomically; toRenderSpace callers within the
  same frame after update() see a consistent origin.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/nav test` — new `test/context-switch.test.ts` against
   real `coords` (simulated 16.67 ms frames):
   - **Enter:** approach from 0.05 pc toward an anchored Sol; the switch fires
     exactly once, at a frame where `dM < 7.5e14`; `contextId === 'system'`;
     event payload exact.
   - **Continuity:** physical position before/after the switch frame differs by
     < 1 m (`tree.distanceMeters`); orientation quaternion bit-identical;
     reported speed in m/s (units/s × unit meters) continuous within 1e-6
     relative.
   - **Hysteresis:** oscillate the camera across the enter threshold
     (in to 7e14 m, out to 9e14 m, repeatedly) → exactly ONE switch (no flapping
     until 1.5e15 m crossed); then fly out past 1.5e15 → exactly one exit.
   - **Velocity scaling:** set a known velocity in pc/s before entry; after
     entry, velocity in AU/s equals it × (pc/AU) within 1e-9 relative.
   - **goTo across switch:** target a planet-distance point past the threshold
     (`goTo` from 0.1 pc to arrival 1e10 m); flight enters the system mid-flight,
     arrival succeeds, distance series monotonic after the first 25% of frames,
     no per-frame step > 2× neighboring deltas at the switch frame.
   - **Anchor swap guard:** while in 'system', `setSystemAnchor` with a different
     id is ignored (`systemAnchor` unchanged); after exit, the same call applies.
   - **No anchor ⇒ exit:** clearing the anchor while inside exits next update.
   - Constructor `RangeError` on bad hysteresis; defaults exact (7.5e14/1.5e15).
   - `update()` allocation-free during a non-switch frame AND a switch frame
     (event payload exempted, same-identity scratch checks for everything else).
   - All TASK-005 + TASK-013 suites green, unmodified.
2. **Coverage gate:** unchanged (do not lower thresholds).
3. `pnpm verify` exits 0.

## Deliverables

- `packages/nav/src/controller.ts` (switch law in update), `src/context-switch.ts`
  (policy + pure threshold helpers), `src/index.ts` (export additions)
- `packages/nav/test/context-switch.test.ts`
- `packages/nav/README.md` (anchor precondition + glue contract documented;
  keep < 150 lines)

## Context Files

- `docs/architecture.md` §5.3 (whole section), §5.8 (hysteresis doctrine), §9
- `docs/decisions/ADR-001-coordinates.md` §3–§4 (switching + velocity rebase)
- `packages/coords/src/origin.ts` (switchContext semantics — read the source),
  `packages/coords/src/frame-tree.ts` (`setAnchor`, `distanceMeters`)
- `packages/nav/src/controller.ts`, `test/goto.test.ts` (state layout + test
  patterns to extend)
- `packages/core-types/src/coords.ts` (`CONTEXT_UNIT_METERS`)
