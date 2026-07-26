# Is cosmos' documentation load a net help or a net confusion source for agents?

**Status:** in progress — Steps 1–2 written and committed *before* any file was opened.
**Date:** 2026-07-26

## Step 1 — Falsifiable questions

**Q1. Volume/reach: does the documentation an agent is *forced* to read (always-in-context
surfaces: `CLAUDE.md` files, skill bodies auto-loaded, README pointers) exceed what it can
act on?**
Measurable: byte/word count of the always-loaded set vs. the opt-in set (`docs/**` read on
demand). Yes/no: is the always-loaded set > ~10k words (roughly the point where instructions
stop being reliably followed end-to-end)?

**Q2. Contradiction: do any two documents an agent may plausibly hold at once state
incompatible facts or rules?**
Measurable: enumerate normative statements (MUST/never/always, thresholds, commands, file
paths) across `CLAUDE.md` (global + project), `docs/testing-conventions.md`, ADRs, skills,
and memory index; diff for direct conflicts. Yes/no per pair.

**Q3. Rot: of the *pointed-to* facts in docs (file paths, script names, thresholds, "current
state" claims), what fraction is false against the live repo today?**
Measurable: extract concrete referents (paths, `pnpm` scripts, symbol names, numeric caps)
from docs and check each against the working tree. Report a rate, not an anecdote.

## Step 2 — Kill conditions (written before investigating)

- **Kills "we have too much documentation"** (→ verdict: docs are working, no consolidation
  task): always-loaded set is small (< ~4k words), Q2 finds zero real contradictions, and
  Q3 rot rate is low (< ~10% of concrete referents false). Then the docs are opt-in depth,
  which is the intended design, and any felt confusion has another cause.
- **Kills "the docs are fine"** (→ verdict: real problem, consolidation/pruning task
  justified): Q2 finds ≥1 contradiction that would change what an agent does, **or** Q3 rot
  rate is high (> ~25%), **or** Q1 always-loaded volume is large enough that documented rules
  are demonstrably dropped.
- **Reframes the question**: if volume is fine and contradictions are absent but the *stale-
  fact* problem is concentrated in one surface (e.g. task specs / NOTES / memory rather than
  `docs/`), then the finding is "the problem is not documentation volume, it is <surface>."
- **Explicitly available outcome:** "no task should exist here" is a valid and expected
  result. This doc is not obligated to produce a cleanup backlog.

### A note on evidence I am not allowed to use

Prior-session recall (mine or memory files) about what these docs say is a hypothesis only.
Every claim below traces to a file opened or a command run on 2026-07-26.

## Step 3–5 — Findings

*(to be filled in)*

## What I looked for and didn't find

*(to be filled in)*

## Verdict

*(to be filled in)*
