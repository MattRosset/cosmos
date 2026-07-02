# Task: `nav` boundary conformance — move the R3F hook to app glue + complete the boundary lint

**ID:** TASK-060
**Target package:** `packages/nav`, `packages/scene-host` (one additive export), `apps/web`, `eslint.config.js`
**Size:** M
**Phase:** Maintenance track (post-4a)
**Depends on:** TASK-053

## Goal

`packages/nav` no longer imports React, `@react-three/fiber`, or `@cosmos/scene-host` —
restoring the architecture §4 rule "only `apps/web` and `scene-host` glue may import
across groups" (source: `docs/research/project-state-architecture-testing-review.md` §2.2
item 2). The `useFlightController` React hook moves verbatim into `apps/web/src/glue/`
(it is glue: it wires the pure controller to the R3F camera). The ESLint boundary rules
are then completed so this class of violation cannot recur: `coords`, `orbits`,
`sim-time` join the pure-package ban block, and a new `nav` block bans
react/fiber/three/scene-host. Behavior is byte-identical — this is a file move plus
lint config, zero logic changes.

## Frozen Interface

The controller API is frozen and must not change:

```ts
// packages/nav/src/controller.ts — DO NOT MODIFY
export function createFlightController(opts: FlightControllerOptions): FlightController;
```

**Sanctioned API changes (this task only, nothing else):**

1. `@cosmos/nav` REMOVES the `useFlightController` export (it moves to app glue).
2. `@cosmos/scene-host` ADDS one export: `FrameLoopRoot` (already exported from
   `packages/scene-host/src/SceneHost.tsx`; it is currently deep-imported by the nav
   test — re-exporting it from the package index removes that deep import).

The moved hook keeps its exact signature:

```ts
export function useFlightController(
  opts: Omit<FlightControllerOptions, 'origin'> & { origin: OriginManager },
): FlightController;
```

## Deliverables

Create/modify/delete ONLY these files:

1. **CREATE `apps/web/src/glue/useFlightController.tsx`** — exact content below (this is
   `packages/nav/src/useFlightController.tsx` with only the `./controller.js` import
   changed to `@cosmos/nav`):

```tsx
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import type { OriginManager } from '@cosmos/coords';
import { PRIORITY_NAV, useFrameContext } from '@cosmos/scene-host';
import {
  createFlightController,
  type FlightController,
  type FlightControllerOptions,
} from '@cosmos/nav';

const renderPosScratch: [number, number, number] = [0, 0, 0];

/**
 * App glue (TASK-060, formerly packages/nav): creates the controller, subscribes at
 * PRIORITY_NAV, and copies state into the R3F camera each frame (the ONLY place that
 * touches camera).
 */
export function useFlightController(
  opts: Omit<FlightControllerOptions, 'origin'> & { origin: OriginManager },
): FlightController {
  const controller = useMemo(() => createFlightController(opts), [opts.origin]);

  const { camera, gl } = useThree();

  useEffect(() => {
    const el = gl.domElement;
    const dispose = controller.attach(el);
    return dispose;
  }, [controller, gl.domElement]);

  useFrameContext((ctx) => {
    const profile = (globalThis as typeof globalThis & { __cosmosProfileSpan?: (n: string, fn: () => void) => void })
      .__cosmosProfileSpan;
    const run = profile ?? ((_n: string, fn: () => void) => fn());
    run('nav.update', () => controller.update(ctx.dtMs));
    const { orientation } = controller.state;
    run('nav.cameraSync', () => {
      opts.origin.toRenderSpace(controller.state.position, renderPosScratch);
      camera.position.set(renderPosScratch[0], renderPosScratch[1], renderPosScratch[2]);
      camera.quaternion.set(orientation[0], orientation[1], orientation[2], orientation[3]);
    });
  }, PRIORITY_NAV);

  return controller;
}
```

   Keep the `useMemo(..., [opts.origin])` dependency array EXACTLY as shown — it is
   intentional (controller identity is keyed to the origin manager, not the whole opts
   object).

