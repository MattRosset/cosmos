# Error Handling Audit — cosmos

Research note backing the error-handling hardening plan. Goal: explain **why we keep
shipping silent errors that are hard to detect**, with concrete code evidence, then frame
the plan. This document is the "why"; the task files under `docs/agent-tasks/` are the "how".

Status: research complete 2026-06-23. No code changed by this audit.

**Update 2026-06-28 — the "cheap leaf" shipped (`d38c9f8`).** §3.2 (no ErrorBoundary →
white-screen) and §3.3 (no global handlers) are now CLOSED, plus a WebGL2-capability guard,
without touching any frozen package: `apps/web/src/glue/report-error.ts` (interim sink +
`installGlobalErrorHandlers` + `isWebGL2Available`), `apps/web/src/ErrorBoundary.tsx` (root +
scene boundaries, recoverable card, dev overlay). Verified live (scene throw keeps the HUD
alive; handlers capture window.error + unhandledrejection). **Still open (the heavier,
frozen-thaw track — TASK-054…059):** §3.1 streaming `error` lifecycle phase, §3.4 Sentry/prod
telemetry, §3.5 shared taxonomy, §3.6 dev-assert "scream in dev", §3.7 invariant assertions,
and the §6/F error gate. The interim sink exposes `window.__cosmosErrors` so that gate can be
built; the planned `diagnostics` package will subsume `report-error.ts`.

**Update 2026-06-29 — the Hardening track is CLOSED (TASK-054…059 all shipped).** The error
gate (TASK-059, `e2e/tests/error-gate.spec.ts` + `apps/web/src/scene/ErrorGateProbe.tsx`,
`?debug=errorgate`) drives the same universe→galaxy→Sol→Earth descent as the M4a composition
and asserts `getErrorCounts().total === 0`, `streaming.stats.failedChunks === 0`, and
`streaming.catalogCoverage() > 0` after the descent settles (zero in-flight for 30 consecutive
frames). Observed settled coverage on the committed descent: > 0 (the combined HYG+Gaia octree
covers part of the cut near Sol, same post-condition the M4a gate already asserts mid-descent).
The gate's own red-on-regression self-test (`?inject=1`, permanently failing the combined
octree's root tile) proves it actually detects the BUG-6 class: `errorCounts.total` and
`errorCounts.streaming` both go non-zero. §3.1/§3.4/§3.5/§3.6/§3.7 and the §6/F error gate are
now all closed; nothing from this audit remains open.

---

## 1. The pattern behind our silent bugs

Every hard-to-detect bug we have hit recently has the same shape: **an error is caught and
discarded at a subsystem boundary, there is no central sink, no loud failure in dev, and no
telemetry in prod, so the only symptom is "something is missing on screen".** The catalog
either renders or it doesn't; nothing tells you *why*.

Two shipped examples from the M4a sweep (`docs/research/TASK-052-integration-bugs.md`):

- **BUG-6** — every octree tile load threw `TypeError: Illegal invocation`; the streaming
  policy swallowed the rejection (`.catch(() => onError(c))`), re-requested the 8 tiles
  ~6×/frame *forever*, and `catalogCoverage` silently stayed 0. No log, no counter, no test
  caught it through all of M3 + M4a.
- **BUG-8** — `combineOctreeSources` silently dropped one source's points. Rendered as
  "Gaia just isn't there", with no error at all.

Neither was a logic bug that a type would catch — both were **observability** failures.
The fix for the *class* of bug is not more `try/catch`; it is making failures impossible to
ignore.

---

## 2. Current state — inventory (evidence)

### ✅ What is already robust

| Area | File | Behaviour |
|------|------|-----------|
| Pack load (top level) | `apps/web/src/App.tsx` (8 sites) | `loadStarPack` rejection → `PackState{status:'error', message}` → HUD shows "catalog failed to load" + **Retry** button. The one good end-to-end path. |
| Data loaders | `packages/data/src/load.ts`, `systems.ts`, `octree.ts` | Throw **typed** errors (`PackFormatError`), validate manifest version, buffer bounds, SHA-256. Fail loud at the boundary. |
| Worker boundary | `packages/workers/src/serve.ts:80` | `catch` → structured `WorkerErrorPayload{name,message,stack}` posted back as `WorkerResponse{ok:false,error}`. Architecture §5.13 "structured error propagation" — *implemented*. |
| WebGL context loss | `packages/scene-host/src/SceneHost.tsx:94`, `App.tsx:1243` | `webglcontextlost` listener → "Graphics context lost — reload" prompt. Satisfies architecture §12. |
| Persistence | `packages/app-state/src/persist-util.ts` | `createSafeStorage` swallows localStorage quota/unavailable; migrations validate shape and reset on unknown version. (Swallowing is *correct* here, but see §3.6.) |

### ❌ Gaps that produce silent failures

**3.1 — Streaming swallows all load errors; there is no `error` lifecycle phase.**
`packages/streaming/src/policy.ts:325,332`:
```ts
octree.loadTile(...).then(b => onReady(c, b)).catch(() => onError(c));
pool.dispatch(...).then(b => onReady(c, b)).catch(() => onError(c));
```
`onError` (`:347`) just decrements in-flight and removes the chunk. The `ChunkLifecycleEvent`
type has phases **`request` / `ready` / `evict` only — no `error`** (`:196`, `:317`,
`:344`, `:367`). So a consumer literally *cannot* observe a failed tile. The worker's
carefully structured error (§5.13) dead-ends here. This is the direct structural cause of
BUG-6's silent re-request storm. **The error swallow is also abort-blind** — a cancelled
tile and a genuinely broken one take the same path.

