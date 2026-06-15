# Task: `scene-host` v1.2 — PerformanceMonitor-driven adaptive quality tiers

**ID:** TASK-039
**Target package:** `packages/scene-host`
**Size:** S
**Phase:** 3 — lane (scene-host)
**Depends on:** TASK-031

## Goal

The adaptive-quality machinery of architecture §9: drei's `<PerformanceMonitor>`
watches frame rate and steps the active `QualityTier` down (and back up) BEFORE
frames drop, applying the §9 degradation order — **point count → bloom → atmosphere
→ resolution scale**. `scene-host` owns the tier state, exposes it to subscribers
(`streaming` applies point-count caps; the post chain applies bloom/atmosphere;
the renderer applies resolution scale), and drives `WebGLRenderer.setPixelRatio`
for the resolution-scale step. This is the sanctioned Phase-3 thaw of the
`scene-host` public API (additions below only); all Phase 0 + TASK-028 behavior is
byte-identical and its tests pass unmodified.

## Frozen Interface (additions to @cosmos/scene-host — existing API unchanged)

```ts
import type { QualityTier, QualitySettings } from '@cosmos/core-types';

/** Read the current tier's settings + subscribe to changes. Returned by a hook
 *  usable inside the Canvas tree; also exposed on the SceneHost for the app glue. */
export interface QualityController {
  readonly tier: QualityTier;
  readonly settings: QualitySettings;
  /** Manual override (settings UI / tests). null ⇒ resume automatic control. */
  setTier(tier: QualityTier | null): void;
  /** Fires on every tier change (debounced — never per-frame). Returns unsubscribe. */
  onChange(cb: (settings: QualitySettings) => void): () => void;
}

/** Hook: current quality settings inside the Canvas tree. Re-renders the calling
 *  component only on TIER change (low-frequency), never per-frame (§5.12). */
export function useQuality(): QualitySettings;

export interface SceneHostProps {
  // …all existing props (epochProvider, onFrame, children) stay byte-identical…
  /** Start tier (default 'high'). PerformanceMonitor adapts from here. */
  readonly initialQualityTier?: QualityTier;
  /** Called once on mount with the QualityController (app wires streaming + post). */
  readonly onQualityController?: (qc: QualityController) => void;
  /** Disable automatic adaptation (tests / forced-tier demos). Default false. */
  readonly disableAutoQuality?: boolean;
}
```

## Fixed semantics (transcribe, don't redesign — §9)

- **Tier table:** the `QualitySettings` per tier come from `QUALITY_TIERS` in
  `core-types` (TASK-031) — `scene-host` does not redefine them. `high` →
  `maxRenderedPoints 2_000_000`, bloom on, atmosphere on, resolutionScale 1.
- **Degradation order (§9):** on a sustained performance DECLINE, step the tier down
  one level (`high → medium → low`); on sustained HEADROOM, step up one level. The
  *order in which capabilities turn off* is encoded by the `QUALITY_TIERS` table
  (point count shrinks first across tiers, then bloom off, then atmosphere off, then
  `resolutionScale < 1`) — do NOT invent a different ordering; the table is the
  contract.
- **PerformanceMonitor wiring:** drei `<PerformanceMonitor>` `onDecline` → step down,
  `onIncline` → step up, with its built-in hysteresis/flip-flop guard; debounce tier
  changes so they never fire per-frame (§5.12). When `disableAutoQuality` or a manual
  `setTier(tier)` override is active, ignore monitor callbacks.
- **Resolution scale:** `scene-host` applies `resolutionScale` via
  `gl.setPixelRatio(Math.min(devicePixelRatio, 2) * settings.resolutionScale)` on
  tier change ONLY (not per-frame). Bloom/atmosphere flags are exposed for the post
  chain (mounted after scene content, §5.1) and `streaming` reads `maxRenderedPoints`
  through the app glue — `scene-host` does not import `streaming`.
- The controller is provided to the app via `onQualityController`; the in-tree
  `useQuality` hook is for render packages mounted inside the Canvas.

## Inputs / Outputs

