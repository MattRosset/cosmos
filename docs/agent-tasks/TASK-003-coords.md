# Task: `coords` — scale-frame tree + floating origin

**ID:** TASK-003
**Target package:** `packages/coords` (new)
**Size:** L — ⚠️ **critical path** (architecture §5.2, ADR-001)
**Phase:** 0
**Depends on:** TASK-002

## Goal

A pure-math package implementing the coordinate architecture of ADR-001: f64 conversions
between scale contexts, and an origin manager that produces camera-relative, f32-safe
render positions with atomic frame-start rebasing. Every `render-*` package and `nav`
will sit on top of this API; it freezes at the end of Phase 0 (TASK-006).

This is the highest-risk package in the project ("wrong, discovered late → Fatal",
architecture §14). Do not improvise beyond the spec; if something is underspecified,
set the task to `blocked` and report.

## Frozen Interface

```ts
// public API of @cosmos/coords (src/index.ts re-exports exactly this)
import type { ContextId, UniversePosition } from '@cosmos/core-types';

export type Vec3Tuple = [number, number, number];

/**
 * The context hierarchy with f64 anchors. Fixed parent chain (ADR-001):
 * planet → system → galaxy → universe. Anchors default to the parent origin.
 */
export interface ScaleFrameTree {
  /** Set where `context`'s origin sits, expressed in its PARENT's units (f64). */
  setAnchor(context: Exclude<ContextId, 'universe'>, parentLocalUnits: Vec3Tuple): void;
  getAnchor(context: Exclude<ContextId, 'universe'>): Vec3Tuple;
  /** Pure f64 conversion. Round-trips must lose < 1e-6 relative error (§5.2). */
  convert(pos: UniversePosition, target: ContextId): UniversePosition;
  /** Distance in METERS, routed through the common ancestor frame — the only
   *  sanctioned way to compare positions across contexts (ADR-001 §Consequences). */
  distanceMeters(a: UniversePosition, b: UniversePosition): number;
}

export function createScaleFrameTree(): ScaleFrameTree;

export interface RebaseEvent {
  readonly context: ContextId;
  /** Offset subtracted from all root render groups, in context units (f64). */
  readonly offsetUnits: Vec3Tuple;
}

export interface OriginManager {
  readonly context: ContextId;
  /** Camera's absolute position (f64) in the current context. */
  readonly cameraUniverse: UniversePosition;
  /**
   * Update the camera's absolute position. MUST be called exactly once per frame,
   * at frame start. Returns a RebaseEvent when |cameraLocal| exceeded
   * REBASE_THRESHOLD_UNITS (core-types) and the origin was rebased; null otherwise.
   * Rebasing is atomic: all subsequent toRenderSpace calls this frame use the new origin.
   */
  setCameraPosition(pos: UniversePosition): RebaseEvent | null;
  /** Switch the active context (converts the camera + origin into the target frame). */
  switchContext(target: ContextId): void;
  /**
   * Camera-relative position, safe to downcast to f32/GPU. Writes into `out`
   * (zero allocation in frame paths, §9) and returns it.
   */
  toRenderSpace(pos: UniversePosition, out: Vec3Tuple): Vec3Tuple;
}

export function createOriginManager(
  tree: ScaleFrameTree,
  initialCamera: UniversePosition,
): OriginManager;
```

Notes pinned by the architecture (not negotiable):

- All internal math is f64 (plain JS numbers). f32 appears nowhere in this package —
  the *caller* downcasts `toRenderSpace` output. Positions must remain accurate enough
  that the downcast is sub-pixel-stable (the TASK-006 jitter gate measures this).
- Subtraction happens in f64 *before* any downcast: `render = bodyLocal - cameraLocal`.
- Unit ratios between contexts come from `CONTEXT_UNIT_METERS` (core-types).

## Inputs / Outputs

- **Inputs:** `UniversePosition` values, e.g. planet 8 kpc from galactic center in the
  galaxy frame: `{ context: 'galaxy', local: [8000, 0, 0] }`; camera 1 AU away in the
  same frame: `{ context: 'galaxy', local: [8000 + 4.84813681e-6, 0, 0] }`.
- **Outputs:** camera-relative tuples; for the example above, `toRenderSpace(planet)`
  ≈ `[-4.84813681e-6, 0, 0]` galaxy units — small numbers near the camera, by design.

## Constraints & Forbidden Actions

- Do not modify `packages/core-types` (its API froze in TASK-002).
- **No Three.js, no React, no DOM** — lint-enforced pure package (a thin `Vector3`
  adapter lands in scene-host, not here).
- No allocations in `toRenderSpace`/`setCameraPosition` (the `out` parameter exists
  for this; scratch arrays module-scoped).
- Do not implement context *auto*-switching heuristics (camera-proximity triggers are
  `nav`'s job in Phase 2 — here only the mechanical `switchContext`).
- Allowed dependencies: `@cosmos/core-types` (workspace), `@vitest/coverage-v8`
  (root devDependency, for the coverage gate). Nothing else.

## Common Mistakes (architecture §5.2 — copy kept verbatim)

- Storing absolute positions in f32 anywhere (including GPU buffers — star buffers must
  be context-local).
- Rebasing mid-frame (do it at frame start, atomically).
- Trying "one global double-precision world" with emulated f64 in shaders — unnecessary
  complexity; the context hierarchy avoids it.
- Forgetting velocity/orientation also need rebasing. (v1 API carries position only;
  the RebaseEvent payload is what `nav` uses to patch velocity — make sure the event
  fires with the exact applied offset.)

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/coords test` — unit + property tests:
   - Round-trip `convert` across every context pair loses < 1e-6 relative error
     (property-based over random positions/anchors, ≥ 1000 cases, seeded PRNG from
     core-types — not `Math.random()`).
   - `distanceMeters` is symmetric, zero for identical positions, and matches a
     hand-computed cross-context fixture (galaxy↔system) to < 1e-6 relative.
   - Rebase fires exactly when `|cameraLocal| > REBASE_THRESHOLD_UNITS`, the returned
     `offsetUnits` equals the applied shift, and `toRenderSpace` results are identical
     (< 1e-9 units) immediately before vs. after a rebase.
   - `switchContext` preserves the camera's physical location (< 1e-6 m drift).
   - `toRenderSpace` performs zero allocations (assert via reuse of `out` identity).
2. **Coverage gate:** statement coverage ≥ 90% on `packages/coords/src` (vitest
   `coverage.thresholds` in the package's `vitest.config.ts` — CI fails below).
3. `pnpm verify` exits 0 at repo root.

## Deliverables

- `packages/coords/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/coords/src/frame-tree.ts`, `src/origin.ts`, `src/index.ts`
- `packages/coords/test/frame-tree.test.ts`, `test/origin.test.ts`
- `packages/coords/README.md` (< 150 lines: purpose, API, invariants — §8.5)
- Root `package.json`: add `@vitest/coverage-v8` devDependency (only line allowed there)

## Context Files

- `docs/decisions/ADR-001-coordinates.md` — the binding spec
- `docs/architecture.md` §5.2 (whole section), §9 (frame-loop rules)
- `packages/core-types/src/coords.ts` (`ContextId`, `UniversePosition`,
  `CONTEXT_UNIT_METERS`, `REBASE_THRESHOLD_UNITS`)
- `packages/core-types/src/prng.ts` (for property-test data generation)
