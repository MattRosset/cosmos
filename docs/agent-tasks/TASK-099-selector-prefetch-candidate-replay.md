# TASK-099: Replay visibility-aware selector and prefetch candidates

**Initiative:** visibility-aware galaxy streaming (VIS-03)  
**Size:** L  
**Class:** bounded research/prototype with independent GO/STOP verdicts  
**Depends on:** TASK-098 (hard block), full local Gaia pack (present — see below)

**Runtime only.** Every candidate here changes what the selector *fetches*, never what the pack
*stores*: same v1 tiles, no byte changed on disk. So this task neither gates nor is gated by
re-packing. P1 (subtree `minAbsMag`) moved to TASK-101 for the mirror-image reason — a manifest
field is a format change.

Both this task and TASK-101 sit behind the value work (TASK-097, TASK-100, the Survey mode) and
behind a measurement of what the full pack actually costs on the floor device.

**Current checkout status: NOT blocked.** The full pack is present locally at
`apps/web/public/packs/octree-gaia/octree.json` (1,267 tiles / 1,093 leaves, 1,267 binaries in
`tiles/`) — it is merely **git-ignored** (`.gitignore:27`), so `git ls-files` shows nothing.
Do not conclude "absent" from git. The app's *default* manifest URL is the committed sample
(`apps/web/src/app/packs.ts:27`), so the live TASK-098 baseline for this task must be captured
with `VITE_GAIA_OCTREE_MANIFEST_URL=/packs/octree-gaia/octree.json`. If the directory is truly
missing on the executing machine, STOP; never substitute the 135-star sample.

## Goal

Build a deterministic offline replay over the real HYG + full Gaia v1 packs and produce
`docs/research/galaxy-selector-prefetch-candidate-replay.md`. Compare current DFS/SSE demand,
frustum margins, and complete best-first frontiers against production photometry and live
snapshot baselines.

The output contains separate **GO** or **STOP** verdicts for:

1. bounded orientation-aware v1 selection;
2. a rotation prefetch ring.

No candidate is production-approved before this task. STOP is a successful terminal result.

**No photometric candidate is in this task.** P0-P3, including subtree `minAbsMag`, all live in
TASK-101: every one of them is a question about what the pack stores, and this task is only
about what the runtime selects from a pack that already exists.

## Step 0 — verify the spec's facts

Before writing the replay, re-confirm:

1. TASK-098's `galaxyWorkingSet()` returns live camera/profile, policy target/residency, draw
   and perceptible counts, and update/render sequence IDs in one call.
2. The Gaia manifest at `apps/web/public/packs/octree-gaia/octree.json` still reports 1,267
   tiles / 1,093 leaves with all 1,267 binaries present, and is the same pack the live TASK-098
   baseline was captured against (that baseline must be captured with the env var above, since
   the app default is the sample). Another immutable path is accepted by the fingerprint rule
   below. Never substitute the 135-star committed sample.
3. `packages/data/src/octree-decode.ts` exports the production v1 decoder, and
   `packages/core-types/src/octree.ts` still defines format version 1.
4. `packages/streaming/src/policy.ts` current fresh selection still traverses from the root,
   marks every visited node desired, descends by SSE `> 8 × 1.15`, and dispatches before budget
   enforcement.

Decision rule for pack identity:

- Prefer the exact manifest URL/path used by the live baseline.
- For a local mirror, require matching manifest SHA-256, tile count, point counts, tile byte
  lengths, and every `contentHashSha256`; ETags do not apply to local files.
- For a URL mirror, additionally record and compare ETags when supplied by the host.
- Otherwise STOP; mixed or sample data cannot support a GO verdict.

## Context — read first

- `docs/research/galaxy-octree-streaming-value-near-sol.md` — verified mechanism, measurements,
  and explicit requirement for this comparison.
