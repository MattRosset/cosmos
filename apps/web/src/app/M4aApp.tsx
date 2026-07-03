import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BodyId, UniversePosition } from '@cosmos/core-types';
import { CONTEXT_UNIT_METERS } from '@cosmos/core-types';
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
import { useTourStore } from '@cosmos/app-state';
import { StarScene } from '../scene/StarScene';
import { SystemScene } from '../scene/SystemScene';
import { GalaxyScene } from '../scene/GalaxyScene';
import { Overlays } from '../scene/Overlays';
import { M3DescentProbe, M3_START } from '../scene/M3DescentProbe';
import { combineOctreeSources } from '../glue/octree-combined';
import { buildOverlayData } from '../glue/overlays';
import { GRAND_TOUR } from '../glue/tours';
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
import './dev-surface';

/**
 * TASK-052 M4a gate (`?debug=m4a`): the M3 scripted descent (M3DescentProbe) run
 * against the M4a composition — the COMBINED HYG + Gaia octree streamed through one
 * policy, the coverage-driven procgen fade + monolith gate (GalaxyScene/StarScene),
 * the educational overlays, and the Earth atmosphere (quality-gated in SystemScene).
 * It exists separately from `?debug=m3` so the M3 baselines stay frozen; the e2e
 * (m4a.spec.ts) drives tier (via `window.__cosmosDev.setTier`) + overlay/tour stores
 * against the SHIPPED pipeline. The clock is paused so orbital motion cannot
 * contaminate the descent.
 */
export function M4aApp() {
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
    if (sources?.octreeCombined === undefined) return null;
    return createMilkyWayStreaming({ origin, octree: sources.octreeCombined, milkyWay });
  }, [origin, sources, milkyWay]);

  useEffect(() => {
    streamingHolder.current = streaming;
    return () => {
      if (streamingHolder.current === streaming) streamingHolder.current = null;
    };
  }, [streaming]);

  const qcRef = useRef<QualityController | null>(null);
  useEffect(() => {
    window.__cosmosDev = {
      setTier: (tier) => qcRef.current?.setTier(tier),
      startTour: () => useTourStore.getState().start(GRAND_TOUR),
      stopTour: () => useTourStore.getState().stop(),
      focusFirstLabel: () => {
        const ctrl = controllerHolder.current;
        const label = sources?.overlay?.labels[0];
        if (ctrl === null || label === undefined) return;
        const p = label.positionPc;
        const target: UniversePosition = { context: 'galaxy', local: [p[0], p[1], p[2]] };
        ctrl.goTo({ target, lookAtTarget: target, arrivalDistanceM: CONTEXT_UNIT_METERS.galaxy, durationMs: 1500 });
      },
    };
    return () => {
      delete window.__cosmosDev;
    };
  }, [sources]);

  const handleQc = useCallback(
    (qc: QualityController) => {
      qcRef.current = qc;
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