- **Inputs:** `<SceneHost initialQualityTier="high" onQualityController={...} />`.
- **Outputs:** `QualityController`; `useQuality()` → current `QualitySettings`;
  `gl` pixel ratio updated on tier change.

## Constraints & Forbidden Actions

- Do not modify `core-types`. Only the API additions above may change `scene-host`'s
  public surface (this file is the thaw approval). All Phase 0 + TASK-028 tests pass
  UNMODIFIED — break one ⇒ `blocked`.
- Allowed dependencies: existing scene-host deps + `@react-three/drei`
  (`PerformanceMonitor`) — drei is the §5.1/§9 sanctioned source; list it under
  workspace deps if not already present. No `@cosmos/streaming` import (the app wires
  point caps; scene-host stays a glue package, §5.1).
- Tier changes are low-frequency: `onChange`/`useQuality` re-render must be debounced
  and must NOT fire per-frame; the Canvas must not re-render on tier change beyond
  the resolution-scale apply (§5.1 Canvas-isolation rule).
- No allocations in any per-frame callback. No `Math.random()`.

## Common Mistakes (architecture §5.1, §9, §5.12 — copy kept verbatim)

- Forgetting the logarithmic depth buffer → z-fighting at astronomical scale.
  Enable from day one. (Unchanged — do not regress it when touching renderer config.)
- Letting React re-render the Canvas subtree on UI state changes — isolate Canvas
  from HUD state with separate stores/selectors. (Tier changes must not cascade a
  Canvas re-render beyond the pixel-ratio apply.)
- Using MSAA + postprocessing together on WebGL2 (broken/expensive) — use FXAA/SMAA
  in the post chain.
- Plus (§9): dropping FRAMES before dropping QUALITY (the monitor must act first);
  changing pixel ratio every frame (apply on tier change only); subscribing HUD to
  per-frame data — tier is a low-frequency signal (§5.12).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/scene-host test` — new `test/quality.test.ts`
   (@react-three/test-renderer + Vitest, monitor callbacks simulated):
   - Initial tier = `initialQualityTier` (default 'high'); `useQuality()` returns
     `QUALITY_TIERS.high`.
   - Simulated `onDecline` steps `high → medium → low` (one step each, debounced —
     not per call within the debounce window); `onIncline` steps back up; never
     below 'low' or above 'high'.
   - `setTier('low')` overrides and freezes automatic control until `setTier(null)`
     resumes it; `disableAutoQuality` ignores monitor callbacks entirely.
   - On a tier change, `gl.setPixelRatio` is called with the new `resolutionScale`
     factor exactly once (spy); it is NOT called on non-changing frames.
   - `onChange` fires once per actual tier change with the new `QualitySettings`;
     deduplicated; unsubscribe works; a throwing handler doesn't block the next.
   - **Canvas isolation:** a tier change causes zero re-renders of a sibling HUD
     stub outside the Canvas (test-renderer render count assertion, like Phase 0).
   - All existing scene-host suites (priority ordering, dt clamp, epoch provider,
     unmount cleanup) green, unmodified.
2. `pnpm verify` exits 0 (boundary lint unchanged).

## Deliverables

- `packages/scene-host/src/quality.ts` (`QualityController`, tier state machine,
  PerformanceMonitor wiring), `src/use-quality.ts` (`useQuality` hook),
  `src/SceneHost.tsx` (props additions + controller mount), `src/index.ts`
  (export additions)
- `packages/scene-host/test/quality.test.ts`
- `packages/scene-host/README.md` (quality section added; keep < 150 lines)

## Context Files

- `docs/architecture.md` §9 (adaptive tiers + degradation order — normative),
  §5.1 (PerformanceMonitor, Canvas isolation), §5.12 (no per-frame HUD data)
- `packages/core-types/src/quality.ts` (`QualityTier`, `QualitySettings`,
  `QUALITY_TIERS` from TASK-031)
- `packages/scene-host/src/SceneHost.tsx` + `README.md` (existing props + frame
  loop + EpochProvider pattern to extend without breaking)
