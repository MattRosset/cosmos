# Task: `scene-host` v1.1 — pluggable epoch provider for `FrameContext`

**ID:** TASK-028
**Target package:** `packages/scene-host`
**Size:** S
**Phase:** 2 — lane M (host)
**Depends on:** TASK-018

## Goal

Replace the Phase-0 J2000 stub in `FrameContext.epochJD` with an injectable epoch
provider, so the M2 glue can advance the `sim-time` clock exactly once per frame
and publish the resulting epoch to every frame subscriber (architecture §5.4:
"Emits epoch per frame" via `FrameContext`, §5.1 outputs). This is the sanctioned,
minimal Phase-2 thaw of the `scene-host` public API — one optional prop, nothing
else. `scene-host` must NOT import `sim-time` (the provider is a plain function;
the host stays agnostic, §4 glue rules).

## Frozen Interface (additions — existing API unchanged)

```ts
// frame-loop.ts
/**
 * Called exactly once per frame, BEFORE all subscribers (at
 * PRIORITY_FRAME_CONTEXT), with the CLAMPED wall delta (≤ MAX_DT_MS).
 * Return value becomes FrameContext.epochJD for this frame.
 * Typical app wiring: (dtMs) => { clock.advance(dtMs); return clock.epochJD; }
 */
export type EpochProvider = (dtMs: number) => number;

export function updateSharedFrameContext(
  camera: THREE.PerspectiveCamera,
  deltaSec: number,
  epochProvider?: EpochProvider | null,   // new optional parameter
): void;

// SceneHost.tsx — new optional prop
export interface SceneHostProps {
  // …existing props stay byte-identical…
  /** Epoch source for FrameContext.epochJD. Absent ⇒ J2000 stub (Phase 0/1
   *  behavior, bit-identical). MUST be referentially stable or wrapped by the
   *  caller — changing it does not remount the canvas. */
  readonly epochProvider?: EpochProvider;
}
```

Behavior: `mutableFrameContext.epochJD = epochProvider ? epochProvider(clampedDtMs)
: J2000_EPOCH_JD`. The provider receives the SAME clamped `dtMs` that lands in
`FrameContext.dtMs` (one clamp, one source of truth). A provider returning a
non-finite number: keep the PREVIOUS frame's epoch and `console.warn` once per
session (a broken clock must not propagate NaN into every shader uniform).

## Inputs / Outputs

- **Inputs:** a test provider `(dt) => { calls.push(dt); return 2_460_000 + n; }`.
- **Outputs:** every subscriber (all priorities) observes `ctx.epochJD` equal to
  the provider's return for that frame; provider call count === frame count.

## Constraints & Forbidden Actions

- Do not modify `core-types`, `nav`, `coords`, or any render package. Only the
  addition above may change `scene-host`'s public surface (this file is the thaw
  approval).
- `scene-host` must not import `@cosmos/sim-time` (provider is structural).
- No per-frame allocations: the provider call replaces the constant assignment —
  nothing else in the frame path changes.
- All TASK-004/TASK-006-era scene-host tests pass UNMODIFIED (no-provider path is
  bit-identical, including the exported `J2000_EPOCH_JD` constant).
- Prop changes must not remount or re-render the Canvas subtree (store the
  provider in a ref, read it inside the frame callback — §5.1 canvas isolation).

## Common Mistakes (architecture §5.1, §5.4 — copy kept verbatim)

- Letting React re-render the Canvas subtree on UI state changes — passing a new
  provider closure each render must not churn the frame loop; the ref pattern is
  mandatory, and the test asserts zero Canvas re-renders on provider identity
  change.
- Coupling time stepping to frame rate without clamping dt — the provider
  receives the clamped delta; do NOT hand it the raw `deltaSec`.
- Plus: calling the provider more than once per frame (subscribers must all see
  one consistent epoch); letting a NaN return poison `FrameContext`.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/scene-host test` — extended frame-loop/host suites
   (@react-three/test-renderer):
   - Provider receives the clamped dt (feed `deltaSec = 5` → provider sees 100).
   - `ctx.epochJD` equals the provider return for subscribers at PRIORITY_NAV
     and PRIORITY_RENDER in the same frame; called exactly once per frame.
   - No provider ⇒ `epochJD === J2000_EPOCH_JD` (existing assertion still green).
   - Non-finite return ⇒ previous epoch retained + one warn (spy).
   - Swapping the `epochProvider` prop identity mid-run: next frame uses the new
     provider; zero Canvas re-renders (existing isolation test pattern).
   - All existing scene-host suites green, unmodified.
2. **Coverage gate:** unchanged (do not lower thresholds).
3. `pnpm verify` exits 0.

## Deliverables

- `packages/scene-host/src/frame-loop.ts` (provider parameter),
  `src/SceneHost.tsx` (prop + ref plumbing), `src/index.ts` (type export)
- `packages/scene-host/test/` (extended specs)
- `packages/scene-host/README.md` (provider contract documented)

## Context Files

- `docs/architecture.md` §5.1 (FrameContext outputs), §5.4 (epoch per frame)
- `packages/scene-host/src/frame-loop.ts`, `src/SceneHost.tsx` (current stub)
- `docs/agent-tasks/TASK-019-sim-time.md` (the clock this will carry — constants
  MAX_DT_MS must agree)
