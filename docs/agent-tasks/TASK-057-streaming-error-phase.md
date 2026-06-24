# Task: `streaming` v1.2 — error lifecycle phase + abort/fail split + backoff + counters

**ID:** TASK-057
**Target package:** `packages/streaming`
**Size:** M
**Phase:** H — Hardening track; §7-sensitive **single lane** (do not run other streaming work alongside)
**Depends on:** TASK-054 (the `error` phase + `AppError`), TASK-055 (`reportError`)

## Goal

Stop the streamer from silently swallowing load failures (audit §3.1 — the structural root
of BUG-6). Today both load paths do `.catch(() => onError(c))` and `onError` just removes the
chunk so it is re-requested ~6×/frame forever, with **no event, no log, no counter**. After
this task:

1. A failed octree/procgen load **distinguishes abort/cancel from a real failure** (an
   aborted in-flight tile is normal during navigation and must NOT be reported as an error).
2. A real failure **emits a `ChunkLifecycleEvent{phase:'error', error:AppError}`** (TASK-054)
   AND calls `reportError(err,'streaming',{chunkId,kind,lod})` (TASK-055, deduped on its side).
3. A repeatedly-failing chunk **backs off** instead of storming: after `MAX_LOAD_ATTEMPTS`
   it is marked `failed` and is NOT re-requested until its inputs change (kills the
   6-requests/frame loop even if the underlying fetch stays broken).
4. `StreamingStats` gains **`errorCount` + `failedChunks`** so the app HUD and the gate
   (TASK-059) can read "something is wrong" deterministically.

## Frozen Interface

```ts
// packages/streaming/src/policy.ts  (MODIFY — additive to the package's own v1.2 surface)

// ADD to StreamingStats (do not change existing fields):
export interface StreamingStats {
  readonly inFlight: number;
  readonly loadedChunks: number;
  readonly renderedPoints: number;
  readonly drawCalls: number;
  readonly gpuBytesEstimate: number;
  readonly requestsThisFrame: number;
  readonly cancelledThisFrame: number;
  /** Monotonic count of REAL load failures (aborts/cancels excluded) since creation. */
  readonly errorCount: number;
  /** Chunks currently in the `failed` terminal state (backed off, not retrying). */
  readonly failedChunks: number;
}
// StreamingPolicy interface, onChunk, etc. are otherwise unchanged — the `error`
// phase flows through the EXISTING onChunk(cb) listener (now possibly phase:'error').
```

```ts
// new module-level constant
/** A chunk that fails to load this many times becomes terminal `failed` and is not
 *  re-requested until its node/params re-enter the cut after eviction. */
export const MAX_LOAD_ATTEMPTS = 3;
```

`ChunkStatus` gains a terminal `'failed'`:
`type ChunkStatus = 'pending' | 'inflight' | 'ready' | 'failed' | 'dead';`

## Inputs / Outputs

- **Inputs:** a fake octree/pool whose `loadTile`/`dispatch` (a) rejects with `AbortError`
  (`{name:'AbortError'}`) — must be treated as cancel, no error; (b) rejects with a real
  `Error('decode failed')` — must error + backoff; (c) succeeds.
- **Outputs:** for (a) no `error` event, `errorCount` unchanged; for (b) one `error` event
  per attempt up to `MAX_LOAD_ATTEMPTS`, then the chunk is `failed`, no further requests,
  `errorCount` incremented per real failure, `failedChunks` reflects the terminal chunk; for
  (c) the normal `ready` path, unchanged.

## Construction notes (fixed — transcribe, don't redesign)

- Replace `.catch(() => onError(c))` (×2 at `policy.ts:325,332`) with
  `.catch((err) => onError(c, err))`. `onError(c, err)`:
  1. If `c.status !== 'inflight'` return (unchanged guard).
  2. Decrement `_inFlight`, clear `abort`/`token`.
  3. **Abort/cancel detection:** if the chunk was cancelled (its `abort.signal.aborted` /
     token cancelled) OR `err` is an `AbortError` (`err?.name === 'AbortError'`), treat as a
     normal cancel — remove the chunk, do NOT emit `error`, do NOT count. (Navigation
     cancels in-flight tiles constantly; those are not failures.)
  4. Otherwise it is a REAL failure: `c.attempts = (c.attempts ?? 0) + 1`; increment
     `_errorCount`; `const ae = toAppError(err,'streaming',{chunkId:c.id,kind:c.kind,
     lod:c.level})`; emit `error` (via the existing `emit` helper, extended to carry
     `error`); call `reportError(err,'streaming',{...})` (diisable in tests via injection —
     see Constraints). If `c.attempts >= MAX_LOAD_ATTEMPTS` set `c.status='failed'` (terminal,
     stays in `chunks`/`chunkList` but is skipped by the dispatch/descent logic so it is not
     re-requested); else remove it (it may be re-selected and retried next frame).
