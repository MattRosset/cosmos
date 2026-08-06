# TASK-096: Freeze Natural and Survey visibility semantics

**Initiative:** visibility-aware galaxy streaming (VIS-01)  
**Size:** S  
**Class:** judgment already resolved by product owner; executor records the decision mechanically  
**Depends on:** `docs/research/galaxy-octree-streaming-value-near-sol.md` (complete, verdict REFRAME)

## Goal

Create `docs/decisions/ADR-007-star-visibility-modes.md`, the frozen product/engineering
contract for two display modes. **Natural** remains the current rich default rather than a
strict naked-eye simulation. **Survey** is an explicit deeper-exposure mode that reveals the
real faint catalog without optical zoom. The ADR fixes names, exposure profiles, slider
semantics, scope, and perceptibility terminology so later photometry, UI, picking, streaming,
and pack tasks have no product decisions left to invent.

This task changes documentation only. It does not add settings, UI, shader behavior, picking,
streaming, FOV changes, or pack changes.

## Step 0 — verify the spec's facts

Re-confirm these before writing the ADR. If any contradicts live code, STOP and update this
spec; do not silently change the contract around drift.

1. `packages/app-state/src/settings.ts` still defines one shared exposure slider with
   `EXPOSURE_MIN = 0.1`, `EXPOSURE_MAX = 200`, `EXPOSURE_DEFAULT = 25`, and describes 25 as a
   rich-sky default rather than naked-eye truth.
2. `apps/web/src/scene/GalaxyScene.tsx` still applies
   `GALAXY_FIELD_EXPOSURE_BOOST = 6` to octree mounts, so default effective octree exposure is
   `25 × 6 = 150`; procgen still has an unrelated cloud-only boost.
3. `packages/scene-host/src/SceneHost.tsx` still fixes camera FOV at 60°, with no optical zoom
   control.
4. `apps/web/src/glue/tile-brightness-cull.ts` still freezes
   `TILE_VISIBILITY_FLOOR = 0.004`, while `packages/ui/src/InfoPanel.tsx` separately describes
   naked-eye visibility from apparent magnitude. These are different concepts and remain so.

## Context — read first

- `docs/research/galaxy-octree-streaming-value-near-sol.md` — measured reason the mode contract
  must govern residency, rendering, and picking consistently.
- `docs/research/telescope-effect-magnitude-reveal.md` — evidence for effective exposure
  ≈500–1000 and why exposure-only behavior must not be called a telescope.
- `docs/research/gaia-visibility-and-realness-problem.md` — faint-tail distribution and product
  value of the deep Gaia pack.
- `packages/app-state/src/settings.ts` — current slider semantics that Natural preserves.
- `apps/web/src/scene/GalaxyScene.tsx` — current source-specific exposure boosts.
- `packages/ui/src/astro-derive.ts` and `packages/ui/src/InfoPanel.tsx` — catalog/naked-eye copy
  that display mode must not rewrite.

## Frozen — do not reinterpret

The ADR must state these decisions exactly:

1. `StarVisibilityMode = 'natural' | 'survey'`.
2. **Natural is the default and preserves today's rich field:**
   - slider default remains 25 and range remains `[0.1, 200]`;
   - galaxy octree multiplier remains 6 (default effective exposure 150);
   - HYG/exoplanet/system star rendering remains on its current raw-slider multiplier;
   - procgen cloud exposure remains independent.
3. **Survey is exposure-only in this initiative:**
   - galaxy octree multiplier is 40 (default effective exposure 1000);
   - the same slider remains a relative trim; switching mode never rewrites its stored value;
   - camera FOV remains 60°;
   - no reticle, vignette, magnification, or optical claim;
   - UI copy is **Survey** or **Deep survey**, never Telescope.
4. Both modes use perceptibility floor `0.004` for render/pick/streaming coherence. The mode
   changes effective exposure, not the floor.
5. Gaia-card “visible to naked eye / needs telescope” copy remains catalog truth derived from
   apparent magnitude and is independent of active display mode.
6. Survey reveals real catalog stars only. It does not increase procgen density or claim
   invented stars as survey detections.
7. Faint residency never implies visibility or pickability; all consumers eventually use the
   same profile.
8. Mode starts as Natural on every boot. Persistence is not introduced by this initiative.
9. **Survey is the mode that pays full price.** Raising effective octree exposure from 150 to
   1000 makes far more catalog stars reach the same `0.004` floor, so every photometric
   reduction downstream (tile brightness cull, subtree `minAbsMag`, any future band layout)
   shrinks or disappears in Survey. This is accepted, not a defect: Natural is the default and
   is where the saving lives. The ADR must state it, and downstream tasks must report streaming
   results per profile rather than averaging the two.