- `docs/decisions/ADR-007-star-visibility-modes.md` — Natural/Survey effective exposures.
- `docs/agent-tasks/TASK-095-NOTES.md` — antichain normalization was killed; do not revive it.
- `packages/streaming/src/policy.ts`, `sse.ts`, and `budgets.ts` — baseline behavior and current
  limits to replay.
- `apps/web/src/glue/tile-frustum-cull.ts` — production conservative sphere/frustum predicate.
- `packages/photometry/src/index.ts` — production apparent-brightness/perceptibility oracle.
- `packages/data/src/octree-decode.ts` — production v1 bytes-to-batch path.
- `apps/web/src/glue/octree-combined.ts` — HYG/Gaia key union and push-down rules that baseline
  parity must honor.

## Frozen — do not touch

- Production app, streaming policy, render/pick behavior, manifests, binaries, budgets, and
  default asset URLs.
- FOV 60°, viewport 1280×720 for deterministic offline comparisons, floor `0.004`, Natural
  effective octree exposure 150, Survey effective octree exposure 1000.
- Current selector baseline and current combined-source semantics.
- Complete-frontier invariant: expansion atomically replaces one parent with all existing
  children only when both caps still hold. An unexpanded parent remains coverage.
- Candidate tie-breaks are deterministic; no wall-clock result is a CI gate.
- TASK-095 remains observe-only. A candidate may measure ancestor/descendant overlap but may not
  enable the killed antichain behavior.

## Out of scope

- Shipping a selector, passing camera inputs into policy, prefetch scheduling, or changing
  request priority (VIS-07+).
- Per-tile magnitude bands and bright-prefix bands (former P2/P3) — TASK-101.
- Designing v2 storage, HTTP ranges, schemas, writers, loaders, sidecars, or mounts (VIS-11+).
- Choosing production caps merely because one matrix cell is fastest.
- Screenshots or subjective visual scoring as blocking evidence.
- Testing the committed Gaia sample as a proxy for the full pack.

Findings during this task go to `docs/research/`; scope creep goes to a new task file, not
into this diff.

## Deliverables / steps

**Log every judgment call — anything this task didn't decide and you had to — to
`docs/agent-tasks/TASK-099-NOTES.md` beside the diff, visibly, as you go (not reconstructed
after).**

1. Create `tools/analyze-galaxy-working-set` with:
   - dependencies on `@cosmos/core-types`, `@cosmos/data`, `@cosmos/photometry`, and
     `@cosmos/streaming`;
   - dev dependencies on `@types/node` and `tsx`;
   - scripts `"build": "tsc --noEmit"`, `"typecheck": "tsc --noEmit"`,
     `"test": "vitest run --coverage"`, and `"analyze": "tsx src/cli.ts"`;
   - node Vitest environment, `src/**/*.ts` coverage, and statements threshold 85.
   Keep candidate traversal inside the tool; do not export it from production packages. Emit
   stable JSON with sorted keys/arrays plus a human-readable summary. The CLI requires explicit
   HYG manifest, Gaia manifest, live-snapshot JSON, and output paths; no hidden defaults.
2. Reproduce the current combined v1 baseline first.
   - Union HYG/Gaia spatial keys with the same shallower-source push-down semantics as
     `octree-combined.ts`.
   - Decode through `@cosmos/data`; do not hand-decode SoA bytes.
   - At Sol `[0, 0, 0.06]`, reproduce visited 1,267 and cut 1,093 octree nodes, with separately
     reported HYG/Gaia contributions.
   - Cross-check against a settled live `galaxyWorkingSet()` sample: octree-only visited count,
     exact cut-key set, per-key selection count, combined decoded count, CPU bytes, and GPU
     estimate.
   - Report HYG and Gaia decoded contributions from the offline source-separated replay and
     assert their sum equals its offline combined result. Do not claim the live snapshot exposes
     per-source counts.
   Any mismatch must be explained and resolved before candidate work.