2. **DELETE `packages/nav/src/useFlightController.tsx`**.

3. **EDIT `packages/nav/src/index.ts`** — remove exactly one line:
   `export { useFlightController } from './useFlightController.js';`

4. **EDIT `packages/scene-host/src/index.ts`** — change the SceneHost line to also
   re-export `FrameLoopRoot`:

```ts
export { SceneHost, FrameLoopRoot, useFrameContext, type SceneHostProps } from './SceneHost.js';
```

5. **EDIT the 8 importers in `apps/web/src/scene/`** — each currently imports
   `useFlightController` from `'@cosmos/nav'` alongside other nav symbols. Remove
   `useFlightController` from the `@cosmos/nav` import and add a second import from the
   new glue file. The files (all in `apps/web/src/scene/`): `NavDriver.tsx`,
   `DebugMarkers.tsx`, `CtxSwitchProbe.tsx`, `M3DescentProbe.tsx`, `ErrorGateProbe.tsx`,
   `Flythrough3Probe.tsx`, `Flythrough4Probe.tsx`, `SoakProbe.tsx`. The new import in
   every one of them is:

```ts
import { useFlightController } from '../glue/useFlightController';
```

6. **MOVE the hook test** — delete `packages/nav/test/useFlightController.test.tsx` and
   create `apps/web/src/glue/useFlightController.test.tsx` with the same content plus
   these three changes: (a) add `// @vitest-environment jsdom` as the first line;
   (b) import `FrameLoopRoot` from `'@cosmos/scene-host'` (was a deep relative import
   `'../../scene-host/src/SceneHost'`); (c) import `useFlightController` from
   `'./useFlightController'`.

7. **EDIT `packages/nav/test/index.test.ts`** — it imports and asserts
   `useFlightController` from `'../src/index'`. Remove that import and its assertion
   (`expect(useFlightController).toBeTypeOf('function')`); keep the
   `createFlightController` assertion.

8. **EDIT `apps/web/vitest.config.ts`** — the moved test is `.tsx`; widen the include
   pattern and add the react plugin. Change to:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/glue/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/glue/octree-combined.ts'],
      thresholds: {
        statements: 90,
      },
    },
  },
});
```

   Keep the existing file-header comment; do NOT widen `coverage.include` (the coverage
   gate stays scoped to `octree-combined.ts`). The moved test file carries its own
   `// @vitest-environment jsdom` pragma, so the config default stays `node`.

9. **EDIT `apps/web/package.json`** — add to `devDependencies`:
   `"@react-three/test-renderer": "^9.1.0"` (same version pin `packages/nav` used).
   Then run `pnpm install` to update the lockfile.

10. **EDIT `packages/nav/package.json`** — after the move nothing in `packages/nav`
    imports React, fiber, three, or scene-host. Remove from `dependencies`:
    `@cosmos/scene-host`, `@react-three/fiber`, `react`, `three`. Remove from
    `devDependencies`: `@react-three/test-renderer`, `@types/react`, `@types/three`,
    `@vitejs/plugin-react`. KEEP `jsdom` (the controller/input tests attach DOM
    listeners). KEEP `@cosmos/coords` and `@cosmos/core-types`. Run `pnpm install`.

11. **EDIT `packages/nav/vitest.config.ts`** — remove the `@vitejs/plugin-react` import
    and the `plugins: [react()]` line (no `.tsx` left in nav). Keep
    `environment: 'jsdom'` and the coverage block unchanged.

12. **EDIT `eslint.config.js`** — two changes:

    (a) Extend the existing pure-package block's `files` array (currently
    `['packages/core-types/**', 'packages/procgen/**']`) to:

