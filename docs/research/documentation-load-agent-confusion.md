# Is cosmos' documentation load a net help or a net confusion source for agents?

**Status:** complete — verdict **REFRAME**.
**Date:** 2026-07-26
**Note on ordering:** Steps 1–2 below were written and committed (`26b4172`) *before* any
source file was opened, per the research procedure. Steps 3–6 were appended afterward.

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

---

## Step 3–4 — Claims

### Q1 — Volume and reach

```
CLAIM:    The auto-loaded (unavoidable) documentation surface is ~2.5k words total, far
          below any plausible instruction-dropping threshold. The 203k-word docs/ tree is
          entirely opt-in.
EVIDENCE: project CLAUDE.md = 332 words; global ~/.claude/CLAUDE.md = 751 words;
          MEMORY.md index = 1,404 words. Total 2,487. Against docs/**.md = 148 files /
          202,806 words, none of which is auto-loaded (the repo's only .claude/ files are
          launch.json and settings.local.json — no auto-context config).
VERIFIED: 2026-07-26
RECHECK:  wc -w CLAUDE.md ~/.claude/CLAUDE.md \
            ~/.claude/projects/C--dev-Projects-cosmos/memory/MEMORY.md
          find docs -name '*.md' -exec wc -w {} + | tail -1
          ls .claude/
```

```
CLAIM:    The opt-in bulk is task history, not reference material: docs/agent-tasks is
          97 files / 114,911 words (57% of the tree), docs/research 41 files / 73,591
          words (36%). Actual reference docs are 7% (architecture + testing-conventions +
          galaxy-rendering-model = 9,220 w; 6 ADRs = 4,981 w).
EVIDENCE: per-subdir word counts, 2026-07-26 working tree.
RECHECK:  for d in docs docs/agent-tasks docs/decisions docs/research; do \
            echo -n "$d: "; find $d -maxdepth 1 -name '*.md' -exec cat {} + | wc -w; done
VERIFIED: 2026-07-26
```

```
CLAIM:    The largest single doc an agent is steered into, docs/agent-tasks/README.md
          (5,542 words / 278 lines), spends its opening ~25 lines on parallel-lane
          scheduling rules for Phases 0–4a — all of which are `done`. That is dead
          routing detail in the most-read position of the most-read index.
EVIDENCE: docs/agent-tasks/README.md:12–33 (lane serialization for TASK-015/029/038/
          043–053); status table shows every one of those tasks `done`.
RECHECK:  sed -n '10,35p' docs/agent-tasks/README.md   # then check those ids' Status cells
VERIFIED: 2026-07-26
```

### Q2 — Contradiction

```
CLAIM:    Two documents disagree about where progress is tracked. README.md's table is
          titled "the ONLY place progress is tracked", but TASK-069…077 (nine authored
          task files on disk) appear nowhere in it — the table jumps TASK-068 → TASK-078.
          Their ordering/status lives in a second registry, BACKLOG-2026-07.md.
EVIDENCE: grep -cE "TASK-0(69|7[0-7])" docs/agent-tasks/README.md → 0.
          ls docs/agent-tasks/TASK-07*.md → 069,070,071,072,073,074,075,076,077 present.
          docs/agent-tasks/README.md:57 "Status table (the ONLY place progress is tracked)".
RECHECK:  grep -c "TASK-069" docs/agent-tasks/README.md   # expect 0 today
VERIFIED: 2026-07-26
```

```
CLAIM:    That gap is not merely cosmetic: at least three of the nine shipped real code
          while remaining unrouteable and unstatused.
EVIDENCE: git log --all: `c3f82a1 feat(render-stars): guard hi/lo star sum vs fast-math
          (TASK-077)`, `bc4de7e fix(render-stars): flux-conserving 3px point-size floor
          (TASK-076)`, `801cb35 feat: tier-aware procgen draw cap (TASK-071)`.
RECHECK:  git log --oneline --all -i --grep=TASK-071 --grep=TASK-076 --grep=TASK-077
VERIFIED: 2026-07-26
```