3. Use this deterministic pose matrix:
   - positions: Sol `[0,0,0.06]`;
   - for radii 3,440 pc, 6,000 pc, and 18,000 pc, all six axis positions
     `[±r,0,0]`, `[0,±r,0]`, `[0,0,±r]`;
   - orientations at every position: yaw
     `[-180,-135,-90,-45,0,45,90,135]` degrees crossed with pitch `[-45,0,45]`;
   - roll 0°, vertical FOV 60°, viewport 1280×720.
   Convert yaw/pitch using the navigation convention
   `q = qYaw(world +Y) × qPitch(local +X)`, roll zero, with camera forward
   `q × [0,0,-1]`. Convert degrees once to radians and unit-test six cardinal forward
   directions before running the matrix.
   Print the exact pose for every failed invariant.
4. Define the perceptible-recall oracle per pose:
   - define `StarIdentity = \`${idPrefix}:${catalogId}\``, where `idPrefix` is
     `OctreeManifest.idPrefix`, never `OctreeManifest.source`;
   - decode HYG and Gaia source tiles separately and retain each source's `idPrefix` through
     push-down; never derive identity from a concatenated combined batch's `idPrefix`;
   - baseline is the unique `StarIdentity` set from the current settled v1 cut whose point
     is inside the production frustum and perceptible through `@cosmos/photometry`;
   - internal/leaf duplicates count once by identity;
   - malformed/non-finite points are listed and make the verdict STOP, not silently dropped;
   - candidate recall is intersection with that same identity set.
   Import the existing DOM/THREE-free `tileOutsideFrustum` implementation and call it with
   `radiusPc = 0` for per-point membership and the real node radius for node tests. Do not copy
   its quaternion or side-plane equations into the tool. Tests never rederive projection or
   photometry outside production helpers.
5. Replay these spatial candidates exactly:
   - **S0:** current orientation-blind DFS/SSE baseline;
   - **S1:** strict current frustum before DFS/SSE;
   - **S2:** frustum half-angle margins `15°`, `30°`, and `60°`;
   - **S3:** complete best-first frontier for these three cap pairs only —
     `(nodes 128, points 500000)`, `(nodes 256, points 1000000)`, `(nodes 512, points 2000000)`.
     This task decides *whether a bounded frontier can hold recall*, not which cap ships (see
     Out of scope). If the three pairs disagree about the verdict, run the full
     `[64,128,256,512] × [250000,500000,1000000,2000000]` sweep **at Sol only** to locate the
     boundary, and say so in the research document; do not run the full sweep over the pose
     matrix.
   S3 builds a globally complete current frontier from the root. Expansion atomically replaces
   a parent with all existing children only when the resulting current frontier remains within
   both caps. Priority is lexicographic:
   1. intersects current frustum;
   2. smaller angular distance from node center to camera forward;
   3. higher SSE;
   4. lexical Morton key.
   For S2, run strict and expanded-frustum traversals separately. Strict-frustum results are
   current demand; keys admitted only by the expanded traversal are prefetch-only demand.
   For each 15°/30°/60° margin, build a separate prefetch refinement from that completed current
   frontier. Prefetch uses the same node/point cap pair as its own cap, may retain current
   parents as ready fallback, and never removes or displaces current entries. Report current,
   prefetch-only, and unique-union resources separately.
   For S3, prefetch caps charge only unique prefetch-only resources: node count is added keys and
   point count is their summed `selectionPointCount`. Current parents remain current fallback and
   are not charged to the prefetch cap. Accept an expansion only when all newly added children
   fit both prefetch caps.
6. Evaluate the Sol rotation trace at pitch 0° and yaw
   `[0,15,30,45,60,75,90,105,120,135,150,165,180]`.
   - For each candidate/margin, report current keys/bytes, prefetch-only keys/bytes, unique
     current+prefetch bytes, newly demanded keys/bytes from the previous step, recall, and coarse
     fallback use.
   - A margin passes deterministic in-ring coverage only if every next 15° step's required
     current keys were already current or prefetched at the previous step.
   - An abrupt 180° turn is explicitly out-of-ring: report missing detail, but require a
     non-empty ready coarse frontier on the first candidate state.
