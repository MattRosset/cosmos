# ADR-001: Coordinate & Scale Architecture

**Status:** Accepted
**Date:** 2026-06-10

## Context

The universe spans ~26 orders of magnitude (planetary surfaces in meters → intergalactic distances in megaparsecs). GPU vertex pipelines operate in 32-bit floats (~7 significant decimal digits). A single global world space in f32 produces catastrophic vertex jitter long before reaching interesting scales. This is the highest-risk decision in the project; every renderer, the camera, streaming, and procedural generation depend on it.

## Decision

Use **hierarchical scale contexts + camera-relative rendering with a floating origin**:

1. **Scale contexts** — named local coordinate frames, each with its own unit:
   - `universe` (unit = 1 Mpc)
   - `galaxy` (unit = 1 pc)
   - `system` (unit = 1 AU)
   - `planet` (unit = 1 km)

   Each context defines its parent and an f64 transform to it.

2. **Position type** — `UniversePosition = { context: ContextId, local: [f64, f64, f64] }`. JS numbers are f64, which is sufficient precision within any single context. Positions are converted to f32 **only after** subtracting the camera position.

3. **Floating origin / rebase rule** — when `|cameraLocal| > 10,000` units in the current context, subtract the camera position from all root-level render groups and zero the camera. Rebasing happens atomically at frame start, never mid-frame. Velocities and orientations are rebased too.

4. **Context switching** — when the camera approaches/leaves an anchor body, reparent into the appropriate frame (e.g., entering a star system switches to the `system` context).

5. **Renderer contract** — all `render-*` packages receive *camera-relative f32* positions computed by the `coords` package. They never see absolute coordinates. GPU buffers (e.g., star tiles) are context-local.

## Alternatives Considered

- **Emulated f64 in shaders (two-float splitting):** unnecessary complexity and shader cost; the context hierarchy avoids the need entirely.
- **One global f64 CPU world, f32 GPU with per-object relative transforms:** workable but loses the unit renormalization that keeps numbers in healthy ranges at every scale; harder to reason about for agents.
- **Naive single f32 world:** fails immediately at scale; rejected.

## Consequences

- `coords` is a Phase 0, fully test-gated package; its API freezes before any parallel work begins.
- A **jitter test** is the acceptance gate: camera orbiting 1 AU from a planet placed 8 kpc from galactic center must show sub-pixel vertex stability (screen-space variance < 0.5 px over 300 frames).
- Logarithmic depth buffer is mandatory from day one (combined with per-context near/far planes).
- Cross-context math (e.g., distance between bodies in different contexts) must route through `coords` — direct subtraction is banned by convention and review.
