# Task: Decompose `apps/web/src/App.tsx` into per-composition modules (mechanical split)

**ID:** TASK-061
**Target package:** `apps/web` ONLY
**Size:** M
**Phase:** Maintenance track (post-4a)
**Depends on:** TASK-053, TASK-060

## Goal

`App.tsx` (currently 1,867 lines) becomes a ~70-line dispatcher, and every function it
contains moves VERBATIM into its own file. This is pure file hygiene motivated by
architecture §8.5 ("no package over ~3k LOC … README + core-types is sufficient
context") — `apps/web` grew into the one place that rule doesn't hold, and it is where
integration bugs concentrate (see
`docs/research/project-state-architecture-testing-review.md` §2.2 item 1). **This task
is a MOVE, not a refactor.** Every function body, every hook call, every dependency
array, every comment is copied character-for-character. The only new code is import
statements and `export` keywords. Behavior must be byte-identical — the e2e gate suite
(which drives the debug apps being moved) is the proof.

## Frozen Interface

No package API changes. The app's externally observable surface is frozen:

- All `?debug=` URL modes behave identically (`markers`, `jitter`, `ctxswitch`, `m3`,
  `m4a`, `flythrough3`, `flythrough4`, `soak3`, `soak4`, `errorgate`,
  `breadcrumb-profile`) plus `?baseline=m3`, `?loops=N`, `?inject=1`.
- `window.__cosmosDev` and `window.__cosmos` surfaces unchanged.
- `apps/web/src/main.tsx` keeps importing `{ App }` from `'./App'`.

## Deliverables — the exact file map

Create the directory `apps/web/src/app/` and move code out of `App.tsx` as follows.
Line numbers refer to the current `App.tsx` (verify against the real file before
cutting; if the file has drifted from these ranges, match by the function/const names,
which are authoritative).

| New file | What moves into it (verbatim) |
|---|---|
| `app/flags.ts` | All URL-flag consts, lines ~62–140: `DEBUG_MARKERS`, `DEBUG_JITTER`, `DEBUG_CTXSWITCH`, `DEBUG_M3`, `DEBUG_FLYTHROUGH3`, `DEBUG_FLYTHROUGH4`, `FLYTHROUGH4_BASELINE`, `DEBUG_SOAK3`, `DEBUG_SOAK4`, `SOAK3_LOOPS`, `DEBUG_BREADCRUMB_PROFILE`, `DEBUG_M4A`, `DEBUG_ERRORGATE`, `ERRORGATE_INJECT`. All become `export const`. Keep every doc comment. |
| `app/packs.ts` | The pack URL consts (lines ~113–124): `M3_SOL_SYSTEM_ID`, `HYG_MANIFEST_URL`, `SOL_PACK_URL`, `EXO_PACK_URL`, `OCTREE_MANIFEST_URL`, `GAIA_OCTREE_MANIFEST_URL`, `CONSTELLATIONS_URL`; plus `TOUR_ORBIT_RADIUS_M`; plus the `Sources` interface and `PackState` type (lines ~145–184). All exported. |
| `app/dev-surface.ts` | The `declare global { interface Window { __cosmosDev?: … } }` block (lines ~162–179). Add `export {};` at the end so it stays a module. |
| `app/JitterApp.tsx` | `JitterApp` (lines ~198–210) → `export function JitterApp()`. |
| `app/CtxSwitchApp.tsx` | `CtxSwitchApp` (lines ~212–309). |
| `app/M3App.tsx` | `M3App` (lines ~311–447). |
| `app/M4aApp.tsx` | `M4aApp` (lines ~449–622). |
| `app/ErrorGateApp.tsx` | `injectOctreeFault` (lines ~624–646, keep it unexported) + `ErrorGateApp` (lines ~648–800). |
| `app/Flythrough4ProbeApp.tsx` | `Flythrough4ProbeApp` (lines ~802–966). |
| `app/Soak4ProbeApp.tsx` | `Soak4ProbeApp` (lines ~968–1133). |
| `app/StreamingProbeApp.tsx` | `StreamingProbeApp` (lines ~1135–1288). |
| `app/DebugApp.tsx` | `DebugApp` (lines ~1460–1479). |
| `app/StarApp.tsx` | `StarApp` (lines ~1481–2018) — the production composition, moved whole. Verbatim it lands at ~654 lines (the earlier ~560 estimate did not count the standalone import block); that is acceptable for this task (see Constraints). Do NOT extract a hook to shrink it — the ≤660 cap below exists precisely so the move stays mechanical. |
| `hud/Crosshair.tsx` | `Crosshair` (lines ~1290–1303). |
| `hud/Breadcrumb.tsx` | `Breadcrumb` (lines ~1305–1398). |
| `hud/SpeedReadout.tsx` | `fmtSpeed` (unexported) + `SpeedReadout` (lines ~1400–1447). |
| `hud/ContextLostOverlay.tsx` | `ContextLostOverlay` (lines ~1449–1458). |

Then rewrite `App.tsx` to contain ONLY: the flag imports from `./app/flags`, the app
imports, and the existing dispatcher (current lines ~186–196), preserving its exact
`if`-order:

```tsx
import {
  DEBUG_MARKERS, DEBUG_JITTER, DEBUG_CTXSWITCH, DEBUG_M3, DEBUG_FLYTHROUGH3,
  DEBUG_FLYTHROUGH4, FLYTHROUGH4_BASELINE, DEBUG_SOAK3, DEBUG_SOAK4,
  DEBUG_M4A, DEBUG_ERRORGATE, ERRORGATE_INJECT,
} from './app/flags';
import { JitterApp } from './app/JitterApp';
import { CtxSwitchApp } from './app/CtxSwitchApp';
import { ErrorGateApp } from './app/ErrorGateApp';
import { M4aApp } from './app/M4aApp';
import { Flythrough4ProbeApp } from './app/Flythrough4ProbeApp';
import { Soak4ProbeApp } from './app/Soak4ProbeApp';
import { M3App } from './app/M3App';
import { StreamingProbeApp } from './app/StreamingProbeApp';
import { DebugApp } from './app/DebugApp';
import { StarApp } from './app/StarApp';

export function App() {
  if (DEBUG_JITTER) return <JitterApp />;
  if (DEBUG_CTXSWITCH) return <CtxSwitchApp />;
  if (DEBUG_ERRORGATE) return <ErrorGateApp inject={ERRORGATE_INJECT} />;
  if (DEBUG_M4A) return <M4aApp />;
  if (DEBUG_FLYTHROUGH4) return <Flythrough4ProbeApp baseline={FLYTHROUGH4_BASELINE} />;
  if (DEBUG_SOAK4) return <Soak4ProbeApp />;
  if (DEBUG_M3) return <M3App />;
  if (DEBUG_FLYTHROUGH3 || DEBUG_SOAK3) return <StreamingProbeApp kind={DEBUG_SOAK3 ? 'soak3' : 'flythrough3'} />;
  return DEBUG_MARKERS ? <DebugApp /> : <StarApp />;
}
```

### Mechanical rules for every moved file

1. Copy the function body and its doc comment character-for-character. Add `export`
   to the function. Nothing else changes inside the braces.
2. Recreate imports by copying the needed lines from the current `App.tsx` import
   block (lines 1–60) and adjusting relative paths for the new location:
   `./scene/X` → `../scene/X`, `./glue/X` → `../glue/X`, `./hud/Hud` → `../hud/Hud`,
   `./ErrorBoundary` → `../ErrorBoundary`. Package imports (`@cosmos/*`, `react`)
   are unchanged. Shared consts/types come from `./flags` and `./packs`
   (same-directory for files in `app/`).
3. Files that reference `window.__cosmosDev` (`M4aApp.tsx`, `StarApp.tsx`) must
   `import './dev-surface';` (side-effect import for the global declaration).
4. `StarApp.tsx` also imports `DEBUG_BREADCRUMB_PROFILE` from `./flags` (it renders
   `BreadcrumbFrameProfiler` behind that flag) and `Crosshair` / `Breadcrumb` /
   `SpeedReadout` / `ContextLostOverlay` from `../hud/`.
5. `Flythrough4ProbeApp.tsx` imports `DEBUG_BREADCRUMB_PROFILE` and
   `DEBUG_FLYTHROUGH4` from `./flags` (used in its `profileActive` prop).
6. The side-effect import `import './glue/frame-profiler';` (current line 60) stays in
   `App.tsx` as `import './glue/frame-profiler';` — it must keep running in every mode.
7. Duplication between the debug apps (the near-identical pack-loading effects,
   `mountedSystem` memos, handler callbacks) is INTENTIONAL and must remain duplicated.
   Do not extract shared hooks. (Rationale: the gate probes are frozen compositions;
   merging their effect/memo structures changes React identity semantics and risks
   invalidating milestone baselines. A shared abstraction is a separate, explicitly
   reviewed task if ever justified.)

## Inputs / Outputs

- **Input:** `apps/web/src/App.tsx` @ 1,867 lines, `pnpm verify` + `pnpm test:e2e` green.
- **Output:** same behavior; `App.tsx` < 100 lines; no file under `apps/web/src/` other
  than `app/StarApp.tsx` exceeds 520 lines; `app/StarApp.tsx` ≤ 660 lines.

## Constraints & Forbidden Actions

- Touch ONLY `apps/web/src/App.tsx` and the new files listed above. Do not edit
  `apps/web/src/scene/*`, `apps/web/src/glue/*`, `apps/web/src/hud/Hud.tsx`, any
  package, any e2e spec, or any screenshot baseline.
- ZERO logic changes: no renamed identifiers, no reordered hooks, no merged effects, no
  dependency-array edits, no removed comments, no added abstractions, no "while I'm
  here" fixes. If you notice a bug, note it in the PR description and leave the code
  as-is.
- Do not add dependencies.
- Do not change `main.tsx`.
- If a quoted line range does not match the file (drift since this spec was written),
  match by symbol name; if a symbol is missing entirely, set Status to `blocked`.

## Common Mistakes

- Forgetting the `dev-surface` side-effect import → `window.__cosmosDev` typechecks
  fail only in the two files that assign it.
- Dropping the `import './glue/frame-profiler';` side-effect → the `@perf`
  breadcrumb-profile spec loses its `__cosmosProfileSpan` hook (not caught by the CI
  gate — check it explicitly).
- Converting default exports / renaming components — component names are load-bearing
  for React DevTools traces referenced in research docs; keep names identical.
- Extracting the duplicated pack-load effect into a helper "because it's obviously
  shared" — explicitly forbidden (rule 7 above).

## Acceptance Tests

The task is DONE only when all pass:

1. `pnpm verify` exits 0.
2. `pnpm test:e2e` exits 0 (chromium deterministic gate — exercises `ctxswitch`, `m3`,
   `m4a`, `flythrough3/4`, `soak3/4`, `errorgate` = every moved debug app).
3. Line-count gate (PowerShell, from repo root):
   `Get-ChildItem apps/web/src -Recurse -Include *.ts,*.tsx | ForEach-Object { [pscustomobject]@{ n = $_.FullName; c = (Get-Content $_).Count } } | Where-Object { $_.c -gt 660 }`
   returns nothing, and `(Get-Content apps/web/src/App.tsx).Count` < 100.
4. `?debug=breadcrumb-profile` still populates `window.__breadcrumbProfile` (run
   `pnpm --filter @cosmos/e2e exec playwright test breadcrumb-profile --project=chromium`
   locally — it is `@perf`, so CI won't check it for you).
5. Zero changes outside `apps/web/src/App.tsx` + new files
   (`git status --short` shows only those paths).

## Context Files

- `apps/web/src/App.tsx` (read it fully before cutting)
- `apps/web/src/main.tsx`
- `docs/architecture.md` §8.5 (size doctrine), §5.1 (scene-host boundaries)
- `docs/research/project-state-architecture-testing-review.md` §2.2
- `docs/testing-conventions.md` (why the e2e gate is the behavioral proof)
