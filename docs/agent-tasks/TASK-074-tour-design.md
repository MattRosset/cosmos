# Task: Guided-tour full design (design doc, not code)

**ID:** TASK-074
**Target package:** none — deliverable is `docs/research/tour-design.md` + follow-on task specs
**Size:** M (reading + writing; zero code)
**Phase:** Maintenance track — UX thread
**Depends on:** best done after TASK-069/070 land (a tour that can *name real stars* is
a different, better tour than one that can't — the design should know what's available).

## Goal

The guided tour is currently scoped to galaxy-scale stars only — a deliberate temporary
cut; the full design was deferred to "a future task." This is that task. It is a
**judgment task**: per the spec doctrine, it must NOT be handed to an implementer as
open-ended code work. The deliverable is a design document plus mechanical follow-on
specs that a cheaper model can then execute.

## Deliverables

1. `docs/research/tour-design.md` covering, with explicit decisions (not option lists):
   - **Stops & narrative arc:** which scales the tour visits (universe → galaxy →
     star field → Sol system → Earth?) and in what order; what each stop *says*
     (content), including whether real Gaia identities/telescope reveal
     (`telescope-effect-magnitude-reveal.md`) get a stop.
   - **Camera language:** reuse of the existing goTo/transit machinery vs. authored
     paths (`flythrough3-path.json` precedent); dwell/pacing; user interrupt semantics
     (pause/skip/exit — what happens to camera state on exit).
   - **UI surface:** how the tour is entered/presented (existing HUD? cards from
     TASK-068's identity work?); accessibility of controls (role locators — must be
     e2e-testable per doctrine).
   - **Determinism & testability:** what `__cosmos` hooks the tour needs to expose so
     e2e can gate "tour reaches stop N with camera within tolerance" without pixels
     or wall-clock (this section is mandatory — a design that can't be gated
     deterministically is incomplete per the CI doctrine).
   - **Perf interaction:** tour crosses the galaxy transit — confirm the design stays
     inside existing budgets (procgen floor, TASK-071 tiers) instead of adding modes.
2. 2–4 follow-on task specs in `docs/agent-tasks/` (TEMPLATE.md format), each sized
   S/M and mechanical, with the frozen interfaces the design fixed.
3. An entry in `docs/decisions/` ONLY if the design forces an architectural decision
   (e.g. a new authored-path format); otherwise the research doc suffices.

## Constraints

- Read before designing: the m4a cinematic flake root-cause
  (`docs/research/m4a-tour-cinematic-flake-rootcause.md`) — the last tour-adjacent
  work's failure modes are the design's constraint set.
- The design must degrade gracefully if TASK-069/070 haven't landed (tour stops that
  reference real ids become generic).
- No implementation in this task, not even "quick prototypes" that touch `apps/web`.

## Acceptance

Done when: the design doc exists with every bullet above *decided*; the follow-on
specs pass a `doctrine-review`-style read (deterministic gates, frozen interfaces,
out-of-scope sections present); and the user has read and ratified the stop list
(content decisions are the user's — flag the doc for review, don't self-approve).

## Context Files

- `docs/research/navigation-ux.md`, `docs/research/ui-ux-perception-and-polish.md`
- `docs/research/m4a-tour-cinematic-flake-rootcause.md`
- `docs/research/telescope-effect-magnitude-reveal.md`
- TASK-066/067/068 (the in-flight UI-perception tasks — the tour must not fork their vocabulary)
- `apps/web` tour/flythrough entry points (find via `flythrough3-path.json` consumers)
