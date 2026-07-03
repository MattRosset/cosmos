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
import { useOverlayStore } from '@cosmos/app-state';
import { StarScene } from '../scene/StarScene';
import { SystemScene } from '../scene/SystemScene';
import { GalaxyScene } from '../scene/GalaxyScene';
import { Overlays } from '../scene/Overlays';
import { SoakProbe } from '../scene/SoakProbe';
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
import { SOAK3_LOOPS } from './flags';

/**
 * TASK-053 M4a memory-soak gate (`?debug=soak4`, §5.8 / §6). Loops the committed
 * flythrough path back and forth (SoakProbe) against the M4a composition — the
 * combined HYG+Gaia octree, the constellation/nebula/label overlays (toggled ON so
 * the new mounts actually exist), and the Earth atmosphere on the system leg. Each
 * down-and-back cycle mounts these on entry and must dispose them on context exit;
 * a leak compounds over the loop. Publishes the same `window.__soak3Result` shape so
 * the soak3 spec can assert the heap plateau + churn for the M4a mounts too.
 */
export function Soak4ProbeApp(): React.JSX.Element | null {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [mountedSystemId, setMountedSystemId] = useState<BodyId | null>(null);

  useEffect(() => {
    installTimeGlue();
    clock.setEpochJD(FLYTHROUGH3_EPOCH_JD);
    clock.setPaused(true);
    // Turn the overlays ON so the nebula/line-set/label mounts exist across the soak
    // (they are the M4a leak suspects). Restore on unmount.
    const o = useOverlayStore.getState();
    const prev = { constellations: o.constellations, labels: o.labels };
    o.setConstellations(true);
    o.setLabels(true);
    return () => {
      const s = useOverlayStore.getState();
      s.setConstellations(prev.constellations);
      s.setLabels(prev.labels);
    };
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

  const streaming = useMemo<StreamingPolicy | null>(() => {
    if (sources?.octreeCombined === undefined) return null;
    return createMilkyWayStreaming({ origin, octree: sources.octreeCombined, milkyWay });
  }, [origin, sources, milkyWay]);

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
      initialQualityTier="high"
      onQualityController={handleQc}
    >
      <color attach="background" args={['#02030a']} />
      <SoakProbe
        origin={origin}
        tree={tree}
        combined={pack.sources.combined}
        milkyWay={milkyWay}
        streaming={streaming}
        loops={SOAK3_LOOPS}
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
        streaming={streaming}
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
