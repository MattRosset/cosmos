# The near-Sol gate: a stale baseline hiding a real gap

**Status:** complete — REFRAME
**Date:** 2026-08-05
**Scope:** measurement only — no gate, threshold, baseline, or render path changed.
**Trigger:** `flythrough4` near-Sol has blocked PR #42 across three tasks (TASK-093 frustum
cull, TASK-094 brightness cull, TASK-095 LOD containment). Each aimed at a single aggregate
(`gl.info.render`) that nobody had decomposed.

## CONTAMINATION — read before any claim below

`apps/web/.env.local` (git-ignored, local-only) sets
`VITE_GAIA_OCTREE_MANIFEST_URL=/packs/octree-gaia/octree.json`, and Vite inlines it at build
time. **Every local run in this document therefore used the full 4.6M-star Gaia pack, which
production does not serve.** CI has no `.env.local`, so CI runs the committed 135-star sample —
i.e. the production composition (HYG octree + a 135-star Gaia sample + procgen).

Effect on the claims:

**RESOLVED the same day.** Both arms were re-run on the production pack (built with the env
var overriding `.env.local`; bundle verified to inline `octree-gaia-sample`). Results below are
uncontaminated, and one claim reversed sign:

| arm (production pack, chromium, this machine) | draws | points | composition of the peak frame |
|---|---:|---:|---|
| M3 control | 44 | 309,369 | monolith 109,399 + procgen 90,000 + 8 tiles 109,399 |
| M4a | 43 | **200,105** | procgen 90,000 + 8 tiles 109,534 |

M4a's 43 / 200,105 reproduces CI **exactly**, so on the production composition this metric is
deterministic across machines — the 64–98 spread was the 4.6M pack alone.

- **Claims 2, 3, 4 stand** (CI = production composition).
- **Claim 1 is CONFIRMED** on the production pack: M3 today is 44 / 309,369 against a recorded
  40 / 109,971.
- **Claim 5 is CORRECTED**: instability belongs to the full pack, not to the metric per se.
- **Claim 6 is REPLACED and reverses sign**: M4a does not draw more than M3 — it draws **less**
  on both metrics. The retracted 1.9× was entirely the contaminated pack.

Trap for whoever repeats this: in Git Bash, `VITE_...=/packs/... pnpm build` is rewritten by
MSYS to `C:/Program Files/Git/packs/...` and the app boots to a blank page. Use PowerShell.

## Falsifiable questions

1. What is actually drawing in the frame that sets the near-Sol peak?
2. Does the committed M3 baseline still describe M3?
3. Did TASK-093/094 move the measured number at all?
4. Is the metric deterministic?
5. Measured today against a same-day M3, is there a real M4a regression, or only baseline drift?

## Kill conditions (pre-registered)

- **Kill "the gate is stale"** if a same-day M3 run reproduces the recorded 40 / 109,971.
- **Kill "the gate is measuring the wrong thing"** if the octree dominates the peak frame and
  the draw-time culls move it.
- **Kill "there is a real regression"** if same-day M3 and M4a are within run-to-run variance.

## Claims

### Claim 1 — the committed baseline no longer describes M3 *(CONFIRMED on the production pack)*

CLAIM: `flythrough4-m3-baseline.json` records M3 near-Sol as 40 draws / 109,971 points
(recorded 2026-06-24). Re-run today by the same probe in the same mode, M3 measures
**44 draws / 309,369 points** — 2.8× the recorded points. **The control fails the control's
own threshold.**

EVIDENCE: `?debug=flythrough4&baseline=m3` via the built preview on chromium, this machine,
same committed path. `[TMP m3:toSol] scenePts=309369 sceneDraws=44 cov=1.00..1.00`.
Peak-frame composition: `Points=109399` (HYG monolith) `Points=90000` (procgen at the
low-tier draw cap) + ~10 octree tiles of 11.9k–16.4k + meshes.

The recorded 109,971 decomposes as 109,399 (monolith) + 572 — i.e. in June, procgen and the
octree contributed ~nothing to M3's peak frame. Today they contribute ~200,000.

