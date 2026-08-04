# Task: Always-on nav-frame budget tripwire (anti-silence alarm)

**ID:** TASK-090
**Target package:** `packages/diagnostics` (new monitor) + `apps/web` (wiring)
**Size:** M
**Phase:** 4
**Depends on:** none (lands BEFORE TASK-091 = bounds-aware nearest + park gate, and protects its implementation)

## Goal

When a per-frame nav cost silently blows up (the HYG void-search cliff cost ~2 debugging
sessions because a ~90 ms main-thread stall only *looked* like a GPU/throttle problem — nothing
said "this is wrong because X"), an **always-on alarm fires the moment it is happening**, with
the context needed to act. After this task, if the nav surface-feed span sustains over its
frame-time budget, the app reports one loud, deduped diagnostics error — visible in the console
and the dev overlay, counted in `getErrorCounts()` so CI can gate on it — naming the span, the
measured ms, the context, and the camera's distance from Sol and from the HYG field. The app
keeps running (no crash) so the failing state stays observable. The tripwire is a **reusable
primitive** (`createBudgetMonitor`), not hard-wired to HYG — nav is its first consumer.

This is the "alarm for a known cliff" half of the plan; the *fix* for the specific HYG cliff is
TASK-091 (bounds-aware `nearestStarIndex` + remove the magic-500 guard). The tripwire exists
first so that when TASK-091 removes that guard, any regression re-detonating the walk announces
itself on the spot instead of being bisected blind. See
`docs/research/hyg-void-nearest-robust-fix.md` and
`docs/learnings/LEARN-hyg-void-search-rearm-2026-08-03.md` (proposal D2).

## Step 0 — facts to re-verify before writing code (code moves after specs)

Confirm each; if any is false, STOP and reconcile in the spec (global rule 1), do not improvise.

1. `reportError(err, kind, context?)` in `packages/diagnostics/src/sink.ts`: always increments
   `getErrorCounts()`, **dedupes identical `kind|name|message` within 1000 ms** (console + overlay
   silenced on dup, count still increments), fans to `console.error` + dev overlay + transports,
   **never throws**. (sink.ts:63-98.)
2. `AppErrorKind` includes `'invariant'` and `ALL_KINDS` is a **frozen** list (sink.ts:11-19). This
   task reuses `'invariant'` and adds NO new kind (adding one changes `ErrorCounts` — a frozen
   surface needing its own thaw task).
3. `getErrorCounts()` is the established deterministic gate proxy: `ErrorGateProbe.tsx` gates
   `getErrorCounts().total === "no silent error"`, `test-hook.ts:248` exposes it, and
   `packages/diagnostics/test/assert.test.ts:28` asserts `getErrorCounts().invariant === 1` after
   one invariant. The tripwire's acceptance rides this same proxy.
4. `assertInvariant` (assert.ts) **throws in DEV**. This task must **NOT** use it (a per-frame
   throw kills the rAF loop and hides the state we want to observe) — call `reportError` directly.
5. In `NavDriver.tsx`, the galaxy-context surface feed already computes `distFromSolPc`
   (`Math.hypot(cx,cy,cz)`, ~line 209) and `distToField` (~line 208) each frame, and the whole feed
   is wrapped in `profileSpan('nav.surfaceFeed', …)` (line 165). `profileSpan` is **opt-in**
   (no-op unless `?debug=breadcrumb-profile`, frame-profiler.ts:81-89) so it cannot supply the ms —
   add an explicit `performance.now()` bracket.
6. Repo hard rule: **no allocations inside frame-loop callbacks** (architecture.md §5.8; see
   `policy.ts` scratch discipline). The per-frame `sample()` path must allocate nothing; the
   context object is built/copied only on the rare breach.
7. `installDevOverlay` exists (`packages/diagnostics/src/dev-overlay.ts`) — the visible HUD the
   alarm surfaces through when a report is not a dedup.

## Frozen Interface

Consume, do not modify:

```ts
// @cosmos/diagnostics (packages/diagnostics/src/sink.ts) — DO NOT change ALL_KINDS
export function reportError(err: unknown, kind: AppErrorKind, context?: AppError['context']): AppError;
export function getErrorCounts(): ErrorCounts; // { total, ...perKind }
// AppErrorKind — reuse 'invariant'; add no new kind.
```

## New Interface (this task implements)

`packages/diagnostics/src/budget-monitor.ts` — a pure, reusable factory (unit-testable with no
DOM, no React, no timers):

