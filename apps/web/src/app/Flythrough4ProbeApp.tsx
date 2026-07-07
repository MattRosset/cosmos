import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BodyId } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import {
  loadStarPack,
  loadSystemsPack,
  loadOctreePack,
  loadConstellationPack,
  createCombinedSource,
} from '@cosmos/data';
import type { FlightController, ContextSwitchEvent } from '@cosmos/nav';
import { SceneHost, type QualityController } from '@cosmos/scene-host';
import type { StreamingPolicy } from '@cosmos/streaming';
import { StarScene } from '../scene/StarScene';
import { SystemScene } from '../scene/SystemScene';
import { GalaxyScene } from '../scene/GalaxyScene';
import { Overlays } from '../scene/Overlays';
import { Flythrough4Probe } from '../scene/Flythrough4Probe';
import { BreadcrumbFrameProfiler } from '../scene/BreadcrumbFrameProfiler';
import { FLYTHROUGH3_START, FLYTHROUGH3_EPOCH_JD } from '../scene/flythrough-descent';
import { combineOctreeSources } from '../glue/octree-combined';
import { buildOverlayData } from '../glue/overlays';
import { clock, epochProvider, installTimeGlue } from '../glue/time';
import { testHook, controllerHolder, mirrorControllerState, streamingHolder } from '../glue/test-hook';
import { makeLocalGroup } from '../glue/local-group';
import { getCosmosPool, createMilkyWayStreaming } from '../glue/streaming';
import { wireQuality } from '../glue/quality';
import {
  M3_SOL_SYSTEM_ID,
  HYG_MANIFEST_URL,
  SOL_PACK_URL,
  EXO_PACK_URL,
  OCTREE_MANIFEST_URL,
  GAIA_OCTREE_MANIFEST_URL,
  CONSTELLATIONS_URL,
  type PackState,
} from './packs';
import { DEBUG_BREADCRUMB_PROFILE, DEBUG_FLYTHROUGH4 } from './flags';

/**
 * TASK-053 tier-unification budget gate (`?debug=flythrough4`, ADR-006 §5.4). Loads
 * the full M4a packs (HYG octree + Gaia octree + constellations) and the M4a
 * composition (coverage-faded procgen, gated HYG monolith, overlays, Earth
 * atmosphere) and replays the SAME committed flythrough path through a self-measuring
 * probe. The default run streams the COMBINED HYG+Gaia octree (the M4a tier); the
 * `baseline=m3` run streams the HYG-only octree through the same scenes (the M3 tier)
 * so the near-Sol segment is a like-for-like comparison on the identical path. The
 * frozen clock + epoch are shared with flythrough3 so Earth's waypoint is identical.
 */
