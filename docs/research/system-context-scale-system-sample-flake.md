# Root cause — `system-context-scale` e2e flake (system sample never captured)

**Date:** 2026-07-31
**Spec:** `e2e/tests/system-context-scale.spec.ts` (TASK-084)
**Status:** fixed (gate on real captured state instead of a proxy)

## Symptom (as a measurement)

The `e2e` job's "Run E2E tests (deterministic gate)" step failed on the **merge commit to
main** (`892e6fc`, PR #37) with **52 passed / 1 failed**. The single failure:

```
Error: never captured a settled system-context sample of sol:earth after the descent
  expect(received).not.toBeNull()   // system-context-scale.spec.ts:250
```

CI log line, verbatim:

```
system-context-scale: {"galaxy":{…},"system":null}
```

`result.galaxy` was captured; `result.system` was `null`. Expected: both non-null.

## Taxonomy — test–environment coupling, NOT a product bug

PR #37 is **docs-only** (research docs + a standalone `tools/` script + JSON/PNG
artifacts — zero changes under `apps/web` or `e2e`). So the app code and the spec are
**byte-identical** between:

- the PR head (`e2e` job **passed**, run `30607090091`), and
- the merge commit (`e2e` job **failed**, run `30641400763`).

Same code, opposite outcome ⇒ the failure is **nondeterminism in the test**, not a
regression. The spec has a single commit in its history (`12f6d95`, TASK-084) and had
never failed before — first occurrence.

## Mechanism

The test's readiness gate waited only on the **mirrored** `contextId`/`goToActive`
flags:

```ts
// old — proxy gate
await page.waitForFunction(
  () => window.__cosmos?.contextId === 'system' && window.__cosmos?.goToActive === false,
  undefined, { timeout: 5_000 },
);
const result = await page.evaluate(() => window.__task084!);
```

Those flags are mirrored onto `window.__cosmos` by a low-frequency timer
(`apps/web/src/glue/time.ts`) and flip as soon as the goTo **arrives**.

But the sampler's system-capture branch needs more than the flags:

```ts
if (c.contextId === 'system' && !c.goToActive) {
  const body = c.systemBody(bodyId);   // ← must be non-null
  if (body) { store.system = …; }
}
```

`__cosmos.systemBody(id)` (`apps/web/src/glue/test-hook.ts:252`) early-returns `null`
unless `systemFeed.active` is `true` **and** the mesh exists in `systemPickGroup.current`.
Those two are set at the **end of an async IIFE** in `SystemScene`:

```ts
// apps/web/src/scene/SystemScene.tsx:156-262
void (async () => {
  … await Promise.all(system.bodies.map(loadTexture …)) …   // async texture load
  systemFeed.active = true;               // :261
  systemPickGroup.current = rootGroup;    // :262
})();
```

So the system pick group becomes queryable only **after** all body textures finish
loading — a lifecycle **decoupled** from the goTo-arrival flags. On a run where that
async build finishes *after* the gate returns, `page.evaluate` reads `store.system` in
the gap, before any sampler tick could capture it ⇒ `null`.

This one mechanism explains **every** observation:

- **`galaxy` captured, `system` null** — the galaxy sample is taken mid-flight, when the
  m4a system was long since built (textures loaded); the system sample needs a *settled*
  tick, which lands in the pre-build gap on a slow run.
- **flaky with identical code** — pure async timing (texture load vs. the 5 s window);
  the software-GL CI runner's timing varies run-to-run.
- **no `pageerror`** (the `line 215` assert passed first) — `systemBody` returning `null`
  is a clean early-return, not a throw.
- **first occurrence / rare** — it needs the async build to lose the race against the
  gate, which is uncommon.

## Fix

Gate on the sampler's **real captured state**, which is exactly what the assertions read
next — not a proxy for it (CLAUDE.md testing rule 1: *query real state, never re-derive
or proxy it*):

```ts
// new — gate on the actual samples
await page.waitForFunction(
  () => window.__task084?.galaxy != null && window.__task084?.system != null,
  undefined, { timeout: 10_000 },
);
```

`evaluate` now runs only once both samples exist, so `store.system === null` at read time
is impossible by construction. The `.not.toBeNull()` assertions stay as clear guards; the
timeout is bumped 5 s → 10 s to give the async texture build room on a slow runner. This
is **not** a Playwright `retries` bump — retries are coping tooling that hide
nondeterminism; this closes the proxy/actual gap that *is* the nondeterminism.

## What would have caught this earlier

Any test that gates on a **proxy** (mirrored flags) for a value produced by a **different,
async** lifecycle (the texture build) can read the value before it exists. The general
guard: when a sampler's capture predicate is stricter than the wait predicate, wait on the
sampler's output, not on a correlated signal. The proxy/actual gap is the same shape as the
already-catalogued `measure-the-frame-not-the-layer` / query-hook lessons.