**3.2 — No React error boundary anywhere.** Grep for `ErrorBoundary`/`componentDidCatch`
across `apps/web` and `packages`: **zero hits**. Any throw in the component tree (a render
glue bug, a bad selector, a null deref in a HUD panel) → **blank white screen, no message**,
in both dev and prod. This is the worst-possible failure mode and the easiest to fix.

**3.3 — No global `window.onerror` / `unhandledrejection` handler.** Grep: zero hits. This
app is extremely async (streaming, workers, pack loads, tours). An unhandled promise
rejection — exactly what BUG-6 was — vanishes into the console at best and nowhere at worst.
Nothing aggregates or surfaces them.

**3.4 — Sentry is specified but never wired.** Architecture §12 mandates "Sentry (errors +
WebGL context-loss events)" and a web-vitals beacon as a **Phase 1 requirement, not an
afterthought**. Grep for `Sentry|captureException` in source: **zero** (only `docs/`,
`pnpm-lock.yaml`, `deploy.yml`). So even the errors we *do* `console.error` are invisible in
production — we have no idea how often users hit them.

**3.5 — No shared error vocabulary or helpers.** The idiom
`err instanceof Error ? err.message : String(err)` is copy-pasted **8×** in `App.tsx` alone.
There is no error taxonomy (loader vs streaming vs render vs worker), no dev-assert helper,
no single "report this" sink. Every call site reinvents handling, so each one is an
opportunity to swallow.

**3.6 — Silent-by-design swallows have no dev-mode escape hatch.** `createSafeStorage` and
the frame-loop's non-finite-epoch guard (`frame-loop.ts:62`, warns **once** then goes quiet)
are correct to degrade in prod — but there is no convention that says *"degrade in prod, but
scream in dev"*. A developer never finds out their writes are silently failing.

**3.7 — No invariant assertions on "this should have happened".** BUG-6 (`loadedChunks ≡ 1`
tolerated for two phases) and BUG-8 (a whole source dropped) both passed every gate because
nothing asserted the *expected* post-condition. Per [[ci-test-infra-philosophy]] the durable
fix is a deterministic proxy that fails when coverage stays 0, not a one-off test.

---

## 3. Root cause, in one sentence

We treat errors as **local control-flow to be silenced** (`catch(() => …)`) instead of
**events to be surfaced**. There is no seam where "something went wrong" is reported, so
there is nowhere to hang a log, a counter, a dev overlay, or a Sentry call — and no test can
assert "no errors happened".

This matches the user's empirical debugging preference ([[debugging-style]]): the fix is
**instrumentation that makes failure measurable**, not defensive theory.

---

## 4. Design direction (to be confirmed before task authoring)

The plan should introduce, smallest-blast-radius first:

1. **A central error sink** — one `reportError(err, context)` function in a new tiny module
   (dev: loud overlay + `console.error`; prod: throttled telemetry beacon). Everything else
   funnels here.
2. **A React `ErrorBoundary`** wrapping the app (and a second one inside the Canvas tree) →
   replaces white-screen with a recoverable error card that calls the sink.
3. **Global handlers** — `window.onerror` + `unhandledrejection` → the sink.
4. **An `error` lifecycle phase in streaming** (this is a **frozen-package thaw** of
   `streaming` and likely `core-types` `ChunkLifecycleEvent` — must be an explicit, reviewed
   thaw task, not smuggled in). Distinguish abort/cancel from real failure; surface a counter
   the app and a gate can read.
5. **A dev-assert + "degrade in prod / scream in dev" helper** adopted by the existing silent
   swallows (§3.6) and new invariant checks (§3.7).
6. **A gate** that asserts the silent classes are gone (e.g. `__cosmos.errorCount === 0`
   after a scripted flythrough; catalog coverage reaches > 0).

### Open decisions for the user (governance + scope)
- **Telemetry backend:** real Sentry (matches §12, needs DSN/secret) vs a minimal
  self-hosted `/beacon` vs **dev-overlay + console only for now** (defer prod telemetry).
- **Frozen-interface thaw:** adding `error` to `ChunkLifecycleEvent` touches frozen
  `core-types` + `streaming` (frozen since TASK-041). This needs the same explicit thaw
  ceremony every phase boundary used (one S-sized thaw task gating the rest).
- **Task count / phasing:** this is a cross-cutting mini-phase (~5–7 tasks). Sequence and
  which packages each lane may touch must respect the §4 dependency boundaries.

---

## 5. Proposed task breakdown (draft — for discussion)

| # | Task | Package(s) | Size | Notes |
|---|------|-----------|------|-------|
| A | `core-types` thaw: `ChunkLifecycleEvent` gains `error` phase + `AppError` taxonomy types | `core-types` | S | the one frozen thaw; gates the rest |
| B | `telemetry` (or `diagnostics`) package: `reportError` sink + dev overlay + prod beacon shim | new pkg | M | no deps on Three/React in the core; React glue separate |
| C | `ui`/app: `ErrorBoundary` + global handlers wired to the sink | `apps/web` (+ `ui`?) | M | kills white-screen; needs B |
| D | `streaming` v1.2: emit `error` phase, abort/fail distinction, error counter | `streaming` | M | needs A; §7-sensitive single lane |
| E | dev-assert helper + adopt in `app-state` storage, frame-loop, octree-combine | several | S–M | §3.6 + §3.7 |
| F | Error gate: scripted flythrough asserts `errorCount === 0` + coverage > 0 | `e2e` / `apps/web` | M | the deterministic proxy ([[ci-test-infra-philosophy]]) |

Sizes/sequence are a starting point; finalize after the §4 decisions.