```
CLAIM:    The index's own routing rule ("pick the lowest-numbered `pending` task whose
          blockers are all `done`") currently points an agent at TASK-063, whose own Notes
          cell says the code "appears shipped". The rule and the data disagree inside one
          row.
EVIDENCE: docs/agent-tasks/README.md:12 (rule 1) and :123 (TASK-063 row, status `pending`,
          "STATUS AUDIT 2026-07-22: code appears shipped — all 8 `toHaveScreenshot` call
          sites are guarded").
RECHECK:  grep -n "TASK-063" docs/agent-tasks/README.md
VERIFIED: 2026-07-26
```

```
CLAIM:    No doctrinal contradiction exists between the normative docs — precedence is
          stated explicitly wherever two could collide, and the stated winner is the
          operative one.
EVIDENCE: docs/architecture.md:519 "where this table and that document disagree, the
          conventions document wins"; docs/agent-tasks/README.md:3–5 "If any task file
          conflicts with architecture.md or an ADR..., those win — stop, set the task to
          blocked". Both point the same direction as CLAUDE.md's inline testing rules.
RECHECK:  grep -n "wins\|those win" docs/architecture.md docs/agent-tasks/README.md
VERIFIED: 2026-07-26
```

### Q3 — Rot

```
CLAIM:    Path-referent rot is low: of 364 distinct repo-root-relative file paths cited in
          backticks across docs/**, CLAUDE.md and README.md, 12 (3.3%) do not exist. On the
          steered surfaces only (CLAUDE.md, README.md, architecture.md,
          testing-conventions.md, ADRs, agent-tasks/README.md) it is 1 of 26 (3.8%) —
          `e2e/m4a.spec.ts`.
EVIDENCE: scripted existsSync sweep, 2026-07-26. First pass reported 47.6% but was
          confounded: most "missing" paths are package-relative (`src/index.ts` inside a
          per-package task file), which is correct addressing, not rot. Restricting to
          paths prefixed apps|packages|e2e|tools|docs|.github gives the 3.3% figure.
          Of the 12, most are historically correct — e.g. TASK-060 deliberately deleted
          `packages/nav/src/useFlightController.tsx`, and TASK-016's `deploy.yml` was
          removed 2026-07-22 (both documented in the citing files).
RECHECK:  node <the sweep>  — regex /`((apps|packages|e2e|tools|docs|\.github)\/[^`]+\.
          (ts|tsx|mjs|js|json|yml|glsl|bin|md))`/ over docs/**.md + CLAUDE.md + README.md,
          existsSync each.
VERIFIED: 2026-07-26
```

```
CLAIM:    architecture.md's concrete operational numbers are accurate despite the file not
          being touched since 2026-07-10: the §12 bundle budget (1.2 MB gz), the
          update-snapshots workflow, and the chromium/webkit/firefox e2e matrix all match
          the live config exactly.
EVIDENCE: tools/check-bundle-size/src/check.mjs:7 `LIMIT_BYTES = 1.2 * 1024 * 1024`;
          .github/workflows/ contains ci.yml + update-snapshots.yml; ci.yml:63 installs
          `chromium webkit firefox`.
RECHECK:  grep -n LIMIT_BYTES tools/check-bundle-size/src/*.mjs; ls .github/workflows/;
          grep -n "playwright install" .github/workflows/ci.yml
VERIFIED: 2026-07-26
```

```
CLAIM:    CLAUDE.md's two operative commands are exactly right: `pnpm verify` = lint +
          typecheck + test + build (e2e excluded), and `pnpm test:e2e` = build web + gate
          on chromium. The read-hook path it names also exists.
EVIDENCE: package.json scripts.verify = "pnpm lint && pnpm typecheck && pnpm test && pnpm
          build"; scripts["test:e2e"] = "pnpm --filter @cosmos/web build && pnpm --filter
          @cosmos/e2e test:gate --project=chromium"; apps/web/src/glue/test-hook.ts exists.
RECHECK:  node -e "console.log(require('./package.json').scripts)"; ls apps/web/src/glue/test-hook.ts
VERIFIED: 2026-07-26
```

### The verifier layer

```
CLAIM:    A docs-consistency gate exists (`pnpm check:tasks`) and is RED today. It reports
          one inconsistency: TASK-064 is `done` while its blocker TASK-063 is `pending`.
EVIDENCE: node tools/check-task-index/src/check.mjs → "Task index: 76 tasks (70 done,
          6 pending) / FAIL: 1 inconsistency / • TASK-064: marked done, but blocker
          TASK-063 is 'pending'", exit 1.
RECHECK:  pnpm check:tasks; echo $?
VERIFIED: 2026-07-26
```

```
CLAIM:    That gate runs in neither `pnpm verify` nor CI, so nothing enforces it. Its
          dormancy is deliberate and documented, not neglect.
EVIDENCE: package.json scripts.verify does not include check:tasks; grep of
          .github/workflows/*.yml finds check:bundle but no check:tasks.
          docs/agent-tasks/NOTES-2026-07-22-index-audit.md:32–37 explains the omission:
          "adding it while red would either break the gate or invite weakening the check."
RECHECK:  node -e "console.log(require('./package.json').scripts.verify)";
          grep -rn "check:tasks" .github/workflows/
VERIFIED: 2026-07-26
```

```
CLAIM:    The gate is structurally incapable of catching the largest index defect. It
          parses the table and validates rows against themselves and their linked files —
          it never walks the reverse direction (task files on disk → table), so the nine
          missing TASK-069…077 rows are invisible to it. It counts 76 tasks where 96 task
          files exist.
EVIDENCE: tools/check-task-index/src/check.mjs:12–17 enumerates its five checks (valid
          status / blocker-done ordering / blocker id exists / linked file exists / no
          duplicate ids) — all table-rooted. Run output says "76 tasks";
          `ls docs/agent-tasks/TASK-*.md | wc -l` = 96.
RECHECK:  ls docs/agent-tasks/TASK-*.md | wc -l   # vs the count check.mjs prints
VERIFIED: 2026-07-26
```

### Whether the documented process is actually followed

```
CLAIM:    CLAUDE.md's judgment-call rule is half-obeyed. The "log every judgment call to a
          NOTES file" half is complied with — 6 NOTES files, 5,229 words, one per recent
          task. The "triage each into spec/task bug · executor bug · doctrine gap after
          merge" half has been performed 0 times out of 6.
EVIDENCE: docs/agent-tasks/NOTES-*.md = 6 files. grep -icE "spec/task bug|executor bug|
          doctrine gap" returns 0 for five of them and 1 for NOTES-2026-07-26-task-085.md
          — and that single hit is the instruction restated at line 3–4 ("Triage each
          after merge into exactly one of..."), not a triage verdict.
RECHECK:  grep -c -iE "spec/task bug|executor bug|doctrine gap" docs/agent-tasks/NOTES-*.md
VERIFIED: 2026-07-26
```

```
CLAIM:    Written docs are reached, not abandoned: only 4 of 41 research docs (10%) and 13
          of 96 task files (14%) are unreferenced by any other doc, and the task-file
          orphans are exactly the nine unindexed TASK-069…077 plus four NOTES files (which
          are leaves by design).
EVIDENCE: scripted inbound-link sweep by basename over docs/**.md + CLAUDE.md + README.md.
          Research orphans: e2e-single-spec-smoke-carveout.md,
          nav-controller-10k-look-ci-timeout-rootcause.md, shift-w-speed-surge.md, and this
          file.
RECHECK:  for each docs/research/*.md, grep -l "$(basename f)" across the corpus; empty = orphan
VERIFIED: 2026-07-26
```

## Beliefs (second-class — no mechanical RECHECK; a spec may NOT cite these as Step-0 facts)

- The dead lane-scheduling prose at the top of `agent-tasks/README.md` probably costs more
  agent attention than it saves, but I have no measurement of an agent actually being
  misled by it. It is a plausible cost, not a demonstrated one.
- The 114k words of task history are likely closer to an append-only audit log than a
  reference corpus. I did not measure how often a `done` task file is re-read.

## Step 5 — What I looked for and didn't find

- **No auto-loaded doc bloat.** Looked for repo-level mechanisms that force docs into
  context: `ls .claude/` → only `launch.json` and `settings.local.json`; no
  `settings.json` context/`additionalDirectories` config, no `@`-import chains in
  `CLAUDE.md`. The 203k-word tree is read only on demand.
- **No doctrinal contradiction between the normative docs.** Enumerated the collision
  candidates (CLAUDE.md testing rules vs `testing-conventions.md`; architecture §13 vs
  `testing-conventions.md`; architecture §12 vs `ci.yml`; `agent-tasks/README.md` vs
  architecture/ADRs) and each pair either agrees or states its precedence explicitly.
  The one prior known conflict — `e2e/README.md`'s screenshot taxonomy vs
  testing-conventions — is already resolved in the docs' favor (`e2e/README.md:17` now
  states reference-machine-only).
- **No widespread stale numbers.** Spot-checked every concrete threshold I could bind to
  code (bundle 1.2 MB gz, browser matrix, `verify`/`test:e2e` composition, test-hook path)
  and all matched. The only aspirational-not-real item found was Sentry (architecture §12
  "Sentry release + source maps"), and that is already carved out as TASK-078 `pending`
  with `apps/web/src/glue/report-error.ts:7` documenting the gap in-code.
- **No record of the TASK-069…077 index gap anywhere.** The 2026-07-22 index audit
  (`NOTES-2026-07-22-index-audit.md`) catalogues four open items in detail and this is not
  one of them; `grep -rE "TASK-0(69|7[0-7])" docs/agent-tasks/README.md` → 0. The largest
  routing defect in the system is the one nobody wrote down.

## Step 6 — Verdict: **REFRAME**

**The premise "we have too much documentation and it confuses agents" is false as stated,
and both of its halves fail measurement.** Volume: the unavoidable surface is ~2,487 words
(Q1 claim 1) — an order of magnitude under the kill threshold, and the 203k-word tree is
purely opt-in. Confusion-by-contradiction: the normative docs agree, and where they could
collide they state precedence explicitly (Q2 claim 4). Rot: 3.3% of root-relative path
referents are stale, 3.8% on steered surfaces (Q3 claim 1), and architecture.md's
operational numbers are still exact 16 days after its last edit. Under the kill conditions
written in Step 2, "we have too much documentation" is **killed** on all three counts.

**The real question is different: the documentation is not too big, it is unrouted.** The
defect is concentrated entirely in the one file that decides what an agent does next.
`docs/agent-tasks/README.md` declares itself "the ONLY place progress is tracked" and is
missing nine authored tasks (Q2 claim 1), three of which shipped production code with no
row ever written (Q2 claim 2); its own routing rule points at a task whose Notes say the
work is already done (Q2 claim 3); the automated gate that would catch table defects is red
today, deliberately unwired (verifier claims 1–2), and is structurally blind to the
missing-rows class because it only ever walks table → disk, never disk → table (verifier
claim 3). Alongside it, the second half of CLAUDE.md's judgment-call loop — triage — has
run 0 times in 6 opportunities (process claim 1). Every one of these is a *routing and
enforcement* failure. None is a volume failure.

**Claims a spec writer should lift into Step 0:** Q2 claims 1–3 (the nine-task gap, the
three shipped-but-unrowed tasks, the TASK-063 rule/data conflict) and verifier claims 1–3
(gate red, gate unwired, gate blind to the reverse direction). A task built on this doc
should reconcile the index and extend `check-task-index` with a disk→table check, *not*
consolidate or prune `docs/`. The one thing this research does **not** support is a
documentation-reduction task: there is no evidence for it, and Q3 says the tree an agent
would prune is the part that is still true.

**Deliberately not proposed:** trimming the dead Phase 0–4a lane prose at the top of
`agent-tasks/README.md`. It is a plausible attention cost (see Beliefs) but I did not
measure an agent being misled by it, and acting on it would be exactly the
recommendation-without-evidence this procedure refuses.