- Extend the `emit` helper + `eventScratch` to include the `error` field (null except on the
  `'error'` phase). Keep the zero-alloc scratch discipline — `error` is a reference assigned
  in place; the AppError itself is allocated by `toAppError` only on a real failure (NOT hot).
- The descent/dispatch path must **skip `failed` chunks** (they are not `pending`, so they
  already won't dispatch — verify, and ensure coverage/visible logic ignores them: a `failed`
  chunk contributes nothing to `catalogCoverage` and is not rendered).
- `failed` chunks are eligible for LRU eviction like any other; once evicted and the node
  re-enters the cut, a fresh chunk (attempts 0) is created — this is the "until inputs
  change" retry release.
- Wire `errorCount`/`failedChunks` getters into the `stats` object next to the others.

## Constraints & Forbidden Actions

- **`reportError` must be injectable** so unit tests don't hit the real sink and so
  `streaming` does not hard-depend on app state. Add `reportError?: typeof reportError` to
  `StreamingPolicyOptions` (default: the real `@cosmos/diagnostics` import). `@cosmos/diagnostics`
  and `@cosmos/core-types` are the only new deps — both are leaf utilities (boundary-legal).
- **No allocation on the steady-state hot path.** `toAppError`/`reportError` run ONLY on a
  real, non-aborted failure (rare) — never per frame, never on success or cancel.
- Do not change the `request`/`ready`/`evict` semantics, the coverage math, the LRU, or the
  cross-fade. Additive only.
- Do not report aborts/cancels as errors (this is the single most important behavior — a
  laggy network during a fly-through would otherwise spam thousands of false errors).
- Respect §7: this is the sensitive streaming package — single lane, no other streaming task
  concurrent.

## Common Mistakes (architecture §5.8, §7)

- Treating an `AbortError` as a failure → false-positive error storms during normal nav.
- Re-requesting a `failed` chunk every frame (the backoff exists precisely to stop BUG-6's
  storm — assert it in a test: N frames after terminal failure ⇒ 0 new requests for that id).
- Allocating an `AppError` or calling `reportError` on the success/cancel path (hot path).
- Counting the same failure multiple times per attempt, or not counting at all.
- Letting a `failed` chunk count toward `catalogCoverage` (it must not — coverage is
  "ready", and a failed tile is a permanent gap the procgen fallback should cover).
- Mutating/retaining the `eventScratch.error` after the listener returns (same in-place rule
  as `batch`).

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/streaming test` (Vitest; reuse `test/helpers/fake-pool.ts`):
   - **Abort is not an error:** a load that rejects `{name:'AbortError'}` (or a chunk
     cancelled mid-flight) emits NO `error` event and leaves `errorCount === 0`.
   - **Real failure emits + counts:** a load rejecting `Error('x')` emits exactly one
     `error` event with `phase:'error'`, `error.kind==='streaming'`, `error.context.chunkId`
     set; `errorCount === 1`; the injected `reportError` spy is called once.
   - **Backoff:** with a permanently-failing fake, after `MAX_LOAD_ATTEMPTS` the chunk is
     `failed`; over the next 10 `update()` frames the fake's `loadTile` is NOT called again
     for that id (request storm killed); `failedChunks >= 1`.
   - **Retry release:** evict the failed chunk, bring its node back into the cut → a new
     attempt is made (attempts reset).
   - **Coverage unaffected by failure:** a `failed` catalog tile does not raise
     `catalogCoverage` (a ready sibling still counts; the failed cell stays a gap).
   - Existing streaming tests still pass unchanged (additive).
2. **Coverage gate:** statement coverage ≥ 90% on `src` (streaming precedent).
3. `pnpm verify` exits 0.

## Deliverables

- `packages/streaming/src/policy.ts` (onError split, backoff, `failed` status, error emit,
  stats fields, `MAX_LOAD_ATTEMPTS`, injectable `reportError`)
- `packages/streaming/test/errors.test.ts` (new) + minor additions to existing helpers
- `packages/streaming/package.json` (add `@cosmos/diagnostics` dep)
- Update `packages/streaming/README.md` lifecycle section to document the `error` phase +
  abort-is-not-error rule + backoff.

## Context Files

- `docs/research/error-handling-audit.md` §3.1, §3.7 (BUG-6 mechanism)
- `docs/research/TASK-052-integration-bugs.md` BUG-6 (the exact silent-storm this fixes)
- `packages/streaming/src/policy.ts:300-369` (removeChunk/dispatchChunk/onReady/onError today)
- `packages/core-types/src/streaming.ts` (the `error` phase from TASK-054)
- `packages/core-types/src/errors.ts` (`toAppError`)
- `packages/diagnostics/src/index.ts` (`reportError`)
- `docs/architecture.md` §5.8 (streamer), §7 (single-lane sensitivity), §9 (no hot-path alloc)
