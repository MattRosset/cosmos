# Task: Flush deferred octree tiles during flight (fix black galaxy→starfield fly-in)

**ID:** TASK-079
**Target package:** `apps/web`
**Size:** S
**Phase:** 4
**Depends on:** none (builds on the fix in `1073dbf`, doc `goto-galaxy-transit-black.md`)

## Goal

After this task, flying back **into** the star field from the Milky Way / galactic-survey
scale renders a populated field the whole way in — not a black screen that pops to stars
only on arrival. Today the near-Sol octree tiles evicted during the fly-**out** re-stream
during the fly-**in**, but the mount is deferred until the flight ends, so the field is
empty mid-flight. This is visible on Metal/integrated-GPU (Mac) because the fly-out evicts
harder there; a discrete GPU keeps the tiles resident and never shows it. The fix lets the
existing deferred-mount drain run **during** flight too, under a per-frame cap — it does
**not** delete the throttle. Root cause + risk analysis already done:
`docs/research/galaxy-starfield-flyin-black-flush-during-flight.md` (verdict: ENABLE).
This task is the mechanical remainder — do not re-open the design.

## Step 0 — Verify the spec's facts (re-confirm before editing; code moves)

Written by reading the code on 2026-07-23. Confirm each, and **if reality differs, STOP
and update this spec — do not improvise**:

1. `apps/web/src/scene/GalaxyScene.tsx:444-449` — the deferred-octree drain loop is wrapped
   in `if (!flying)` and contains ONLY that `for` loop (caps at `OCTREE_FLUSH_PER_FRAME`,
   line 133 = `2`). `flying = ctrl?.goToActive ?? false` (line 434).
2. `apps/web/src/scene/GalaxyScene.tsx:386-393` — octree chunks that become `ready` while
   `flightActiveRef.current` push to `deferredOctree` and `return` (do not mount). This
   producer side is **unchanged** by this task; only the drain (step 1) changes.
3. `packages/streaming/src/budgets.ts` — `DEFAULT_BUDGETS.maxInFlight === 6`,
   `maxDrawCalls === 300`, `maxRenderedPoints === 2_000_000`. These bound decode rate and
   render budget upstream (research CLAIM Q2/Q3); they are NOT changed here.
4. `apps/web/src/app/packs.ts:25-26` — `GAIA_OCTREE_MANIFEST_URL` (`export const` on :25)
   reads `import.meta.env.VITE_GAIA_OCTREE_MANIFEST_URL` (:26) at build time. The dense Gaia
   pack used for the manual repro lives (gitignored) at `apps/web/public/packs/octree-gaia/`
   — **1267 tiles** (verify: `ls apps/web/public/packs/octree-gaia/tiles | wc -l`), i.e. the
   complete ~4.6M-star rebuild per `docs/research/gaia-pack-completeness-and-exposure.md §2`.
   NOTE: the inline comment at `packs.ts:22-23` ("octree-gaia (3M/884 tiles)") is STALE —
   it describes an older local pack, not what is installed here; trust the tile count.

## Context (read these first)

- `apps/web/src/scene/GalaxyScene.tsx:386-449` — the deferral (producer) and drain (the edit).
- `docs/research/galaxy-starfield-flyin-black-flush-during-flight.md` — the risk claims this
  task is allowed to rely on (Q2 budget is upstream; Q3 rate is decode-bounded; Q4/Q5 no gate).
- `docs/research/goto-galaxy-transit-black.md` — the sibling fix (`1073dbf`); §"Cause"
  explains why "caps upload cost without blanking what is already on screen" fails once the
  field was evicted.
- `packages/streaming/src/budgets.ts` — the `maxInFlight`/draw/point caps that make the flush safe.

## Frozen — do not touch

- `OCTREE_FLUSH_PER_FRAME = 2` (line 133): the **post-arrival** drain rate stays 2. Do not
  repurpose it for the flight-time rate — add a separate constant.
- `packages/streaming/**` — budgets, eviction, `maxInFlight`. If the fix seems to need a
  streaming-policy change, STOP and mark blocked (that is a different task).
- The deferral producer (`:386-393`). The queue must still exist and still be fed while flying.
- Any `@perf`-tagged spec's thresholds and the `--grep-invert @perf` CI gate definition.

## Out of scope

- Removing the deferral entirely / mounting the whole ready set in one frame (that was the
  throw-away *experiment* used to confirm the cause; the research explicitly keeps a cap for
  hardware weaker than the M1 measured).
- Any change to eviction aggressiveness on the fly-out (a plausible alternate fix; if you
  want it, it is a separate task — do not fold it in here).
- The shader / floating-origin path (`packages/render-stars`) — research ruled it out.
- Touching procgen blend, exposure, or the `system`/`universe` context paths.

*Findings during this task go to `docs/research/`; scope creep goes to a new task file, not
into this diff.*

*Log every judgment call — anything this task didn't decide and you had to — to `NOTES.md`
beside the diff, visibly, as you go (not reconstructed after).*

## Deliverables / Steps