7. Pre-register reference-machine rotation evidence before inspecting candidate results:
   - use the live app and TASK-098 snapshots to measure baseline first-perceptible-detail latency
     over the same 15° trace;
   - write the baseline and target
     `p95 <= max(250 ms, baseline p95 × 1.25)` into the research document before running
     candidates;
   - keep this target out of CI. The deterministic prefetch-subset invariant is the blocking
     proxy.
8. (Photometric candidates moved to TASK-101 — see the header note. Nothing to do here.)
9. Apply independent verdicts:
   - **Selector GO** only if one candidate has 100% recall over the full pose matrix, reduces
     Sol current+prefetch unique tile bytes by at least 50% versus S0, and never exceeds S0
     selected bytes by more than 10% at any 3.44/6/18 kpc pose.
   - **Prefetch GO** only if one measured margin passes every 15° subset invariant and retains a
     non-empty coarse frontier for abrupt out-of-ring turns.
   - Any malformed identity/data, combined-source mismatch, recall miss, or unexplainable live
     baseline mismatch forces the affected verdict to STOP.
   - Report both verdicts **per profile**. The Natural profile (effective octree exposure 150)
     is the shipped default and is where a photometric reduction can exist; Survey (1000) is
     expected to pay close to full price. A candidate that wins only in Natural is a legitimate
     GO — say so explicitly instead of averaging the two.
10. Write `docs/research/galaxy-selector-prefetch-candidate-replay.md` in the research skill's claim
    format. Include commands, immutable input fingerprints, complete result JSON path,
    recheck instructions, rejected candidates, threshold sensitivity, and the three verdicts.
    Do not write implementation tasks for any STOP branch.

## Failure modes to watch

1. **A replay that models a different app.** Prior work showed combined-source push-down and
   BUG-8 conservation are easy to miss. Detection: exact selected-key/point/byte cross-check
   against TASK-098 before candidates.
2. **False recall from duplicate LOD representatives.** Counting array slots can hide a missing
   catalog identity or penalize expected duplication. Detection: dedupe by `StarIdentity`
   (`${idPrefix}:${catalogId}`) and report duplicate counts separately.
3. **A frontier with holes.** Stopping after popping a parent and before all children fit loses
   spatial cover. Detection: atomic replacement plus a fixture asserting every leaf has exactly
   one frontier ancestor.
4. **Prefetch counted as rendered correctness.** Prefetch cannot repair a current-cut recall miss.
   Detection: current and prefetch identity/byte sets remain separate in every result.
5. **Machine timing promoted to a deterministic gate.** Detection: CI asserts subset/recall/byte
   invariants only; p95 stays reference evidence.

## Acceptance gate

- Tool unit tests cover baseline DFS parity, frustum margins, atomic frontier coverage,
  deterministic tie-breaks, AABB nearest distance, malformed magnitude handling, and identity
  deduplication.
- Running the tool twice against identical inputs produces byte-identical JSON and verdict text.
- Sol baseline matches 1,267 visited / 1,093 cut nodes and the live TASK-098 selected-key,
  point, and byte census.
- Every matrix row logs pose, profile, candidate, recall numerator/denominator, current/prefetch
  bytes, request count, and fallback state.
- `pnpm --filter @cosmos/analyze-galaxy-working-set test` exits 0.
- `pnpm --filter @cosmos/analyze-galaxy-working-set typecheck` exits 0.
- The analysis command is explicit and recorded:
  `pnpm --filter @cosmos/analyze-galaxy-working-set analyze -- --hyg-manifest <path> --gaia-manifest <path> --live-snapshot <path> --out <path>`.
- `pnpm verify` exits 0.
- Production source and pack assets have no diff.

## Verification beyond the gate

Run the reference rotation trace once in the built preview, not the HMR dev server, and attach
the baseline/candidate latency distribution to the research document. Visually confirm only that
the measured frames are non-black before trusting latency. Screenshots and p95 do not block CI.
