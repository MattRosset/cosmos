import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BodyId } from '@cosmos/core-types';
import { createOriginManager, createScaleFrameTree } from '@cosmos/coords';
import {
  loadStarPack,
  loadSystemsPack,
  loadOctreePack,
  loadConstellationPack,
  createCombinedSource,
  type OctreeSource,
} from '@cosmos/data';
import type { FlightController, ContextSwitchEvent } from '@cosmos/nav';
import { SceneHost, type QualityController } from '@cosmos/scene-host';
import type { StreamingPolicy } from '@cosmos/streaming';
import { StarScene } from '../scene/StarScene';
import { SystemScene } from '../scene/SystemScene';
import { GalaxyScene } from '../scene/GalaxyScene';
import { Overlays } from '../scene/Overlays';
import { ErrorGateProbe, ERRORGATE_START } from '../scene/ErrorGateProbe';
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

/**
 * TASK-059 fault injector (`?inject=1`): wraps the combined octree so every
 * `loadTile` for the root key rejects with a real (non-abort) error, forever. The
 * root tile is the very first dispatch in any descent, so this reproduces the BUG-6
 * class deterministically — the gate's own self-test that it goes red, not always
 * green. Debug-only; never wired outside `?debug=errorgate&inject=1`.
 */
function injectOctreeFault(source: OctreeSource): OctreeSource {
  const failKey = source.root.key;
  return {
    root: source.root,
    context: source.context,
    rootHalfExtentUnits: source.rootHalfExtentUnits,
    idPrefix: source.idPrefix,
    getNode: (key) => source.getNode(key),
    loadTile(key, opts) {
      if (key === failKey) {
        return Promise.reject(new Error('TASK-059 injected fault (?inject=1)'));
      }
      return source.loadTile(key, opts);
    },
  };
}

/**
 * TASK-059 error gate (`?debug=errorgate`): the M4a composition driven by
 * `ErrorGateProbe` instead of the user-facing `NavDriver` — same packs, same
 * scenes, same streaming policy as production, per the gate doctrine (measure the
 * shipped pipeline, docs/architecture.md §6). `inject` deliberately breaks the
 * combined octree's root tile so the gate proves it goes red (see
 * `injectOctreeFault`).
 */
export function ErrorGateApp({ inject }: { inject: boolean }): React.JSX.Element | null {
  const [pack, setPack] = useState<PackState>({ status: 'loading' });
  const [mountedSystemId, setMountedSystemId] = useState<BodyId | null>(null);

  useEffect(() => {
    installTimeGlue();
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
        let octreeCombined = combineOctreeSources([octree, gaiaOctree]);
        if (inject) octreeCombined = injectOctreeFault(octreeCombined);
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
  }, [inject]);

  useEffect(() => {
    testHook.ready = pack.status === 'ready';
  }, [pack]);

  const tree = useMemo(() => createScaleFrameTree(), []);
  const origin = useMemo(() => createOriginManager(tree, ERRORGATE_START), [tree]);
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
      <ErrorGateProbe
        origin={origin}
        tree={tree}
        combined={pack.sources.combined}
        milkyWay={milkyWay}
        streaming={streaming}
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
