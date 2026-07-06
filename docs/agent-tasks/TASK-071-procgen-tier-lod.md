# Task: Tier-aware procgen draw cap (integrated-GPU Step 1)

**ID:** TASK-071
**Target package:** `apps/web` (GalaxyScene glue) ONLY
**Size:** S
**Phase:** Maintenance track — integrated-GPU thread
**Depends on:** none (BUG-4 closed by the global cap `1626985`; this is the remaining polish)

## Goal

The procgen Milky Way cloud's draw budget responds to the quality tier: `high` draws the
full cloud at far vantage (restoring inter-arm density on capable GPUs — the known
sparsity note from BUG-4's resolution), while `medium`/`low` keep today's 90k cap that
protects integrated GPUs from the fill-rate cliff. Today
`PROCGEN_MAX_DRAW_POINTS = 90_000` (`apps/web/src/scene/GalaxyScene.tsx:119`) applies
identically to every tier — gap #1 in `docs/research/integrated-gpu-targeting.md` §3.

## THE TRAP (read before anything else)

`drawFraction` is a **perf-only** knob. Do NOT tie it to `procgenBlend` (the visual
opacity fade) — coupling them re-created the P2 "nebulas without stars" regression
during the galaxy-transit work. See
`docs/research/galaxy-transit-procgen-floor-design.md` and the comment block at
`GalaxyScene.tsx:474`. The two systems stay orthogonal: blend = *what the transit looks
like*, drawFraction = *how much we can afford to rasterize*.

## Frozen Interface

- `packages/*` untouched — `cloud.setDrawFraction` is already exposed; `useQuality` is
  the existing hook. This is glue-only by design (integrated-gpu-targeting.md Step 1:
  "not a frozen-package change for the simple case").
- The `low`-tier budget stays exactly 90_000 (the BUG-4 fix; it is load-bearing).
- The tier table in `packages/core-types/src/quality.ts` is NOT extended (no new
  fields; the mapping lives in the glue).

## Deliverables

1. Replace the single const with a per-tier budget in `GalaxyScene.tsx`:
   `high: Infinity` (full cloud), `medium: 250_000`, `low: 90_000`. Read the current
   tier via `useQuality().tier` from `@cosmos/scene-host` — note (verified 2026-07-05)
   GalaxyScene does **not** consume quality yet; copy the import/usage pattern from
   `Overlays.tsx:47` (sibling scene, re-renders only on tier change). Recompute
   drawFraction on tier change at the existing `setDrawFraction` call sites (lines
   ~235/~519 — keep the "contiguous prefix" contract documented there); the ~519 site
   computes from `m.batch.count`, so a tier change after load must re-run that same
   computation with the live count, not a stale one.
2. Update the comment block (lines ~112–119) to describe the tier mapping and point at
   this task + integrated-gpu-targeting.md.
3. The `medium` value is a placeholder pending M1 calibration (integrated-gpu-targeting
   §Step 3) — say so in the comment so the future calibration task knows it may move.

## Out of scope

- Distance-based LOD (draw more when far, less when near) — noted as optional in the
  research doc; it interacts with the transit fade and needs its own verification pass.
- Boot-time GPU detection / pixel-ratio cap (TASK-072).
- Any change to `procgenBlend`, fade windows (`GAL_FADE_*`), or the nebula overlays.

## Failure modes to watch

- The trap above (blend/drawFraction coupling) — reviewer must specifically check no
  code path writes both from the same input.
- **Tier flapping:** `PerformanceMonitor` steps tiers up/down at runtime; a tier change
  mid-transit must not visibly pop. `setDrawFraction` already draws a contiguous prefix,
  so a change is a density step — acceptable; just ensure no per-frame allocation or
  buffer rebuild on tier change (frame-loop allocation is banned repo-wide).
- `Infinity / count` → drawFraction must clamp to 1, not NaN — unit-test the mapping fn.

## Acceptance Tests

1. `pnpm verify` exits 0.
2. Extract the tier→budget→drawFraction mapping as a pure exported function; unit-test:
   low/1.11M cloud ⇒ ≈0.081, high/any ⇒ 1, medium/250k boundary, count=0 safe.
3. `pnpm test:e2e` green — specifically the flythrough4 near-Sol gate (memory:
   `ci-flythrough4-procgen-lod`) must stay green, since CI runs low-tier-equivalent
   SwiftShader and its budget is unchanged.
4. e2e or unit assertion via the existing work-budget proxy: in `low` tier the drawn
   procgen point count ≤ 90_000 (query `__cosmos`/gl.info path used by existing gates —
   no wall-clock, no screenshots).

## Context Files

- `apps/web/src/scene/GalaxyScene.tsx` lines ~100–130, ~230–240, ~470–525
- `docs/research/integrated-gpu-targeting.md` §2–§4 (existing quality infra — do not rebuild)
- `docs/research/procgen-lod-near-sol.md` (§Future — this task implements it)
- `docs/research/galaxy-transit-procgen-floor-design.md` (the trap's history)
- `apps/web/src/scene/Overlays.tsx` line ~47 (the `useQuality().tier` consumption
  pattern to copy; `glue/quality.ts` is post-chain wiring, not the hook)