```ts
export interface BudgetMonitor {
  /** Call once per frame with the measured span ms. Zero allocation on this path.
   *  `context` is a caller-owned scratch object (mutated in place each frame); the
   *  monitor reads it ONLY when it reports, and shallow-copies it then. */
  sample(ms: number, context?: AppError['context']): void;
  /** Re-arm (e.g., on context switch / teardown). */
  reset(): void;
}

export interface BudgetMonitorOptions {
  /** Stable label, e.g. 'nav.surfaceFeed'. Goes in the report message + context. */
  readonly label: string;
  /** Per-frame budget (ms). A single frame at/under this never contributes to a breach. */
  readonly budgetMs: number;
  /** A breach must be SUSTAINED this many consecutive over-budget frames before it
   *  reports — a single slow frame (GC, machine hitch) must NOT fire the alarm
   *  (see Failure modes: peak-of-a-per-frame-sample). */
  readonly sustainedFrames: number;
  /** Injected for tests; defaults to the real sink `reportError`. */
  readonly report?: typeof reportError;
}

export function createBudgetMonitor(opts: BudgetMonitorOptions): BudgetMonitor;
```

**Semantics (implement exactly):**
- Maintain `consecutiveOver` and a `reportedThisEpisode` latch.
- `sample(ms, ctx)`: if `ms > budgetMs` → `consecutiveOver++`; when `consecutiveOver` first
  reaches `sustainedFrames` AND not `reportedThisEpisode` → call
  `report(new Error(\`${label} exceeded ${budgetMs}ms for ${sustainedFrames} frames\`), 'invariant', ctx ? { ...ctx } : undefined)` once, set the latch.
  If `ms <= budgetMs` → reset `consecutiveOver = 0`, clear the latch (re-arm for the next episode).
- The report **message must be stable** (only `label`/`budgetMs`/`sustainedFrames`, no varying ms)
  so the sink's `kind|name|message` dedup still caps console/overlay at 1/s if a caller ever
  samples every frame. Varying numbers (`spanMs`, `distFromSolPc`, `distToField`, `context`) live
  in the copied `context`, which is not part of the dedup key.
- One report per sustained episode; a recovery below budget then a new sustained breach reports
  again (so a second, later cliff is not swallowed).

## Wiring (apps/web, `NavDriver.tsx`)

- Create ONE monitor instance for nav (module- or ref-scoped, created once — NOT per frame):
  `createBudgetMonitor({ label: 'nav.surfaceFeed', budgetMs: 4, sustainedFrames: 30 })`.
- Hold ONE reused scratch context object (created once, mutated in place — mirror `policy.ts`
  `posScratch`/`eventScratch`): fields `{ span: 'nav.surfaceFeed', context, distFromSolPc,
  distToField, spanMs }`.