export function Flythrough4ProbeApp({ baseline }: { baseline: boolean }): React.JSX.Element | null {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [mountedSystemId, setMountedSystemId] = useState<BodyId | null>(null);

  useEffect(() => {
    installTimeGlue();
    clock.setEpochJD(FLYTHROUGH3_EPOCH_JD); // frozen epoch → deterministic Earth waypoint.
    clock.setPaused(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadStarPack(HYG_MANIFEST_URL),
      loadSystemsPack(SOL_PACK_URL),
      loadSystemsPack(EXO_PACK_URL),
      loadOctreePack(OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
      loadOctreePack(GAIA_OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
      loadConstellationPack(CONSTELLATIONS_URL),
    ]).then(
      ([stars, sol, exo, octree, gaiaOctree, constellationPack]) => {
        if (cancelled) return;
        const combined = createCombinedSource(stars, [sol, exo]);
        const octreeCombined = combineOctreeSources([octree, gaiaOctree]);
        const overlay = buildOverlayData(constellationPack, stars);
        setPack({
          status: 'ready',
          sources: { stars, sol, exo, combined, octree, octreeCombined, overlay },
        });
      },
      (err: unknown) => {
        if (!cancelled) {
          setPack({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    testHook.ready = pack.status === 'ready';
  }, [pack]);

  const tree = useMemo(() => createScaleFrameTree(), []);
  const origin = useMemo(() => createOriginManager(tree, FLYTHROUGH3_START), [tree]);
  const { milkyWay } = useMemo(() => makeLocalGroup(), []);

  const handleController = useCallback((controller: FlightController) => {
    controllerHolder.current = controller;
    mirrorControllerState();
  }, []);

  const handleContextSwitch = useCallback((e: ContextSwitchEvent) => {
    setMountedSystemId(e.to === 'system' ? e.anchorId : null);
    mirrorControllerState();
  }, []);

  const sources = pack.status === 'ready' ? pack.sources : null;

  // baseline=m3 streams the HYG-only octree (the M3 tier); the default streams the
  // combined HYG+Gaia octree (the M4a tier). Same scenes either way → like-for-like.
  const streaming = useMemo<StreamingPolicy | null>(() => {
    if (sources === null) return null;
    const octree = baseline ? sources.octree : sources.octreeCombined;
    if (octree === undefined) return null;
    return createMilkyWayStreaming({ origin, octree, milkyWay });
  }, [origin, sources, milkyWay, baseline]);

  useEffect(() => {
    streamingHolder.current = streaming;
    return () => {
      if (streamingHolder.current === streaming) streamingHolder.current = null;
    };
  }, [streaming]);

  const handleQc = useCallback(
    (qc: QualityController) => {
      if (streaming === null) return;
      wireQuality(streaming, (tier) => {
        testHook.qualityTier = tier;
      })(qc);
      // Pin the tier to `low` and freeze the PerformanceMonitor (setTier overrides
      // auto-stepping). The §5.4 near-Sol gate below is a BUDGET-DROP integration
      // invariant, not a tier-detection test: it must hold the tier constant so the
      // measured scene-point peak is deterministic, not a function of how far CI's
      // software renderer happened to step the monitor down mid-flight (which is
      // exactly the machine-specific value CLAUDE.md rules 4–5 forbid gating on).
      // `low` is the correct constant: the baseline was recorded under the fixed 90k
      // procgen cap, which is now the `low` budget, and a near-Sol budget floor is
      // meaningful at the weakest (integrated-GPU) tier. Tier detection is covered by
      // scene-host/test/quality.test.ts; per-tier density by procgen-draw-budget.test.ts.
      qc.setTier('low');
    },
    [streaming],
  );

  const mountedSystem = useMemo(() => {
    if (sources === null) return null;
    const id = mountedSystemId ?? M3_SOL_SYSTEM_ID;
    const system = sources.sol.getSystem(id) ?? sources.exo.getSystem(id);
    if (system === undefined) return null;
    const packUrl =
      sources.sol.getSystem(id) !== undefined ? SOL_PACK_URL : EXO_PACK_URL;
    return { system, packUrl };
  }, [sources, mountedSystemId]);

  if (pack.status !== 'ready' || streaming === null) return null;

  return (
    <SceneHost
      epochProvider={epochProvider}
      initialQualityTier="low"
      onQualityController={handleQc}
    >
      <color attach="background" args={['#02030a']} />
      <BreadcrumbFrameProfiler />
      <Flythrough4Probe
        origin={origin}
        tree={tree}
        combined={pack.sources.combined}
        milkyWay={milkyWay}
        streaming={streaming}
        variant={baseline ? 'm3' : 'm4a'}
        profileActive={DEBUG_BREADCRUMB_PROFILE || DEBUG_FLYTHROUGH4}
        onController={handleController}
        onContextSwitch={handleContextSwitch}
      />
      <GalaxyScene
        streaming={streaming}
        origin={origin}
        controllerRef={controllerHolder}
        milkyWayRadiusPc={milkyWay.radiusKpc * 1000}
      />
      <StarScene
        stars={pack.sources.stars}
        combined={pack.sources.combined}
        origin={origin}
        controllerRef={controllerHolder}
        // baseline=m3 reproduces the M3 tier: NO streaming prop ⇒ the HYG monolith
        // is always drawn (the redundant near-Sol layer the unification removes). The
        // default (m4a) passes streaming ⇒ the monolith is coverage-gated off.
        streaming={baseline ? undefined : streaming}
      />
      {pack.sources.overlay ? (
        <Overlays
          origin={origin}
          overlay={pack.sources.overlay}
          controllerRef={controllerHolder}
        />
      ) : null}
      {mountedSystem ? (
        <SystemScene
          system={mountedSystem.system}
          origin={origin}
          packUrl={mountedSystem.packUrl}
          controllerRef={controllerHolder}
        />
      ) : null}
    </SceneHost>
  );
}