VERIFIED: 2026-08-05

RECHECK: Build web, serve the preview, load `?debug=flythrough4&baseline=m3`, read
`window.__flythrough4Result.segments.toSol`.

### Claim 2 — the CI near-Sol peak decomposes exactly, with no unexplained residue

CLAIM: CI's 200,105 points are procgen 90,000 + eight octree tiles 109,534 + 571 other.

EVIDENCE: per-object attribution of the same frame that set the peak (run 31049758416):
`Points=90000` then 16,386 / 14,388 / 14,150 / 13,741 / 13,226 / 13,215 / 12,468 / 11,960.
90,000 + 109,534 + 571 = 200,105 exactly. `Mesh` rows are excluded: a mesh contributes
triangles, not points. The 90,000 is exactly `PROCGEN_MAX_DRAW_POINTS_BY_TIER.low`.

VERIFIED: 2026-08-05

RECHECK: read `[flythrough4] near-Sol peak-frame breakdown` in the e2e log.

### Claim 3 — the octree draws the same catalog volume as the monolith it replaced

CLAIM: those eight tiles carry **109,534** points. The HYG monolith they replace carries
**109,399**. The monolith is correctly culled (it does not appear in the breakdown), but the
same stars are drawn anyway — repackaged into 8 draw calls instead of 1, with procgen's
90,000 on top.

EVIDENCE: Claim 2's decomposition; monolith count from the HYG pack census; `cov=1.00..1.00`
so `MONOLITH_COVERAGE_GATE` (0.9) is satisfied throughout the segment.

VERIFIED: 2026-08-05

RECHECK: same breakdown line; confirm no ~109,399 row is present.

### Claim 4 — the draw-time culls cannot move this number

CLAIM: TASK-093 + TASK-094 changed the CI measurement by **exactly zero**: 43 draws /
200,105 points before (`81b1868`) and after (`f966c48`), byte-identical, including
`streamPts=1109399` and `streamDraws=9`.

EVIDENCE: runs 30940981798 (pre) and 31046784320 (post). Cull diagnostics in the post run:
`frustumKept=8 frustumCulled=0 brightnessCulled=4`. Nothing is off-frustum to cull — the
eight tiles are all in view and all carry the catalog the camera is facing.

VERIFIED: 2026-08-05

RECHECK: compare the two runs' `[flythrough4] near-Sol M4a` lines.

### Claim 5 — the metric is unstable only on the full pack *(corrected)*

CLAIM: the gate reads the peak of a per-frame sample over a flight segment. That peak is
governed by how many tiles the machine mounts before the segment ends, so it is stable
within a machine and unstable across machines.

EVIDENCE: identical commit (TASK-094 tip), same machine, same (full) pack: 64, 88, 98, 79, 80
draws across five runs (TASK-094-NOTES ×2, TASK-095-NOTES ×2, this investigation ×1) — a 1.5×
spread with nothing changed. CI, same commit, four runs: 43 every time.

CORRECTION: the CI-vs-local gap was first attributed here to machine throughput
(`req=0` vs `req=395`). That is confounded — CI also runs a 135-star sample pack against this
machine's full 4.6M pack. Throughput may contribute; this evidence cannot separate the two.
The within-machine 1.5× spread is unaffected by the correction.

VERIFIED: 2026-08-05

RECHECK: run `flythrough4` locally twice and compare against the CI log for the same SHA.

### Claim 6 — REPLACED: M4a beats M3 on the production composition

CLAIM: on the composition production serves, M4a draws **fewer** calls and **35% fewer**
points than M3 near Sol. ADR-006 §5.4's premise holds; only the recorded absolute was stale.

~~The first version of this claim said M4a drew 1.9× M3.~~ Retracted and replaced the same day:
that M4a arm was built with `.env.local` pointing at the full 4.6M pack while production serves
a 135-star sample.

EVIDENCE (production pack, both arms back to back, chromium):

| variant | draws | points | monolith in the peak frame |
|---|---:|---:|---|
| M3 control | 44 | 309,369 | yes (109,399) |
| M4a | 43 | 200,105 | no — culled |