```js
files: [
  'packages/core-types/**',
  'packages/procgen/**',
  'packages/coords/**',
  'packages/orbits/**',
  'packages/sim-time/**',
],
```

    (b) Add a new block after it (nav is main-thread pure math + DOM input — §5.3:
    "Mutates camera only" is now the app glue hook's job):

```js
{
  // §5.3 + §4: nav is pure controller math + DOM input. The R3F camera-sync hook
  // lives in apps/web/src/glue/useFlightController.tsx (TASK-060).
  files: ['packages/nav/**'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          { name: 'three', message: 'nav must not import Three.js (§5.3).' },
          { name: 'react', message: 'nav must not import React (TASK-060: the hook lives in app glue).' },
          { name: '@react-three/fiber', message: 'nav must not import R3F (TASK-060).' },
          { name: '@cosmos/scene-host', message: 'Only apps/web glue crosses groups (§4).' },
        ],
        patterns: [
          {
            group: ['@cosmos/*/src/*'],
            message: 'Deep imports banned: use the package public API (index.ts).',
          },
        ],
      },
    ],
  },
},
```

13. **EDIT `packages/nav/README.md`** — the sections describing `useFlightController`
    (the import example near the top and the "Hook" section near the bottom) must now
    say the hook lives in `apps/web/src/glue/useFlightController.tsx` and that
    `@cosmos/nav` exposes `createFlightController` only. While editing, bring the README
    to ≤ 150 lines (architecture §8.5); trim prose, do not delete the API/invariants
    content.

## Inputs / Outputs

- **Input state:** `pnpm verify` green on main with TASK-053 closed.
- **Output state:** identical app behavior; `grep -r "from 'react'" packages/nav/src`
  returns nothing; `pnpm lint` enforces the new bans.

## Constraints & Forbidden Actions

- Do NOT modify `packages/nav/src/controller.ts` or any other nav source file beyond
  `index.ts` (and deleting the hook file). Zero logic changes anywhere.
- Do NOT modify `packages/core-types`.
- Do NOT add dependencies other than the one listed in Deliverables item 9.
- Do NOT touch `App.tsx`, the e2e specs, or any screenshot baseline (behavior must be
  byte-identical; if an e2e spec fails, you changed behavior — revert and re-check).
- Do NOT "improve" the hook while moving it (no renamed variables, no added types).
- If any step is impossible as written (e.g. a file differs from what this spec quotes),
  set Status to `blocked` and report — do not improvise.

## Common Mistakes (architecture §5.3 / §15)

- Editing the `useMemo` dependency array "to fix the exhaustive-deps warning" — the
  `[opts.origin]` key is intentional; suppress nothing, change nothing.
- Forgetting one of the 8 scene importers (typecheck catches it — run
  `pnpm --filter @cosmos/web typecheck` early).
- Removing `jsdom` from nav devDependencies (the input/controller tests need it).
- Adding the eslint nav block but leaving the moved hook banned too — the ban is scoped
  to `packages/nav/**`; `apps/web` is intentionally allowed to import all of these.

## Acceptance Tests

The task is DONE only when all pass:

1. `pnpm verify` exits 0 (lint + typecheck + unit + build, all 23 workspaces).
2. `pnpm --filter @cosmos/web test` passes and includes the moved
   `useFlightController.test.tsx` (1 test) in its output.
3. `pnpm lint` fails if you temporarily add `import 'react'` to
   `packages/nav/src/controller.ts` (spot-check the new rule, then revert).
4. `pnpm test:e2e` exits 0 (chromium deterministic gate — proves zero behavior change).
5. `packages/nav/README.md` is ≤ 150 lines.

## Context Files

- `packages/nav/src/useFlightController.tsx` (the file being moved)
- `packages/nav/src/index.ts`, `packages/nav/package.json`, `packages/nav/vitest.config.ts`
- `packages/scene-host/src/index.ts`
- `apps/web/vitest.config.ts`, `apps/web/package.json`
- `eslint.config.js`
- `docs/architecture.md` §4 (dependency rules), §5.3 (nav boundaries)
- `docs/research/project-state-architecture-testing-review.md` §2.2
