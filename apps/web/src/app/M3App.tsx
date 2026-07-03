import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BodyId } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import { loadStarPack, loadSystemsPack, loadOctreePack, createCombinedSource } from '@cosmos/data';
import type { FlightController, ContextSwitchEvent } from '@cosmos/nav';
import { SceneHost, type QualityController } from '@cosmos/scene-host';
import type { StreamingPolicy } from '@cosmos/streaming';
import { StarScene } from '../scene/StarScene';
import { SystemScene } from '../scene/SystemScene';
import { GalaxyScene } from '../scene/GalaxyScene';
import { M3DescentProbe, M3_START } from '../scene/M3DescentProbe';
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
  type PackState,
} from './packs';

/**
 * TASK-040 M3 gate (`?debug=m3`): the signature continuous-zoom acceptance run.
 * Loads the full M2 packs PLUS the HYG octree, builds the streaming tier + the
 * procedural Milky Way, and replaces user input with M3DescentProbe — a scripted
 * universe→galaxy→system descent to an Earth approach. The shipped scenes (star
 * field, galaxy/streaming tier, system) mount identically to production; only
 * navigation is scripted and the clock is paused so orbital motion cannot
 * contaminate the per-frame transition deltas.
 */
export function M3App() {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [mountedSystemId, setMountedSystemId] = useState<BodyId | null>(null);

  useEffect(() => {
    installTimeGlue();
    clock.setPaused(true); // freeze orbits — the probe tests CAMERA transitions.
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadStarPack(HYG_MANIFEST_URL),
      loadSystemsPack(SOL_PACK_URL),
      loadSystemsPack(EXO_PACK_URL),
      loadOctreePack(OCTREE_MANIFEST_URL, { pool: getCosmosPool() }),
    ]).then(
      ([stars, sol, exo, octree]) => {
        if (cancelled) return;
        const combined = createCombinedSource(stars, [sol, exo]);
        setPack({ status: 'ready', sources: { stars, sol, exo, combined, octree } });
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
  const origin = useMemo(() => createOriginManager(tree, M3_START), [tree]);
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
    if (sources?.octree === undefined) return null;
    return createMilkyWayStreaming({ origin, octree: sources.octree, milkyWay });
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
      <M3DescentProbe
        origin={origin}
        tree={tree}
        combined={pack.sources.combined}
        milkyWay={milkyWay}
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
      />
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
