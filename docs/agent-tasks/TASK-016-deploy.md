# Task: Deploy pipeline to CDN + WebGL context-loss handling

**ID:** TASK-016
**Target package:** `.github/workflows/` + `apps/web` (+ `packages/scene-host`, one prop)
**Size:** S
**Phase:** 1 — lane E (infra)
**Depends on:** TASK-014

## Goal

Static deployment per architecture §12: every PR gets a preview URL, `main` deploys to
production on Cloudflare Pages, hashed assets get immutable cache headers, and the app
survives WebGL context loss with a graceful reload prompt (§12 names this a Phase 1
requirement, not an afterthought). No backend, no accounts.

## Frozen Interface

One sanctioned Phase-1 thaw addition to `@cosmos/scene-host` (approved here; nothing
else in its API may change):

```ts
export interface SceneHostProps {
  // …existing…
  /** Fired when the WebGL context is lost (event already preventDefault()ed so the
   *  browser allows restoration). The app decides UX; scene-host stays UI-free. */
  onContextLost?: () => void;
}
```

Deploy contract:

- `.github/workflows/deploy.yml`: on `pull_request` and on `push` to `main`;
  builds (`pnpm install --frozen-lockfile && pnpm build`), then publishes
  `apps/web/dist` with `cloudflare/pages-action@v1` (project `cosmos`,
  `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` from repo secrets). PRs get the
  action's preview URL (it comments automatically); `main` → production.
  The job is skipped (not failed) when secrets are absent, so forks stay green.
- `apps/web/public/_headers` (Cloudflare Pages header file):
  ```
  /assets/*
    Cache-Control: public, max-age=31536000, immutable
  /packs/*
    Cache-Control: public, max-age=31536000, immutable
  /index.html
    Cache-Control: no-cache
  ```
  (packs are content-hashed by TASK-008; the un-hashed `manifest.json` inherits the
  pack path rule — override it: add a `/packs/manifest.json` block with `no-cache`.)

Context-loss UX in `apps/web`: when `onContextLost` fires, render a centered overlay
("Graphics context lost — reload to continue", reload button). No auto-restore attempt
in Phase 1 (restore-in-place is a later task; §12 allows "graceful reload prompt").

## Inputs / Outputs

- **Inputs:** repo secrets (added by a human — list them in the PR description as a
  required manual step).
- **Outputs:** preview URL per PR; production URL on main; overlay on context loss.

## Constraints & Forbidden Actions

- Do not modify the CI `verify`/`e2e` jobs (deploy is a separate workflow file).
- scene-host change is exactly the optional prop + `webglcontextlost` listener on the
  canvas (with `event.preventDefault()`), added/removed with the Canvas lifecycle.
  No other scene-host file churn; existing tests stay green unmodified.
- No Sentry/web-vitals yet (monitoring is listed in §12 but needs account decisions —
  out of scope; leave a TODO in the workflow referencing §12).
- No new dependencies.

## Common Mistakes (architecture §12)

- Immutable cache on `index.html` or `manifest.json` — only content-hashed files are
  immutable; the two mutable entry points are explicitly `no-cache`.
- Forgetting `event.preventDefault()` in `webglcontextlost` (without it the browser
  never offers a restored context — and some browsers log errors).
- Testing context loss only manually — use the `WEBGL_lose_context` extension in a
  unit/E2E test to force it deterministically.

## Acceptance Tests

The task is DONE only when these pass in CI:

1. `pnpm --filter @cosmos/scene-host test` — new test: simulate `webglcontextlost`
   (jsdom event on the canvas) → `onContextLost` called once; unmount removes the
   listener; absent prop → no crash. Existing suites unmodified and green.
2. New `e2e/tests/context-loss.spec.ts` (chromium): evaluate
   `canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()` →
   the reload overlay becomes visible.
3. `deploy.yml` runs green on the PR (or is cleanly skipped if secrets aren't set —
   then attach a screenshot of a successful manual `pages-action` run / preview URL
   in the PR description as the human-verified step).
4. `pnpm verify` exits 0.

## Deliverables

- `.github/workflows/deploy.yml`
- `apps/web/public/_headers`
- `packages/scene-host/src/SceneHost.tsx` (prop + listener),
  `test/context-loss.test.tsx`, README API note
- `apps/web` context-loss overlay component + wiring
- `e2e/tests/context-loss.spec.ts`

## Context Files

- `docs/architecture.md` §12 (whole section)
- `packages/scene-host/src/SceneHost.tsx`, `README.md` (current state)
- `e2e/playwright.config.ts` (harness conventions from TASK-014)