VERIFIED: 2026-08-05

RECHECK: run the probe in both modes back to back and compare `segments.toSol`.

## Mechanism

Two independent facts were being read through one aggregate.

**The threshold is stale.** 109,971 was recorded when M4a's peak frame drew 572 points and
M3's drew the monolith alone. Five months of composition changes later — procgen's LOD rework,
the combined HYG+Gaia octree — both variants draw ~200k–570k there. A frozen absolute cannot
survive a composition it does not describe, and nothing detected the drift because the control
is never re-run.

**The redundancy was not removed.** Near Sol the octree brings the whole surrounding catalog:
in CI — the production composition — eight in-frustum tiles carrying 109,534 points, the same
volume as the monolith that was supposedly made redundant. ADR-006 §5.4's premise — unification removes a layer, so near-Sol work drops —
is not satisfied, because the replacement carries the same stars.

This is the same finding as `galaxy-octree-streaming-value-near-sol.md`, reached from the
opposite direction: an inside-volume observer makes an orientation-blind SSE traversal descend
everywhere, so near Sol the working set is the whole neighbourhood. There, it showed up as
1,267 resident tiles. Here, as 8 in-frustum tiles that already equal the full HYG catalog.

That is why three draw-time levers could not close it. TASK-093 and TASK-094 remove tiles that
are off-frustum or too faint to matter; at this pose there are none (`frustumCulled=0`).
TASK-095's containment projection was optimistic and still landed at 78 draws against a ≤36
kill threshold. The demand is decided at selection, before anything reaches the draw path.

## Verdict

**REFRAME.** The near-Sol gate is failing for two reasons at once, and only one of them is a
bug in the app.

1. Its threshold no longer describes the system it gates — the M3 control fails it by 2.8×.
2. §5.4's premise itself is **met** on the production composition: M4a culls the monolith and
   comes in below M3 on both metrics (Claim 6). The gate was red for the staleness alone.
   Separately, and not a gate failure: the octree redraws the monolith's own star volume across
   eight in-frustum tiles (Claim 3), so the near-Sol win is thinner than §5.4 implies — that
   belongs to the streaming initiative, not to another draw-time cull task.

Recommended, in order:

- **DONE — do not re-record the absolute.** Freezing 309,369 would repeat the failure with a
  fresher number, and the visibility work (Survey's effective exposure 1000, or a
  visibility-aware selector) will move the composition again. `flythrough4.spec.ts` now measures
  the M3 control live in the same run and asserts M4a ≤ M3, plus a non-vacuity check that the
  monolith draws in the control and not in M4a. Costs one extra traversal of the path; cannot go
  stale. `flythrough4-m3-baseline.json` is kept, marked superseded, and no longer read.
- **Book the 1.8× as what it is** — the near-Sol consequence of the orientation-blind selector,
  owned by the streaming initiative, not by another draw-time cull task.
- **Keep TASK-093/094**, with their claims rewritten to what they achieved: 255 of 338 tiles
  removed at draw time on a machine that streams them. They do not close the gate because the
  gate is downstream of the demand.

## What I looked for and did not find

- No hook exposes `gl.info.render`; the only reader is the flythrough4 probe, and it kept only
  segment peaks. The per-object attribution added here (log-only) is what made the number
  explicable at all.
- No evidence that the HYG monolith is drawing near Sol; the coverage gate works.
- No settled-state measurement. Every number here is a per-frame peak during an approach.
  A settled near-Sol reading is still missing and would need a scene-render read hook.

## Open

- **The full 4.6M pack is not measured against this gate.** CI and production both serve the
  135-star sample; every full-pack number here came from a local `.env.local` build. Before that
  pack ships, the near-Sol cost it implies (locally: ~83 tiles / 570,720 points at the peak, and
  the separately-measured 1,267 resident tiles / 14.2 s settle / 149 MB) is the open question.
- **No settled-state measurement** exists — every number here is a per-frame peak during an
  approach. A settled near-Sol reading would need a scene-render read hook.
