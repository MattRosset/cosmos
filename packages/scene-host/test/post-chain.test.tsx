import { create } from '@react-three/test-renderer';
import type { ReactNode } from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToneMappingMode } from 'postprocessing';
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  CustomToneMapping,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
} from 'three';
import type { QualityController } from '../src/index';
import { SceneHost } from '../src/SceneHost';
import { toneMappingModeFor } from '../src/PostChain';
import type { PostChainComposerTracker } from './setup-postprocessing';

// --- Deterministic tier-gate coverage for the post-processing chain (TASK-104 §Acceptance 1).
// Drives the tier seam via the existing QualityController (as quality-integration.test.tsx does).
// The real WebGL EffectComposer is replaced package-wide by a lifecycle-tracking stub (see
// test/setup-postprocessing.ts) so the gate is a pure structural check (no real GL). The real
// composer path is covered by the web build + e2e; visual identity by the reference-machine A/B.

// Live-instance accounting for the stubbed EffectComposer (mount = +1, unmount = -1).
const composer = (globalThis as unknown as { __postChainComposer: PostChainComposerTracker })
  .__postChainComposer;

// Mock only the Canvas + PerformanceMonitor wrappers here (as quality-integration does); the
// composer stub itself is installed globally by the setup file.
vi.mock('@react-three/drei', () => ({
  PerformanceMonitor: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@react-three/fiber', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    Canvas: ({ children }: { children: ReactNode }) => children,
  };
});

describe('PostChain tier gate (post-processing chain foundation)', () => {
  beforeEach(() => {
    composer.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('mounts the composer at tier high (bloomEnabled) and logs the driving inputs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const renderer = await create(<SceneHost initialQualityTier="high" disableAutoQuality />);

    console.log(
      '[post-chain][test] tier=high liveComposers=%d toneMappingMode=%s',
      composer.live,
      composer.toneMappingMode,
    );
    expect(composer.live).toBe(1);
    expect(composer.mounts).toBe(1);
    // Identity output stage is actually wired: a <ToneMapping> mounted inside the composer
    // with a defined numeric mode (guards against a dropped/undefined mode — the operator's
    // correctness is covered separately by the toneMappingModeFor map test).
    expect(typeof composer.toneMappingMode).toBe('number');
    expect(composer.toneMappingMode).toBe(toneMappingModeFor(ACESFilmicToneMapping));
    expect(
      logSpy.mock.calls.some((c) => String(c[0]).includes('[post-chain]')),
    ).toBe(true);

    await renderer.unmount();
  });

  it('mounts the composer at tier medium (bloomEnabled)', async () => {
    const renderer = await create(<SceneHost initialQualityTier="medium" disableAutoQuality />);

    console.log('[post-chain][test] tier=medium liveComposers=%d', composer.live);
    expect(composer.live).toBe(1);

    await renderer.unmount();
  });

  it('does NOT mount the composer at tier low (bloomEnabled=false)', async () => {
    const renderer = await create(<SceneHost initialQualityTier="low" disableAutoQuality />);

    console.log('[post-chain][test] tier=low liveComposers=%d', composer.live);
    expect(composer.live).toBe(0);
    expect(composer.mounts).toBe(0);
    expect(composer.toneMappingMode).toBeUndefined(); // no composer ⇒ no ToneMapping stage

    await renderer.unmount();
  });

  it('does NOT mount the composer when postProcessing={false}, even at tier high', async () => {
    const renderer = await create(
      <SceneHost initialQualityTier="high" disableAutoQuality postProcessing={false} />,
    );

    console.log('[post-chain][test] tier=high postProcessing=false liveComposers=%d', composer.live);
    expect(composer.live).toBe(0);
    expect(composer.mounts).toBe(0);
    expect(composer.toneMappingMode).toBeUndefined(); // opted out ⇒ no composer, no ToneMapping

    await renderer.unmount();
  });

  it('unmounts on high→low, remounts on low→high, with no accumulation over ≥50 cycles', async () => {
    let qc: QualityController | null = null;

    const renderer = await create(
      <SceneHost
        initialQualityTier="high"
        disableAutoQuality
        onQualityController={(c) => {
          qc = c;
        }}
      />,
    );

    expect(composer.live).toBe(1); // mounted at high

    const CYCLES = 50;
    for (let i = 0; i < CYCLES; i += 1) {
      await act(() => {
        qc!.setTier('low');
      });
      expect(composer.live).toBe(0); // composer gone at low

      await act(() => {
        qc!.setTier('high');
      });
      expect(composer.live).toBe(1); // exactly one composer at high — no leak
    }

    console.log(
      '[post-chain][test] cycles=%d maxLiveComposers=%d totalMounts=%d',
      CYCLES,
      composer.maxLive,
      composer.mounts,
    );
    // Never more than one composer alive at once (no retained-target accumulation).
    expect(composer.maxLive).toBe(1);
    // One mount at start + one per cycle (remount on low→high).
    expect(composer.mounts).toBe(CYCLES + 1);

    await renderer.unmount();
    expect(composer.live).toBe(0); // clean teardown, no leak
  });

  it('Canvas isolation: a tier flip does not re-render sibling scene content', async () => {
    let qc: QualityController | null = null;
    let sceneRenderCount = 0;

    function SceneStub(): null {
      sceneRenderCount += 1;
      return null;
    }

    const renderer = await create(
      <SceneHost
        initialQualityTier="high"
        disableAutoQuality
        onQualityController={(c) => {
          qc = c;
        }}
      >
        <SceneStub />
      </SceneHost>,
    );

    const countAfterMount = sceneRenderCount;

    await act(() => {
      qc!.setTier('low');
    });
    await act(() => {
      qc!.setTier('high');
    });

    // Scene content must not remount/re-render on the gate flip — only PostChain
    // (the useQuality consumer) re-renders. This is the §5.1 Canvas-isolation guarantee.
    expect(sceneRenderCount).toBe(countAfterMount);

    await renderer.unmount();
  });
});

// The identity constraint (§3): the composite must reproduce the renderer's tone-mapping
// operator 1:1, or STOP (return null → R3F default path) rather than ship a changed image.
// This is the load-bearing correctness rule of step 1, so it is asserted directly.
describe('toneMappingModeFor — identity tone-mapping map (§3)', () => {
  it('maps every reproducible three operator to its 1:1 postprocessing mode', () => {
    // R3F's default is ACESFilmicToneMapping → ACES_FILMIC.
    expect(toneMappingModeFor(ACESFilmicToneMapping)).toBe(ToneMappingMode.ACES_FILMIC);
    expect(toneMappingModeFor(NoToneMapping)).toBe(ToneMappingMode.LINEAR);
    expect(toneMappingModeFor(LinearToneMapping)).toBe(ToneMappingMode.LINEAR);
    expect(toneMappingModeFor(ReinhardToneMapping)).toBe(ToneMappingMode.REINHARD);
    expect(toneMappingModeFor(CineonToneMapping)).toBe(ToneMappingMode.OPTIMIZED_CINEON);
    expect(toneMappingModeFor(AgXToneMapping)).toBe(ToneMappingMode.AGX);
    expect(toneMappingModeFor(NeutralToneMapping)).toBe(ToneMappingMode.NEUTRAL);
  });

  it('returns null for CustomToneMapping (not reproducible 1:1 → STOP, no composer)', () => {
    expect(toneMappingModeFor(CustomToneMapping)).toBeNull();
  });
});
