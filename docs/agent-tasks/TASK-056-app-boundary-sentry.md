# Task: `apps/web` — ErrorBoundary + global handlers + Sentry transport

**ID:** TASK-056
**Target package:** `apps/web` (+ a small `ui` error-card component)
**Size:** M
**Phase:** H — Hardening track; app integration of the sink
**Depends on:** TASK-055

## Goal

Wire the diagnostics sink (TASK-055) into the running app so that **no failure produces a
blank white screen** (audit §3.2) and **no async rejection vanishes** (audit §3.3), and so
that production errors land in **Sentry with readable stack traces + breadcrumbs** (audit
§3.4, architecture §12). Three pieces:

1. A React **`ErrorBoundary`** wrapping `<App>` (DOM tree) and a second one INSIDE the
   `<SceneHost>` Canvas tree (R3F errors are separate from DOM errors) → replaces the
   white screen with a recoverable error card that calls `reportError(err,'render')`.
2. **Global handlers** — `window.onerror` + `window.onunhandledrejection` →
   `reportError(..., 'unknown')`. Installed once at boot.
3. **Transports** — at boot, install: in DEV `installDevOverlay()` (loud, local); in PROD a
   **Sentry transport** (`@sentry/react`) behind the `ErrorTransport` interface, gated on a
   `VITE_SENTRY_DSN` env var (absent ⇒ console-only, no crash — mirrors the deploy.yml
   "skip cleanly when secret absent" pattern from TASK-016).

When done: throwing in a HUD panel shows an error card + a Sentry event; an unhandled
rejection (the BUG-6 class) is captured; in dev the overlay screams. Sentry lives ONLY here
(diagnostics stays Sentry-free).

## Frozen Interface

```ts
// packages/ui/src/ErrorCard.tsx  (NEW — React only, no Three; ui is the HUD home)
export interface ErrorCardProps {
  readonly title: string;          // e.g. "Something broke"
  readonly detail: string;         // AppError.message
  readonly onReload: () => void;    // window.location.reload by default
  readonly onDismiss?: () => void;  // recover-in-place where safe
}
export function ErrorCard(props: ErrorCardProps): JSX.Element;
```

```ts
// apps/web/src/diagnostics/ErrorBoundary.tsx  (NEW)
import type { ReactNode } from 'react';
export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  /** Which slot crashed — 'app' (DOM) or 'scene' (R3F Canvas). Sets AppError context. */
  readonly slot: 'app' | 'scene';
  /** Fallback renderer; defaults to <ErrorCard>. For 'scene' a non-DOM fallback. */
  readonly fallback?: (err: import('@cosmos/core-types').AppError, reset: () => void) => ReactNode;
}
// class component: componentDidCatch → reportError(error,'render',{slot, componentStack})

// apps/web/src/diagnostics/install.ts  (NEW)
/** Idempotent. Installs window.onerror + unhandledrejection + the boot transports
 *  (dev overlay in DEV, Sentry in PROD when VITE_SENTRY_DSN is set). Call once at
 *  the very top of main.tsx, BEFORE React renders. Returns a teardown (tests). */
export function installAppDiagnostics(): () => void;
```

## Inputs / Outputs

- **Inputs:** a child component that throws on render; a programmatic
  `Promise.reject(new Error('x'))` with no catch; a `window.dispatchEvent(new ErrorEvent(...))`.
- **Outputs:** ErrorBoundary catches the render throw → `reportError(...,'render')` + renders
  `<ErrorCard>`; the rejection fires `onunhandledrejection` → `reportError(...,'unknown')`;
  with `VITE_SENTRY_DSN` set, the Sentry transport's capture is invoked (mock Sentry in test).

## Construction notes (fixed — transcribe, don't redesign)

- **Two boundaries, not one.** R3F throws inside the Canvas reconciler do NOT bubble to a
  DOM ErrorBoundary above the Canvas. Wrap `<App>` (DOM) and separately wrap the scene
  children inside `<SceneHost>` (the 'scene' slot). The 'scene' fallback must NOT render DOM
  inside the Canvas — render `null` and let the DOM boundary/HUD show the card, OR surface
  via state. Keep the scene fallback minimal: report + render null + flip a store flag the
  HUD reads.
- **Sentry transport** is a thin adapter: `const sentryTransport: ErrorTransport = (e) =>
  Sentry.captureException(...)` mapping `AppError` → Sentry (use `e.message`, `e.name`,
  attach `e.context` as `extra`, `e.kind` as a tag). Initialize Sentry (`Sentry.init({ dsn,
  environment, release })`) once, only when the DSN is present. **Source maps**: ensure the
  Vite build emits source maps and the deploy uploads them (see Deliverables) so prod stacks
  are readable — that is the whole "debug fast" payoff.
