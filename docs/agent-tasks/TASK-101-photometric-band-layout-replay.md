# TASK-101: Replay photometric band layouts (split out of TASK-099)

**Initiative:** visibility-aware galaxy streaming (VIS-03b)
**Size:** M
**Class:** bounded research with a single GO/STOP verdict
**Depends on:** TASK-097 (hard block — the photometry oracle). **NOT** TASK-099.

**Dependency corrected 2026-08-06:** this no longer waits on TASK-099. Pack format and runtime
selection are independent questions — TASK-099's candidates (frustum margins, best-first
frontier, prefetch) read the same v1 tiles and change no byte on disk, so nothing they conclude
changes what this task measures. P1 (subtree `minAbsMag`) moved here from TASK-099 for the same
reason: a manifest field is a format change.

**Not scheduled next.** Briefly planned as the critical path when re-packing was to precede
hosting the 4.7M pack; that ordering was dropped the same day. Run this when the pack-format
question is actually the next thing worth answering — after the value work (TASK-097, TASK-100,
the Survey mode) and after the cost of the full pack has been measured on the floor device.

## Goal

Extend `tools/analyze-galaxy-working-set` with per-tile photometric band layouts and produce
`docs/research/galaxy-photometric-band-replay.md` with one **GO** or **STOP** verdict for
photometric bands as a v2 pack direction.

## Why this is a separate task

It was step 8 of TASK-099. Split on 2026-08-05, then promoted to the critical path on
2026-08-06. Two caveats from the split still stand and are worth re-reading before executing:

1. **It measures an undesigned format.** Band bytes depend on a v2 storage layout, request
   granularity, and descriptor overhead that is explicitly `unknown — deferred to VIS-11`. The
   only honest output is an optimistic payload lower bound. That is still decision-useful — a
   layout that cannot win even at its lower bound is dead — but it must never be reported as a
   byte saving.
2. **It only pays in Natural.** ADR-007 item 9: Survey's effective octree exposure of 1000 lifts
   most of the faint tail above the same floor, so band rejection largely evaporates there. The
   verdict is per profile.

A **STOP** here is a good outcome, not a failure: it means the v1 format stands, no re-packing
is needed, and the existing 4.7M pack can be hosted as-is.

## Step 0 — verify the spec's facts

1. `packages/photometry/src/index.ts` exports `starIsPerceptible` and both profiles (TASK-097).
2. `packages/data/src/octree-decode.ts` exports the production v1 decoder and
   `packages/core-types/src/octree.ts` still defines format version 1.
3. This task now builds `tools/analyze-galaxy-working-set` itself (TASK-099 no longer precedes
   it). Take the tool skeleton, pose matrix, `StarIdentity` rule, and combined-source baseline
   parity from TASK-099 steps 1-4 — they are specified there and are not re-specified here.
   Cross-check the offline baseline against the live app with the EXISTING streaming hooks
   (`window.__cosmos.streaming.{loadedChunks,trackedChunks,cutSize}`), the same way
   `docs/research/galaxy-octree-streaming-value-near-sol.md` did; TASK-098 is not required.
4. The full Gaia pack is available (see TASK-099's status note: present but git-ignored; the live
   app needs `VITE_GAIA_OCTREE_MANIFEST_URL=/packs/octree-gaia/octree.json`).

## Frozen — do not touch

- Everything TASK-099 froze: production app, packs, budgets, FOV 60°, viewport 1280×720, floor
  `0.004`, Natural 150 / Survey 1000, deterministic tie-breaks.
- TASK-099's baseline, pose matrix, identity rule, and GO candidates are inputs, not subjects of
  re-litigation. Reproduce its numbers before extending; a mismatch is a STOP.

## Out of scope

- Designing or implementing v2 storage, HTTP range requests, schemas, writers, loaders,
  sidecars, or mounts (VIS-11+).
- Re-running or re-tuning spatial candidates.
- Any production diff. This task adds tool code and one research document.

## Deliverables / steps

**Log every judgment call to `docs/agent-tasks/TASK-101-NOTES.md` beside the diff, as you go.**

1. Over the **current** (unchanged) v1 selection at every pose in the matrix, simulate:
   - **P0:** whole v1 tile (baseline);
   - **P1:** subtree `minAbsMag` rejection, using point-to-node-AABB minimum distance. Compute
     the exact finite subtree minimum offline from the decoded tiles; the field does not exist
     in the v1 manifest today, and whether to add it is what this measurement informs;
   - **P2:** per-tile absolute-magnitude bands, boundaries `[-∞,-2,0,2,4,6,8,10,12,+∞]`;
   - **P3:** per-tile deterministic bright-prefix bands, cumulative boundaries
     `[256,1024,4096,all]`, sorted by `(finite absMag ascending, idPrefix, catalogId)`.
2. For every tile/band compute camera-to-AABB minimum distance, clamped to `0.001` pc. Request a
   band iff `starIsPerceptible` says its finite minimum absolute magnitude could reach the active
   profile's floor at that distance. P2 uses the lower finite magnitude present in each non-empty
   band; P3 uses each non-empty band's actual minimum. Malformed magnitudes force STOP — list
   them, never drop them silently.
3. Report separately, per profile and per pose: requested bands, request count, exact identity
   recall, and an ideal contiguous SoA payload lower bound of exactly 28 bytes per requested
   point (3×f32 position plus four u32/f32 scalar attributes). Report descriptor/hash overhead as
   `unknown — deferred to VIS-11`. Do not invent schema-dependent bytes or claim HTTP
   feasibility.
4. **minAbsMag GO** if P1 alone cuts requested Natural Sol-trace tiles by at least 25% at exact
   identity recall. It is the cheapest format change by far — one number per node in the
   manifest, tile binaries untouched — so it is judged on its own before the band layouts.
5. **Bands GO** only if P2 or P3 keeps Natural Sol-trace payload bytes at or below 50% of P0
   **and** settled Survey reproduces the exact S0 perceptible identity set at every pose. Report
   the Survey cost honestly even when it approaches P0 — that is the expected result, not a
   failure to explain away.
6. Write `docs/research/galaxy-photometric-band-replay.md` in the research skill's claim format:
   commands, immutable input fingerprints, result JSON path, recheck instructions, rejected
   layouts, threshold sensitivity, and the verdict. Do not write implementation tasks for a STOP.

## Failure modes to watch

1. **Optimistic band bytes reported as savings.** Detection: payload, descriptor/hash overhead,
   and request count appear as three separate numbers, and every headline figure is labelled an
   ideal lower bound.
2. **Request-count blindness.** A layout that halves bytes while tripling requests may be worse
   in practice. Detection: request count is a first-class reported column, not a footnote.
3. **Recall loss hidden by duplicate LOD representatives.** Detection: reuse TASK-099's
   `StarIdentity` dedupe; do not re-derive it.
4. **Averaging the two profiles.** Detection: every result table has a profile column.

## Acceptance gate

- Tool unit tests cover band assignment, band-minimum magnitude selection, malformed magnitude
  ordering, AABB nearest distance, and payload-byte accounting.
- Running the tool twice against identical inputs produces byte-identical JSON and verdict text.
- TASK-099's P0 numbers are reproduced exactly before any band result is reported.
- `pnpm --filter @cosmos/analyze-galaxy-working-set test` and `typecheck` exit 0.
- `pnpm verify` exits 0. Production source and pack assets have no diff.
