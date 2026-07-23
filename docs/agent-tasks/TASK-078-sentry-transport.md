# Task: `apps/web` — Sentry transport behind the error sink

**ID:** TASK-078
**Target package:** `apps/web`
**Size:** S
**Phase:** H — Hardening track
**Depends on:** TASK-055

## Why this task exists

Split out of **TASK-056** on 2026-07-22. That task bundled three deliverables; two shipped
in `d38c9f8` (the DOM + scene `ErrorBoundary`, and the global `onerror` /
`onunhandledrejection` handlers), while the third — the production telemetry transport —
did not. One row cannot carry two states, and the half-done row was blocking the index's
consistency gate (`pnpm check:tasks`): TASK-059 depends on TASK-056 and shipped against
the half that landed, so TASK-056 read `pending` while a task downstream of it read `done`.

TASK-056 is now closed for the shipped scope; this task carries the remainder.

## Goal

Production errors reach **Sentry with readable stack traces and breadcrumbs** (error
handling audit §3.4, architecture §12), behind the existing `ErrorTransport` interface, so
`reportError()` keeps its current signature and `diagnostics` stays Sentry-free.

Current state to build on (verified 2026-07-22):
- `apps/web/src/glue/report-error.ts` routes errors and its header still records
  "prod: throttled `console.error` + a counter only — NO telemetry beacon yet".
- `apps/web/src/vite-env.d.ts` declares exactly one env var
  (`VITE_GAIA_OCTREE_MANIFEST_URL`); there is no `VITE_SENTRY_DSN`.
- `@sentry/react` is **not** in `apps/web/package.json`.

## Deliverables

- `apps/web/package.json` — add `@sentry/react` (allowed dependency; `apps/web` only).
- `apps/web/src/vite-env.d.ts` — declare `VITE_SENTRY_DSN?: string`.
- A Sentry transport implementing the existing `ErrorTransport` interface, installed at
  boot in PROD only, **gated on `VITE_SENTRY_DSN`**: absent ⇒ console-only, no crash, no
  network call. DEV keeps `installDevOverlay()`.
- Source-map upload so traces are readable. NOTE: the GitHub Actions deploy workflow was
  removed on 2026-07-22 (Cloudflare Pages' Git integration is the only deploy path), so
  this step belongs in the CF Pages build command or a build script it calls — **not** in
  `.github/workflows/`.

## Constraints

- `diagnostics` must stay framework- and vendor-agnostic: Sentry is imported only in
  `apps/web` (the boundary is lint-enforced — see `eslint.config.js`, the
  `packages/diagnostics/**` block bans `@sentry/react` by name).
- No change to `reportError`'s signature or to the `ErrorTransport` interface.
- Bundle budget still applies (architecture §12): run `pnpm check:bundle` after adding the
  dependency and report the delta in the task notes.

## Acceptance Tests

The task is DONE only when all pass:

1. `pnpm verify` exits 0.
2. With `VITE_SENTRY_DSN` **unset**, a production build boots and an induced error is
   handled console-only — no network request to Sentry, no crash.
3. With `VITE_SENTRY_DSN` set to a test DSN, an induced error produces a Sentry event.
4. `pnpm check:bundle` exits 0, and the task notes record the gzip delta from the new
   dependency.
5. `pnpm lint` still passes with `@sentry/react` imported in `apps/web` only (proving the
   `diagnostics` ban is untouched).

## Context Files

- `docs/agent-tasks/TASK-056-app-boundary-sentry.md` — the original three-part task; its
  Frozen Interface section still governs the shipped `ErrorCard`.
- `docs/research/error-handling-audit.md` §3.4 — why a beacon is needed at all.
- `apps/web/src/glue/report-error.ts` — the sink this transport plugs into.
