import { vi } from 'vitest';

/**
 * Package-level test stub for `@react-three/postprocessing` (TASK-104).
 *
 * WHY: a real WebGL2 `<EffectComposer>` cannot initialize on `@react-three/test-renderer`'s
 * mock GL — its `setRenderer` reads `renderer.getContextAttributes().alpha`, which is
 * `undefined` under the mock, throwing before any assertion runs. This is the repo's standing
 * "vitest has no WebGL → WebGL is covered in e2e" boundary (see docs/testing-conventions.md,
 * `[[scale-transition-lane-state]]`): the composer is a WebGL construct, so the unit env stubs
 * it. The REAL composer is exercised by `pnpm --filter @cosmos/web build` and `pnpm test:e2e`
 * (StarApp at medium/high), and its visual identity by the reference-machine A/B (TASK-104
 * "Verification beyond the gate").
 *
 * The stub is a deterministic proxy that runs the React lifecycle (mount/unmount) without any
 * GL, so tests can gate on the tier seam (composer present ⇔ `postProcessing && bloomEnabled`)
 * and detect retained-target leaks across tier flips. Instance counts are exposed on
 * `globalThis.__postChainComposer` for `post-chain.test.tsx`; every other scene-host test simply
 * loads `SceneHost` crash-free (they never read the counters).
 *
 * setupFiles run in each test file's module context, so this vi.mock applies package-wide.
 */

export interface PostChainComposerTracker {
  live: number;
  maxLive: number;
  mounts: number;
  /** The `mode` prop of the `<ToneMapping>` currently mounted inside the composer
   *  (undefined when no composer/ToneMapping is mounted). Lets the gate assert the
   *  identity output stage is actually wired — the one thing a stub could hide. */
  toneMappingMode: number | undefined;
  reset(): void;
}

const tracker = vi.hoisted<PostChainComposerTracker>(() => {
  const t = {
    live: 0,
    maxLive: 0,
    mounts: 0,
    toneMappingMode: undefined as number | undefined,
    reset(): void {
      t.live = 0;
      t.maxLive = 0;
      t.mounts = 0;
      t.toneMappingMode = undefined;
    },
  };
  return t;
});

(globalThis as unknown as { __postChainComposer: PostChainComposerTracker }).__postChainComposer =
  tracker;

vi.mock('@react-three/postprocessing', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react') as {
    useEffect: (effect: () => (() => void) | void, deps: unknown[]) => void;
  };
  // Renders its children (so the <ToneMapping> identity stage actually mounts and can be
  // observed) and tracks mount/unmount for the leak + tier-gate assertions.
  function EffectComposerStub({ children }: { children?: unknown }): unknown {
    React.useEffect(() => {
      tracker.live += 1;
      tracker.mounts += 1;
      if (tracker.live > tracker.maxLive) tracker.maxLive = tracker.live;
      return () => {
        tracker.live -= 1;
      };
    }, []);
    return children ?? null;
  }
  // Records the tone-mapping mode it was handed (identity output stage) and clears it on
  // unmount — so the gate can prove PostChain wires a <ToneMapping mode=…> into the composer.
  function ToneMappingStub({ mode }: { mode?: number }): null {
    React.useEffect(() => {
      tracker.toneMappingMode = mode;
      return () => {
        tracker.toneMappingMode = undefined;
      };
    }, [mode]);
    return null;
  }
  return {
    EffectComposer: EffectComposerStub,
    ToneMapping: ToneMappingStub,
  };
});