Changing any item requires a separately reviewed ADR amendment/thaw task.

## Out of scope

- Implementing `viewMode` in Zustand or UI (VIS-05, after the Stage-0 tasks).
- Creating `@cosmos/photometry` (TASK-097/VIS-04).
- Changing render behavior, or pick behavior beyond TASK-100's perceptibility gate (VIS-06).
- Optical Telescope/FOV narrowing, reticle, or zoom controls (future initiative).
- Streaming selection, prefetch, magnitude bands, or pack-format changes.
- Retuning `0.004`, multiplier 6, slider bounds/default, shaders, point-size clamps, flythrough
  thresholds, or procgen behavior.

Findings during this task go to `docs/research/`; scope creep goes to a new task file, not
into this diff.

## Deliverables / steps

**Log every judgment call — anything this task didn't decide and you had to — to
`docs/agent-tasks/TASK-096-NOTES.md` beside the diff, visibly, as you go (not reconstructed
after).**

1. Add `docs/decisions/ADR-007-star-visibility-modes.md` using the repository ADR style.
2. Add rows for the **whole initiative** to the `docs/agent-tasks/README.md` status table —
   TASK-096, 097, 098, 099, 100, 101 — each `pending`, with its real blocker.
   All six go in one edit because `tools/check-task-index` rejects a blocker id that has no row
   (rule 3): adding TASK-097 alone, blocked by a TASK-096 that is not in the table, fails the
   gate. Do **not** backfill TASK-087…095 here; those rows are missing for unrelated reasons
   and belong to a separate index-sync task.
3. Mark the ADR status **Accepted** and cite the two user-resolved choices:
   - Natural preserves the current enriched field;
   - Survey changes depth/exposure only; optical Telescope is separate.
4. Include a compact profile definition with the exact multipliers and formulas:
   - `naturalOctreeExposure = sliderExposure × 6`;
   - `surveyOctreeExposure = sliderExposure × 40`;
   - `perceptible ⇔ shaderBrightness ≥ 0.004`.
5. Separate these terms explicitly:
   - **naked-eye visibility:** catalog fact used by cards;
   - **render perceptibility:** current camera/profile/shader result;
   - **residency:** data availability, never a display promise.
6. Document rejected alternatives and why:
   - strict naked-eye Natural would regress the intentionally rich current default;
   - calling exposure-only behavior Telescope would make a false optical claim;
   - lowering the floor instead of raising Survey exposure would split consumer semantics.
7. Cross-link this ADR from the initiative research document's verdict section without changing
   its findings or measurements.

## Failure modes to watch

1. **Renaming current exposure 150 “naked eye.”** Existing settings comments and research say
   it is intentionally enriched. Detection: ADR equates Natural with human limiting magnitude.
2. **Conflating Survey with Telescope.** The prior telescope research requires both narrower
   FOV and more light. Detection: ADR promises magnification, zoom, reticle, or optical realism.
3. **Making card copy mode-relative.** A star needing a telescope from Sol remains a catalog
   fact even when Survey displays it. Detection: ADR says the card should change its naked-eye
   sentence when mode toggles.
4. **Accidentally thawing renderer constants.** This is a documentation task; any source,
   threshold, or baseline diff is scope violation.

## Acceptance gate

- `docs/decisions/ADR-007-star-visibility-modes.md` exists and contains every Frozen item.
- `rg -n "natural|survey|sliderExposure × 6|sliderExposure × 40|0\\.004|naked-eye|residency" docs/decisions/ADR-007-star-visibility-modes.md`
  finds the corresponding contract text.
- `docs/agent-tasks/README.md` has exactly one row for each of TASK-096…101, every one linking
  to an existing file and reading `pending`.
- `pnpm check:tasks` exits 0.
- `git diff --name-only` for the task contains only:
  - `docs/decisions/ADR-007-star-visibility-modes.md`;
  - `docs/research/galaxy-octree-streaming-value-near-sol.md`;
  - `docs/agent-tasks/README.md`;
  - `docs/agent-tasks/TASK-096-NOTES.md`.

## Verification beyond the gate

Have the product owner read the rendered ADR once and confirm that “Natural” means the current
rich default and “Survey” is deeper exposure without optical zoom. No screenshot or runtime
verification applies to this documentation-only task.
