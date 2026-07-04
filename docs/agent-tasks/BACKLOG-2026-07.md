# Backlog — July 2026 spec set (TASK-069…074)

Written 2026-07-04. Six specs covering the open fronts identified across
`docs/research/`, each written to be executable by a smaller model with the judgment
decisions already made (or, for 074, explicitly quarantined into a design task).
Read the spec before starting; each has its own Frozen/Out-of-scope/Failure-modes.

## Recommended order & why

| # | Task | Thread | Size | Why this position |
|---|------|--------|------|-------------------|
| 1 | TASK-071 procgen tier LOD | GPU | S | Smallest, zero deps, closes the last BUG-4 polish; unlocks 072's value. |
| 2 | TASK-072 boot tier + pixel-ratio cap | GPU | M | With 071, an M1 user gets a good first session; pure structural gates, safe. |
| 3 | TASK-069 Gaia pick identity | Realness | M | Highest product value per effort: the 4.6M real stars become *verifiably* real. Fixes a latent mis-id bug on the way. |
| 4 | TASK-070 search by source_id | Realness | L | Depends hard on 069. Completes the realness loop (find → fly → verify). |
| 5 | TASK-073 nebula B4+B3 | Visual | M | Independent; do whenever a visual win is wanted. Defers B1/B2 (design-first). |
| 6 | TASK-074 tour design | UX | M | Design doc only. Best after 069/070 so the tour can name real stars. |

## Threads these belong to (the map)

- **Integrated-GPU floor** (`integrated-gpu-targeting.md`): 071 → 072 are Steps 1–2.
  Step 3 (M1 calibration) is reference-machine work, not speccable for CI — do it on
  the M1 with the doc's playbook after 072 lands, then recalibrate 071's `medium`
  budget and the tier table in one small follow-up.
- **Gaia realness** (`gaia-visibility-and-realness-problem.md` §5): 069 → 070 wire two
  of the three dead axes (identity, search). The third — *seeing* faint stars
  (exposure/telescope design) — already has its own thread
  (`telescope-effect-magnitude-reveal.md`) and in-flight UI tasks (066–068).
- **Visual quality** (`nebula-visual-quality.md`): 073 is the mechanical half of
  Tier B. B1 (dust absorption) needs a blend-mode design decision first — if wanted,
  spawn a small design task like 074's pattern before speccing it.
- **UX**: 074 produces the specs for the tour build-out; nothing to build until it's
  ratified.

## Standing rules for whoever executes these

1. Every spec's **Step 0 / verification steps are mandatory** — they exist because the
   spec was written from research docs + code reading on 2026-07-04 and the code may
   have moved. If reality contradicts the spec, stop and update the spec (or mark
   blocked); do not improvise around it.
2. `pnpm verify` locally; e2e stays CI-side (never run the full Playwright suite on
   the dev machine — see CLAUDE.md local-vs-CI gate).
3. Findings during a task go to `docs/research/`; scope creep goes to a new task file,
   not into the current diff.