1. Add a flight-time drain-rate constant next to line 133:
   ```ts
   /** Deferred octree drain rate WHILE a goTo flight is active. Higher than the
    *  post-arrival rate so the queue keeps pace with decode (bounded by maxInFlight=6)
    *  and the field never reads black mid-flight; still a hard per-frame ceiling so a
    *  decode burst can't spike GPU upload on weak hardware. See TASK-079 / research doc. */
   const OCTREE_FLUSH_PER_FRAME_FLYING = 8;
   ```
   **Decision (do not relitigate):** 8, not 2. Reusing 2 while flying was rejected — at
   2/frame < the ~6–8/frame decode rate the queue backs up and the field can still read
   sparse on a fast fly-in; only the decode-rate-paced mount was measured to clear the black.
   8 > `maxInFlight` (6) so the cap is effectively "mount what decoded, with a ceiling."
2. Change the drain at `:444-449` to always run, with the cap selected by flight state:
   ```ts
   const flushCap = flying ? OCTREE_FLUSH_PER_FRAME_FLYING : OCTREE_FLUSH_PER_FRAME;
   for (let n = 0; n < flushCap && deferredOctree.current.length > 0; n++) {
     const p = deferredOctree.current.shift()!;
     addMountRef.current(p.chunkId, 'octree', p.batch);
   }
   ```
   i.e. delete the `if (!flying) { … }` wrapper; keep the loop body byte-for-byte.
3. Leave the deferral producer (`:386-393`) untouched — the queue is still fed while flying;
   this task only drains it faster/sooner.
4. `pnpm --filter @cosmos/web typecheck` is clean.

## Failure modes to watch

- **Breaking flythrough4 §5.4 by touching this file.** `git log` shows `1626985` — a prior
  galaxy-render change (procgen LOD) broke the flythrough4 near-Sol budget. This task is
  *safe from that specific gate* because flythrough4 replays its path and **never sets
  `goToActive`** (research CLAIM Q4) → `flying` is always false there → the changed branch is
  inert. Detect: `pnpm --filter @cosmos/e2e exec playwright test flythrough4 --config
  e2e/playwright.dev.config.ts` still green; the `peakSceneDrawCalls ≤ baseline` assert
  (`flythrough4.spec.ts:239`) unchanged.
- **Mistaking a black frame for a good one.** "A black screen has excellent frame times."
  The gate below therefore measures *pixels*, not fps: assert center-patch `lumaMax` rises
  during flight. Do not accept "60 fps, looks fine" without the luma number.
- **Rate too low → still sparse.** If you keep 2/frame while flying, the queue outruns the
  drain and the field is partially black on a fast fly-in. The value is 8 for this reason;
  if the manual repro still shows black at 8, log the observed per-frame mount count and
  queue length to NOTES.md before changing it (do not silently bump it toward ∞ — that
  removes the ceiling the research required).

## Acceptance gate

Deterministic checks the implementer runs; expected outputs stated:

1. `pnpm --filter @cosmos/web typecheck` → exit 0.
2. `pnpm --filter @cosmos/web build` → exit 0.
3. `pnpm --filter @cosmos/e2e test:gate --project=chromium` → green (the blocking gate; runs
   `--grep-invert @perf`). This exercises m3/m4a/flythrough draw-budget + `blankFrames==0`
   asserts (research CLAIM Q4/Q5: all mount-timing-independent, must stay green).

No wall-clock/fps or screenshot is a blocking check (reference-machine only). The luma repro
below is manual PR evidence, not a CI gate.

## Verification beyond the gate

Manual, on this Mac (Metal), against the dense pack — the thing the gate can't see:

1. Build with the dense pack and serve:
   `VITE_GAIA_OCTREE_MANIFEST_URL=/packs/octree-gaia/octree.json pnpm --filter @cosmos/web build`
   then `pnpm --filter @cosmos/web preview --port 4173`.
2. In the page: wait `window.__cosmos.ready`; click `◂ Milky Way` (out), settle, then
   `◂ Galaxy` (in). While flying, sample the center 120×120 patch with `gl.readPixels` and
   wrap `gl.drawArrays` for a point count (method in the research doc).
3. **Pass condition (visibility — the thing this task fixes):** at the black-triggering
   precondition (fly-out evicted hard, `streaming.loadedChunks` bottoms ~204), during the
   fly-in `lumaMax` rises well above the pre-fix floor of **15** (pre-fix it stays 15 =
   black; measured after-fix ~765), and points drawn no longer freeze at ~220k. Record the
   before/after `lumaMax` at the same `outLoaded` in the PR.
   **Frame-timing note (do NOT gate on this):** the fly-in has an intermittent ~65 ms frame
   on this M1/Metal that is **pre-existing** — a `git stash` control of the unmodified code
   shows the same ~65 ms spike (~2 of 3 fly-ins), so it is NOT introduced by this change and
   is out of scope (logged in NOTES.md). The bar is therefore *no worse than baseline* and
   *no frame > 150 ms* (the breadcrumb-perf `MAX_FRAME_MS`), **not** "0 frames > 50 ms".
4. Confirm the *out* trip and a repeated in/out cycle are unaffected, and that the
   post-arrival view is identical to before (same resident tile count at rest, ~1268).