- **Order:** `installAppDiagnostics()` runs before `createRoot().render()` so a crash during
  the first render is already captured.
- The existing pack-load error path (`App.tsx` `PackState 'error'` + Retry) STAYS — it is the
  good path (audit §2). Optionally route its message through `reportError(...,'loader')` so
  the gate counts it, but keep the Retry UX.
- DSN/env: read `import.meta.env.VITE_SENTRY_DSN`. Add it to `apps/web/src/vite-env.d.ts`.

## Constraints & Forbidden Actions

- `ErrorCard` is in `ui` → **React only, no Three.js** (boundary lint). The boundaries +
  install + Sentry adapter live in `apps/web` (the only place app-level deps + Sentry belong).
- Allowed NEW dependencies: `@sentry/react` (apps/web only). Nothing else. Diagnostics stays
  Sentry-free (do not add Sentry to `packages/diagnostics`).
- No secrets in the repo — DSN comes from env/CI. App must run with DSN absent (console-only).
- Do not remove or rewrite the existing context-loss prompt (`App.tsx:1243`) or the pack
  `PackState` machine — extend, don't replace.
- The 'scene' boundary fallback must not allocate per frame or mount DOM in the Canvas.

## Common Mistakes

- One boundary above the Canvas only — misses every R3F/Three error (the silent-render class).
- `Sentry.init` called when DSN is undefined → throws/among noise; gate it.
- Forgetting to install handlers before first render → a boot crash is uncaptured.
- Shipping without source maps → prod stacks are minified garbage, defeating the goal.
- Putting Three.js into `ui` (ErrorCard must be pure React).
- An ErrorBoundary with no reset path → user is stuck on the card; provide `onReload` +
  (where safe) `onDismiss`/`reset`.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/ui test`: `<ErrorCard>` renders title/detail, fires `onReload`.
2. `apps/web` unit/component test (Vitest + Testing Library):
   - A child that throws inside `<ErrorBoundary slot="app">` is caught → `reportError`
     called with `kind:'render'` + `context.slot==='app'` (spy on diagnostics) → `<ErrorCard>`
     in the DOM; clicking Reload calls the injected reload fn.
   - `installAppDiagnostics()` then `window.dispatchEvent(new PromiseRejectionEvent(...))` (or
     invoke the handler directly) → `reportError` with `kind:'unknown'`.
   - With `VITE_SENTRY_DSN` set (env shim) the Sentry transport's `captureException` (mocked)
     is invoked with the mapped fields; with DSN unset it is NOT and nothing throws.
3. `e2e/tests` smoke (or extend an existing spec): boot the app with an injected throwing
   debug component (`?debug=errboundary`) → the page shows the error card, NOT a blank
   screen; `window.__cosmos.errorCounts.total >= 1`.
4. `pnpm verify` exits 0; bundle gate still passes (note Sentry's size — lazy/async-init
   Sentry if it pushes the gate; document the chunk split if needed).

## Deliverables

- `packages/ui/src/ErrorCard.tsx`, `packages/ui/test/error-card.test.tsx`, export from `ui` index
- `apps/web/src/diagnostics/ErrorBoundary.tsx`
- `apps/web/src/diagnostics/install.ts` (handlers + transports + Sentry adapter)
- `apps/web/src/main.tsx` (call `installAppDiagnostics()` first; wrap `<App>` in the boundary)
- `apps/web/src/App.tsx` (wrap scene children in the 'scene' boundary; optional loader-report)
- `apps/web/src/vite-env.d.ts` (`VITE_SENTRY_DSN`)
- `apps/web/vite.config.ts` (sourcemap: true if not already) + a source-map upload step to
  Sentry when the DSN/auth secret is present, skipping cleanly when absent. NOTE: the
  GitHub Actions deploy workflow was removed once Cloudflare Pages' own Git integration
  became the single deploy path, so this step now belongs in the CF Pages build command
  (or in a build script it calls), not in `.github/workflows/`.
- An `?debug=errboundary` probe component for the e2e
- Add `@sentry/react` to `apps/web/package.json`

## Context Files

- `docs/research/error-handling-audit.md` §3.2, §3.3, §3.4
- `packages/diagnostics/src/index.ts` (TASK-055 — sink + transports + overlay)
- `apps/web/src/App.tsx` (existing PackState error path + context-loss prompt to preserve)
- `packages/scene-host/src/SceneHost.tsx` (Canvas mount point for the 'scene' boundary)
- `docs/agent-tasks/TASK-016-deploy.md` (the "skip cleanly when secret absent" deploy pattern)
- `docs/architecture.md` §12 (Sentry + context-loss as a Phase-1 requirement), §5.12 (ui/HUD)