- In the `useFrameContext` nav callback: bracket the existing surface-feed body with
  `const t0 = performance.now();` … `const spanMs = performance.now() - t0;`, update the scratch
  fields for the galaxy branch (set `distFromSolPc`/`distToField` from the values already computed;
  for system/universe branches set them to the branch's own nearest scalar or `-1`), then
  `navBudget.sample(spanMs, scratch)`. No object literal is created in the callback.
- Call `navBudget.reset()` on context switch (reuse the existing `onContextSwitch`/effect path) so
  a legitimately different regime does not carry a stale `consecutiveOver`.

## Constraints & Forbidden Actions

- **Do NOT use `assertInvariant`** here (Step 0 #4) — call `reportError` directly; the app must
  not throw/crash on a slow frame.
- **Do NOT add a new `AppErrorKind`** / touch `ALL_KINDS` / `ErrorCounts` (Step 0 #2). Reuse
  `'invariant'`; discriminate via `context.span`.
- **No allocation in the per-frame `sample()` path or the NavDriver frame callback** (Step 0 #6):
  reuse the scratch context; the only sanctioned allocation is the shallow copy + `Error` on the
  rare breach report.
- Do not "improve" the fix on the way: do not also change `nearestStarIndex`, the magic-500 guard,
  or the speed law — that is TASK-091. This task only *observes*.
- Do not modify `packages/core-types`. Respect package dependency rules (architecture.md §4):
  `apps/web` depends on `@cosmos/diagnostics`, not vice-versa.
- No `Math.random()`; deterministic logic only.

## Failure modes (mined from `docs/research/`, `docs/learnings/`, and `git log`)

- **Firing on the peak of a per-frame sample.** A single slow frame (GC, tab wakeup, machine
  hitch) is machine/frame-rate dependent and must not alarm — the real cliff is *sustained*
  (~90 ms **every** frame while parked). This is exactly the trap in
  `memory/dont-gate-peak-of-per-frame-sample.md` and the `preview-tab-idle-hidden` throttle hazard.
  `sustainedFrames` (30 ≈ 0.5 s at 60 fps) is the guard; do not reduce it to 1.
- **Idle-rAF / occlusion throttling** can inflate frame *interval* without inflating *callback
  work*. The tripwire measures **callback ms** (the `performance.now()` bracket around the feed
  body), NOT frame interval, so throttling does not false-trip it — keep the bracket tight around
  the feed only (`gaia-far-fly-quality-collapse.md` Step 4 method note; LEARN Pattern 3).
- **Allocation storm.** Building a context object per frame violates §5.8 and can itself cause
  jank. Scratch + copy-on-breach only.
- **Dedup swallowing distinct episodes.** The sink dedups by `kind|name|message` for 1 s. Because
  the varying numbers are in `context` (not the message), two *different* cliffs share the message
  and could dedup within 1 s — acceptable (count still increments; the latch already limits to one
  report/episode). Do NOT encode ms in the message to "fix" this (it would defeat the console-storm
  cap).
- **Budget too low → CI false positives.** The nav feed is pure array math (system: ~scene body
  count; galaxy near-Sol: HYG grid, measured 0.001–0.002 ms in
  `hyg-void-nearest-robust-fix.md`). 4 ms is ~1000× headroom over normal even on a slow shared
  runner, and ~20× under the ~90 ms cliff. If CI ever false-fires, raise `budgetMs` (log the
  measured `spanMs`), never delete the alarm.
- **Stale monitor across context switch.** Galaxy↔system↔universe have different feed regimes;
  not resetting `consecutiveOver` on switch could carry a partial breach across. `reset()` on
  switch.
- **New reachability re-arms old cliffs** (LEARN Pattern 2): this alarm is the general net for the
  *next* disguise, not just HYG. Keep the monitor generic; resist inlining HYG specifics into it.

## Acceptance Tests (DONE only when these pass in CI)

All deterministic — no wall-clock, no screenshots (those are reference-machine only per
`CLAUDE.md` §CI gates).

1. **`packages/diagnostics/test/budget-monitor.test.ts`** (new), using an injected `report` spy +
   `__resetDiagnostics`:
   - `sustainedFrames-1` over-budget samples → **0** reports; the `sustainedFrames`-th → **exactly 1**.
   - Further over-budget samples while latched → still **1** (no per-frame spam).
   - One under-budget sample (re-arm) then another full sustained run → **2** total.
   - A single over-budget sample surrounded by under-budget → **0** (peak, not sustained).
   - The reported call carries `kind === 'invariant'`, a stable message containing `label`, and a
     **copied** context (mutating the passed scratch after the call does not change the reported
     context — proves the shallow copy).
   - Real-sink path (no spy): after one sustained breach, `getErrorCounts().invariant === 1` and
     `.total === 1` (mirrors `assert.test.ts:28`).
2. **`pnpm verify` green** (lint + typecheck + unit + build) — including the no-alloc lint/discipline
   the repo already enforces; the NavDriver frame callback creates no per-frame object literal.
3. **Wiring smoke (unit or light e2e, deterministic):** drive the nav callback with a synthetic
   feed body forced over budget for `sustainedFrames` frames and assert `getErrorCounts().invariant`
   incremented by 1 and the context recorded `span:'nav.surfaceFeed'` + a numeric `distFromSolPc`.
   (The *live park* end-to-end assertion belongs to TASK-091's park gate; here only prove the wire
   fires from the NavDriver path.)

Every failing acceptance check must be triagable from logs alone: on breach the report logs
`[cosmos:invariant] nav.surfaceFeed exceeded 4ms for 30 frames { span, spanMs, distFromSolPc, distToField, context }`.

## Verification beyond the gate (reference-machine, non-blocking)

- Manually park at the dense Gaia id (`?…` per `hyg-void-nearest-robust-fix.md` repro) on the
  **pre-TASK-091** tree with the magic-500 guard **temporarily removed** and confirm the alarm
  fires once with `distFromSolPc≈2835`, `spanMs≈90`. (Do not commit the guard removal — that is
  TASK-091.) This is the human confirmation that the alarm actually catches the real cliff; it is
  not a CI gate.

## Context Files

- `packages/diagnostics/src/sink.ts` — `reportError` + dedup + counts (the report path).
- `packages/diagnostics/src/assert.ts` — why NOT to reuse it (throws in DEV).
- `packages/diagnostics/test/assert.test.ts` — the `getErrorCounts()`-as-proxy test pattern to mirror.
- `apps/web/src/scene/NavDriver.tsx` — the surface feed; `distFromSolPc`/`distToField` already computed.
- `apps/web/src/glue/frame-profiler.ts` — why `profileSpan` can't supply the ms (opt-in).
- `packages/streaming/src/policy.ts` — scratch/no-alloc discipline to copy (`posScratch`, `eventScratch`).
- `docs/research/hyg-void-nearest-robust-fix.md` — the measured cliff this alarm exists to catch.
- `docs/learnings/LEARN-hyg-void-search-rearm-2026-08-03.md` — Patterns 2–3, proposal D2.

---

**Log every judgment call** — anything this task didn't decide and you had to — to `NOTES.md`
beside the diff, visibly, as you go (not reconstructed after).

**Standing rule:** Findings during this task go to `docs/research/` (or wherever this repo keeps
investigation writeups — create it if there is none); scope creep goes to a new task file, not
into this diff.
