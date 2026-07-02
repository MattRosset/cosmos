# Task: Env-configurable Gaia octree manifest URL (production-pack deploy readiness)

**ID:** TASK-065
**Target package:** `apps/web` ONLY (+ `.env` documentation)
**Size:** S
**Phase:** Maintenance track (post-4a)
**Depends on:** TASK-053, TASK-061

## Goal

The app can point at the production Gaia DR3 octree pack (~4.7M stars, built by
`tools/pack-octree` gaia-ingest per ADR-006) via a build-time environment variable,
without a code change. Today the URL is a hardcoded const with a comment saying "the
full pack URL is a deploy-time config" and "Swap this line to the pack under test" —
i.e. the mechanism was always intended but never built (source:
`docs/research/gaia-visibility-real-pack-and-perf.md` open item).

**What this task does and does not mean:**
- **Local dev has already validated full Gaia packs** — dense multi-million-star catalogs
  built locally and pointed at via `.env.local` / manifest URL swap during the TASK-052
  sweep (BUG-8, BUG-10, visibility). That is not the gap.
- **The gap is production:** committed builds and CI default to the 135-star
  `octree-gaia-sample`; end users on the deployed site do not yet get the full catalog
  until the pack is uploaded to CDN/R2 and the build env points at it. TASK-065 formalizes
  that deploy-time switch.

The committed 135-star sample stays the default when the env var is unset, so every
existing gate, baseline, and CI flow is untouched.

Out of scope, explicitly: building/uploading the production pack itself (an
ops/reference-machine activity — the commands live in `tools/pack-octree/README.md`),
and any streaming/perf tuning it may reveal (that is BUG-10 P1/P2, tracked in
`docs/agent-tasks/BUG-10-P1-eviction-count-backstop.md`).

## Frozen Interface

No package API changes. The only contract added:

- Build-time env var **`VITE_GAIA_OCTREE_MANIFEST_URL`** (string, a URL path or
  absolute URL to an ADR-003-format `octree.json` manifest).
- Unset ⇒ exactly the current behavior: `'/packs/octree-gaia-sample/octree.json'`.

## Deliverables

1. **EDIT `apps/web/src/app/packs.ts`** (this file exists after TASK-061; it holds the
   pack URL consts moved out of `App.tsx`). Replace the `GAIA_OCTREE_MANIFEST_URL`
   const with:

```ts
/**
 * Gaia DR3 octree manifest (ADR-006). The committed 135-star sample is the default;
 * production/dense packs are selected at BUILD time via VITE_GAIA_OCTREE_MANIFEST_URL
 * (TASK-065) — e.g. a CDN/R2 URL for the ~4.7M-star pack, or a local dense pack
 * (gitignored) for BUG-10 measurement. Vite inlines the value at build; it is not a
 * runtime switch.
 */
export const GAIA_OCTREE_MANIFEST_URL: string =
  import.meta.env.VITE_GAIA_OCTREE_MANIFEST_URL ?? '/packs/octree-gaia-sample/octree.json';
```

   Keep the BUG-10 measurement notes from the original comment if they are not already
   captured above. Delete the old "Swap this line" instruction — it is superseded by
   the env var.

2. **CREATE `apps/web/src/vite-env.d.ts`** (none exists today) so the variable is
   typed under `strict` + `noUncheckedIndexedAccess`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** TASK-065: Gaia octree manifest override; unset ⇒ committed sample pack. */
  readonly VITE_GAIA_OCTREE_MANIFEST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

   If `tsc` reports duplicate `ImportMeta`/`ImportMetaEnv` declarations (vite/client
   already augments them in this Vite version), switch to the non-conflicting form:
   keep only the `/// <reference types="vite/client" />` line plus a
   `declare module` — or simply cast at the single use site:
   `(import.meta.env as { VITE_GAIA_OCTREE_MANIFEST_URL?: string }).VITE_GAIA_OCTREE_MANIFEST_URL`.
   Prefer the d.ts; use the cast only if the d.ts genuinely conflicts. Do not disable
   any compiler option.

3. **EDIT `.env`** (repo root — it exists and is the documented home for local config):
   append a commented example, do not set a value:

```
# TASK-065: point the web build at a production/dense Gaia octree pack.
# Unset = committed 135-star sample (/packs/octree-gaia-sample/octree.json).
# VITE_GAIA_OCTREE_MANIFEST_URL=https://<cdn-host>/packs/octree-gaia-full/octree.json
```

4. **EDIT `tools/pack-octree/README.md`** — add a short "Deploying a production pack"
   subsection (≤ 10 lines): build the pack with the existing gaia-ingest command,
   upload the output directory to static hosting (same-origin path or CORS-enabled
   CDN), set `VITE_GAIA_OCTREE_MANIFEST_URL` in the deploy environment, rebuild
   `apps/web`. State explicitly that tile URLs resolve relative to the manifest URL,
   so the whole pack directory must be uploaded as-is (verify this claim against
   `packages/data`'s octree loader before writing it — if tile URLs resolve differently,
   describe what the loader actually does instead).

## Inputs / Outputs

- **Input:** hardcoded sample-pack URL; deploy requires a source edit.
- **Output:** `pnpm --filter @cosmos/web build` with the env var set produces a bundle
  pointing at the configured manifest; without it, a byte-equivalent-behavior bundle
  pointing at the sample.

## Constraints & Forbidden Actions

- Do NOT change the default URL, any other pack URL, or any loading logic.
- Do NOT make it a runtime/query-param switch (the e2e determinism doctrine pins what
  CI loads; build-time only).
- Do NOT touch e2e specs, baselines, CI workflows, or `packages/*` (except reading
  `packages/data` for Deliverable 4's verification).
- Do NOT commit any dense pack or set the variable anywhere in CI.
- If TASK-061 is not merged (no `apps/web/src/app/packs.ts`), set Status to `blocked` —
  do not apply the edit to `App.tsx` instead.

## Common Mistakes

- Typing `import.meta.env.X` without the d.ts under this tsconfig — build breaks only
  on `tsc --noEmit` (`pnpm --filter @cosmos/web build` runs it first; run that early).
- Documenting CDN upload without checking how tile paths resolve relative to the
  manifest (Deliverable 4's verification step exists because a wrong claim here costs
  an ops afternoon).
- Adding the env var to `.env` uncommented — every dev build would silently fetch a
  remote pack.

## Acceptance Tests

The task is DONE only when all pass:

1. `pnpm verify` exits 0.
2. `pnpm test:e2e` exits 0 (env unset ⇒ zero behavior change through the whole gate).
3. Override proof (PowerShell, from repo root):
   `$env:VITE_GAIA_OCTREE_MANIFEST_URL='/packs/octree-test-marker/octree.json'; pnpm --filter @cosmos/web build; Remove-Item Env:VITE_GAIA_OCTREE_MANIFEST_URL`
   then `Select-String -Path apps/web/dist/assets/*.js -Pattern 'octree-test-marker'`
   finds ≥ 1 hit, and after an unset rebuild the same grep finds 0 hits while
   `octree-gaia-sample` finds ≥ 1.
4. `git status` shows no accidental `dist/` or pack files staged.

## Context Files

- `apps/web/src/app/packs.ts` (post-TASK-061 home of the const; pre-split reference:
  `App.tsx` lines ~119–124)
- `docs/decisions/ADR-006-gaia-subset-tier-unification.md` (pack format + tier model)
- `docs/research/gaia-visibility-real-pack-and-perf.md` (the open item this closes)
- `tools/pack-octree/README.md` + `packages/data` octree loader (tile URL resolution)
- `.env` (existing shape)
