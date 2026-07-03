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
import { Flythrough3Probe } from '../scene/Flythrough3Probe';
import { SoakProbe } from '../scene/SoakProbe';
import { FLYTHROUGH3_START, FLYTHROUGH3_EPOCH_JD } from '../scene/flythrough-descent';
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
import { SOAK3_LOOPS } from './flags';

/**
 * TASK-041 Phase 3 gate (`?debug=flythrough3` / `?debug=soak3`, §5.8). Loads the
 * exact M3 composition (full packs + HYG octree + streaming tier + procedural
 * Milky Way) and replaces user input with a self-measuring probe that replays the
 * committed recorded camera path. flythrough3 measures a single descent's frame
 * times + heap + streaming peak; soak3 loops the path back and forth, sampling
 * heap + loadedChunks to prove the memory plateau. Both pin the (paused) clock to
 * the frozen flythrough epoch so the path is deterministic and orbits cannot
 * contaminate frame deltas. Shares M3App's structure exactly — the gate measures
 * the SHIPPED pipeline (TASK-030/040 doctrine).
 */
export function StreamingProbeApp({ kind }: { kind: 'flythrough3' | 'soak3' }): React.JSX.Element | null {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [mountedSystemId, setMountedSystemId] = useState<BodyId | null>(null);

  useEffect(() => {
    installTimeGlue();
    clock.setEpochJD(FLYTHROUGH3_EPOCH_JD); // frozen epoch → deterministic Earth waypoint.
    clock.setPaused(true); // freeze orbits — the probe tests CAMERA + streaming.
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
      {kind === 'soak3' ? (
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
      ) : (
        <Flythrough3Probe
          origin={origin}
          tree={tree}
          combined={pack.sources.combined}
          milkyWay={milkyWay}
          streaming={streaming}
          onController={handleController}
          onContextSwitch={handleContextSwitch}
        />
      )}
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
